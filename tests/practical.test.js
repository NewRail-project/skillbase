// tests/practical.test.js — практическая диагностика: таблицы, ключи, проверка, победитель.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTask, validateTask, splitTask, publicTask, taskKeys, normalizeText, parseNumber,
  checkAnswer, evaluateSubmission, compareTeams, sanitizeCells, canEditSubmission,
  practicalOverview, answerCellIds, cellId, TASK_STATUS, SUBMISSION
} from "../core/practical.js";

const L = (text) => ({ t: "label", text });
const A = (mode, accept, extra = {}) => ({ t: "answer", mode, accept, ...extra });

const TASK = {
  title: "Диагностика датчика", description: "Заполните таблицу по показаниям.",
  columns: ["Параметр", "Значение"],
  rows: [
    [L("Номер датчика"), A("number", ["4"])],
    [L("Показание прибора"), A("number", ["12,5"], { tolerance: 0.1, unit: "В" })],
    [L("Неисправность"), A("text", ["обрыв цепи", "обрыв провода"])],
    [L("Рекомендуемое действие"), A("manual", [])]
  ]
};

test("публичное задание не содержит ключей; ключи отдельно и полные", () => {
  const { publicTask: pub, keys } = splitTask(TASK);
  const json = JSON.stringify(pub);
  for (const secret of ["обрыв цепи", "обрыв провода", "12,5", '"accept"', "tolerance"]) {
    assert.ok(!json.includes(secret), `утечка в публичном задании: ${secret}`);
  }
  assert.equal(pub.rows[2][1].t, "answer");
  assert.equal(pub.rows[0][0].text, "Номер датчика", "заголовки строк остаются");
  assert.deepEqual(Object.keys(keys), ["r0c1", "r1c1", "r2c1", "r3c1"]);
  assert.deepEqual(keys.r2c1.accept, ["обрыв цепи", "обрыв провода"]);
  assert.equal(keys.r1c1.tolerance, 0.1);
});

test("нормализация текста: пробелы, регистр, ё/е, крайняя пунктуация", () => {
  assert.equal(normalizeText("  Обрыв   ЦЕПИ. "), "обрыв цепи");
  assert.equal(normalizeText("Ёлка"), "елка");
  assert.equal(normalizeText("«Обрыв цепи»;"), "обрыв цепи");
  assert.equal(normalizeText(null), "");
});

test("проверка текста: точное совпадение после нормализации, без нечёткости", () => {
  const key = { mode: "text", accept: ["обрыв цепи"] };
  assert.equal(checkAnswer("Обрыв   цепи", key), true);
  assert.equal(checkAnswer("обрыв", key), false, "часть ответа — не совпадение");
  assert.equal(checkAnswer("обрыв цепи питания", key), false, "лишние слова — не совпадение");
  assert.equal(checkAnswer("обрыв цепи", key) && checkAnswer("ОБРЫВ ЦЕПИ", key), true);
  assert.equal(checkAnswer("обрыв цепи ", { mode: "text", accept: ["обрыв провода", "обрыв цепи"] }), true, "любой из допустимых");
  assert.equal(checkAnswer("", key), false, "пустой ответ неверен");
});

test("числа: запятая/точка, пробелы, единица, допуск", () => {
  assert.equal(parseNumber("12,5"), 12.5);
  assert.equal(parseNumber("1 000,5"), 1000.5);
  assert.equal(parseNumber("1\u00A0000"), 1000);
  assert.equal(parseNumber("12,5 В", "В"), 12.5);
  assert.equal(parseNumber("−3"), -3);
  assert.ok(Number.isNaN(parseNumber("abc")));
  assert.ok(Number.isNaN(parseNumber("12,5,5")));
  assert.ok(Number.isNaN(parseNumber("")));
  const key = { mode: "number", accept: ["12,5"], tolerance: 0.1, unit: "В" };
  assert.equal(checkAnswer("12.5", key), true);
  assert.equal(checkAnswer("12,59 В", key), true, "в пределах допуска");
  assert.equal(checkAnswer("12,7", key), false, "вне допуска");
  assert.equal(checkAnswer("двенадцать", key), false, "слово вместо числа");
  assert.equal(checkAnswer("4", { mode: "number", accept: ["4"] }), true);
  assert.equal(checkAnswer("4,01", { mode: "number", accept: ["4"] }), false, "допуск 0 — точное число");
});

test("ручная проверка: автоматического вердикта нет", () => {
  assert.equal(checkAnswer("что угодно", { mode: "manual", accept: [] }), null);
  assert.equal(checkAnswer("x", undefined), null);
});

test("подсчёт: балл, максимум, процент, ожидающие ручной проверки", () => {
  const { publicTask: pub, keys } = splitTask(TASK);
  const res = evaluateSubmission({ pub, keys, cells: { r0c1: "4", r1c1: "12,5 В", r2c1: "обрыв цепи", r3c1: "заменить" } });
  assert.equal(res.score, 3);
  assert.equal(res.max, 4);
  assert.equal(res.pending, 1);
  assert.equal(res.complete, false);
  assert.equal(res.cells.r3c1.source, "pending");
  assert.equal(res.cells.r3c1.ok, null);
  assert.equal(res.answered, 4);
});

test("решение преподавателя перекрывает автопроверку и закрывает ручные", () => {
  const { publicTask: pub, keys } = splitTask(TASK);
  const cells = { r0c1: "5", r1c1: "12,5", r2c1: "обрыв", r3c1: "заменить" };
  const base = evaluateSubmission({ pub, keys, cells });
  assert.equal(base.score, 1);
  const done = evaluateSubmission({ pub, keys, cells, overrides: { r0c1: true, r2c1: true, r3c1: true } });
  assert.equal(done.score, 4, "спорные засчитаны вручную");
  assert.equal(done.cells.r0c1.source, "teacher");
  assert.equal(done.complete, true);
  assert.equal(done.percent, 100);
  const lowered = evaluateSubmission({ pub, keys, cells: { r0c1: "4" }, overrides: { r0c1: false } });
  assert.equal(lowered.cells.r0c1.ok, false, "преподаватель может и снять балл");
});

test("баллы за ячейку: points учитываются в максимуме и проценте", () => {
  const task = { title: "t", columns: ["a", "b"], rows: [[L("x"), A("text", ["да"], { points: 3 })], [L("y"), A("text", ["нет"])]] };
  const { publicTask: pub, keys } = splitTask(task);
  const res = evaluateSubmission({ pub, keys, cells: { r0c1: "да", r1c1: "?" } });
  assert.deepEqual([res.score, res.max, res.percent], [3, 4, 75]);
});

test("сравнение команд по проценту; ничья при равном; ручная проверка блокирует", () => {
  const mk = (score, max, complete = true) => ({ score, max, percent: Math.round((score / max) * 10000) / 100, complete });
  assert.deepEqual(compareTeams(mk(4, 5), mk(3, 5)).winner, "a");
  assert.equal(compareTeams(mk(2, 5), mk(3, 5)).winner, "b");
  const tie = compareTeams(mk(2, 4), mk(5, 10));
  assert.equal(tie.tie, true, "задания разные: 50% = 50%");
  assert.equal(tie.winner, null);
  const wait = compareTeams(mk(2, 4, false), mk(5, 10));
  assert.equal(wait.ready, false);
  assert.match(wait.reason, /ручной проверки/);
  assert.equal(compareTeams(null, mk(1, 1)).ready, false);
});

test("валидация: понятные русские ошибки при подготовке", () => {
  assert.deepEqual(validateTask(TASK), []);
  const bad = validateTask({ title: "", columns: ["a"], rows: [[A("text", [])]] }, { team: "a" });
  assert.ok(bad.some(e => /название/.test(e)));
  assert.ok(bad.some(e => /ожидаемый ответ/.test(e)));
  assert.ok(bad.every(e => /Задание команды А/.test(e)));
  const noAnswers = validateTask({ title: "x", columns: ["a"], rows: [[L("только текст")]] });
  assert.ok(noAnswers.some(e => /ячейку для ответа/.test(e)));
  const nan = validateTask({ title: "x", columns: ["a"], rows: [[A("number", ["abc"])]] });
  assert.ok(nan.some(e => /не число/.test(e)));
});

test("нормализация: границы строк/столбцов и мусор не ломают структуру", () => {
  const t = normalizeTask({ title: "  Т  ", columns: Array(10).fill("c"), rows: Array(50).fill([L("x")]) });
  assert.equal(t.columns.length, 6);
  assert.equal(t.rows.length, 20);
  assert.ok(t.rows.every(r => r.length === 6));
  assert.equal(t.title, "Т");
  assert.equal(normalizeTask(null).rows.length, 1);
  assert.equal(normalizeTask({ rows: [[A("bogus", ["x"])]] }).rows[0][0].mode, "text");
});

test("отправка: только известные ячейки, обрезка длины, чужие поля отброшены", () => {
  const pub = publicTask(TASK);
  const clean = sanitizeCells(pub, { r0c1: "4", r9c9: "хак", __proto__x: "1", r2c1: "x".repeat(500) });
  assert.deepEqual(Object.keys(clean).sort(), ["r0c1", "r2c1"]);
  assert.equal(clean.r2c1.length, 200);
  assert.deepEqual(answerCellIds(pub), ["r0c1", "r1c1", "r2c1", "r3c1"]);
  assert.equal(cellId(2, 3), "r2c3");
});

test("права: правит только капитан, пока открыто и не отправлено", () => {
  const ok = { taskStatus: TASK_STATUS.OPEN, submission: { status: SUBMISSION.DRAFT }, isCaptain: true };
  assert.equal(canEditSubmission(ok).ok, true);
  assert.equal(canEditSubmission({ ...ok, isCaptain: false }).ok, false);
  assert.equal(canEditSubmission({ ...ok, taskStatus: TASK_STATUS.CLOSED }).ok, false);
  const frozen = canEditSubmission({ ...ok, submission: { status: SUBMISSION.SUBMITTED } });
  assert.equal(frozen.ok, false);
  assert.match(frozen.reason, /зафиксирована/);
});

test("сводка этапа: когда можно определять результат", () => {
  const open = { status: TASK_STATUS.OPEN };
  const none = practicalOverview({});
  assert.equal(none.canDetermine, false);
  const wait = practicalOverview({ tasks: { a: open, b: open }, submissions: { a: { status: "submitted" }, b: { status: "draft" } } });
  assert.equal(wait.teams.a.status, "submitted");
  assert.equal(wait.teams.b.status, "draft");
  assert.equal(wait.canDetermine, false, "команда Б ещё не отправила");
  const ready = practicalOverview({ tasks: { a: open, b: open }, submissions: { a: { status: "submitted" }, b: { status: "submitted" } } });
  assert.equal(ready.canDetermine, true);
  const done = practicalOverview({ tasks: { a: { status: "confirmed" }, b: { status: "confirmed" } }, submissions: { a: { status: "submitted" }, b: { status: "submitted" } } });
  assert.equal(done.confirmed, true);
  assert.equal(done.canDetermine, false, "подтверждённый результат повторно не определяется");
});
