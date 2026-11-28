// tests/battle-report.test.js — ведомость комнаты Battle (ФИО, рекомендуемая оценка,
// вклад) и подключение таблицы после Battle к редактору, комнате и сводке.
// Реальные экраны и Firestore не запускаются: проверяются расчёт и структура подключения.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { battleRoomReport } from "../core/battle-report.js";
import { buildBattleSummary } from "../core/battle-summary.js";
import { splitTask, evaluateSubmission, compareTeams } from "../core/practical.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

const det = (uid, name, c, total = 10) => ({ uid, name, status: "graded", grade: c * 10, earned: c, max: total, answered: total, total, correctCount: c });
const bp = (uid, name, teamId, grade, extra = {}) => ({ uid, name, teamId, isCaptain: false, isReserve: false, substituted: false, eliminated: false, availableQuestions: 5, participatedQuestions: 5, accuracyPercent: grade, participationPercent: 100, battleGrade: grade, ...extra });
const history = () => ({
  studentsDetail: [det("u1", "Яблоков Пётр", 4), det("u2", "Антонов Иван", 8), det("u3", "Белова Мария", 6)],
  battle: { winner: "a", scores: { a: 9, b: 5 }, players: [bp("u1", "Яблоков Пётр", "a", 80), bp("u2", "Антонов Иван", "b", 60), bp("u3", "Белова Мария", "a", 70)] }
});

test("ведомость: участники по ФИО, рекомендуемая оценка, участие и вклад", () => {
  const r = battleRoomReport({ room: { code: "ABC123", title: "Датчики" }, hostName: "Иванов", dateMs: 1, history: history() });
  assert.deepEqual(r.people.map((p) => p.name), ["Антонов Иван", "Белова Мария", "Яблоков Пётр"], "по алфавиту");
  for (const p of r.people) {
    assert.ok(p.recommended, "у каждого есть рекомендуемая оценка");
    assert.equal(p.metrics.participation, 100);
    assert.ok(p.metrics.contribution !== null, "вклад считается по голосам в Battle");
  }
  assert.equal(r.lesson.topic, "Датчики");
  assert.equal(r.summary.battle.winner, "a");
});

test("ведомость: таблица после Battle входит, если подтверждена, и учитывается в командной работе", () => {
  const L = (t) => ({ t: "label", text: t });
  const A = (a) => ({ t: "answer", mode: "text", accept: a, points: 1 });
  const mk = (title) => ({ title, columns: ["П", "З"], rows: [[L("x"), A(["да"])], [L("y"), A(["нет"])]] });
  const a = splitTask(mk("А")), b = splitTask(mk("Б"));
  const ea = evaluateSubmission({ pub: a.publicTask, keys: a.keys, cells: { r0c1: "да", r1c1: "нет" } });
  const eb = evaluateSubmission({ pub: b.publicTask, keys: b.keys, cells: { r0c1: "да", r1c1: "?" } });
  const snapshot = { tasks: { a: a.publicTask, b: b.publicTask }, submissions: { a: { by: "u1", submittedAt: 1 }, b: { by: "u2", submittedAt: 2 } }, expected: {} };
  const confirmed = { evaluations: { a: ea, b: eb }, comparison: compareTeams(ea, eb), confirmedAt: 5 };
  const withTable = battleRoomReport({ room: { code: "X" }, history: history(), practicalSnapshot: snapshot, confirmed });
  const without = battleRoomReport({ room: { code: "X" }, history: history() });
  assert.equal(withTable.summary.practical.winner, "a");
  assert.equal(withTable.summary.practical.available, true, "практика учтена в ведомости");
  assert.notEqual(without.summary.practical.available, true, "без таблицы практика не учитывается");
});

test("ведомость: нет истории Live или Battle — отчёт не падает и это видно в заметках", () => {
  const r = battleRoomReport({ room: { code: "X" }, history: { studentsDetail: [det("u1", "Анна", 5)] } });
  assert.equal(r.people.length, 1);
  assert.ok(r.notes.some((n) => /Battle/.test(n)));
  assert.doesNotThrow(() => battleRoomReport({}));
});

test("сводка Battle: колонки практики и итог с практикой, а у старой битвы их нет", () => {
  const base = {
    phase: "finished", winner: "a", scores: { a: 9, b: 5 },
    finalRoster: { captains: { a: "u1", b: "u2" }, teams: { a: ["u1"], b: ["u2"] }, reserve: [], substituted: [], eliminated: [] },
    roundSummaries: []
  };
  const withPractical = buildBattleSummary({ battle: { ...base, practicalDone: { a: true, b: true }, practicalScores: { a: 7, b: 3 }, practicalResults: { a: { score: 7, max: 9 }, b: { score: 3, max: 9 } } }, nameOf: (u) => u });
  assert.deepEqual(withPractical.practical.total, { a: 16, b: 8 });
  assert.equal(withPractical.score.text, "9 : 5", "счёт Battle не меняется");
  assert.equal(buildBattleSummary({ battle: base, nameOf: (u) => u }).practical, null);
});

// ---------- подключение ----------

test("редактор: таблица после Battle — в окне набора вопросов теста", () => {
  const editor = read("ui/components/battle-set-editor.js");
  assert.match(editor, /buildPracticalEditor/);
  assert.match(editor, /Таблица после Battle/);
  assert.match(editor, /set\.tables = tableOn\.checked/);
});

test("комната: таблица и ведомость подключены у ведущего, игрока, наблюдателя и проектора", () => {
  const room = read("ui/pages/battle-room.js");
  assert.match(room, /mountBattlePractical\(\{ kind: "host"/);
  assert.match(room, /kind: isObserver \? "screen" : "player"/);
  assert.match(room, /mountBattlePractical\(\{ kind: "screen"/);
  assert.match(room, /buildBattleReportPanel/);
  assert.match(room, /await practical\?\.begin\(\)/);
});

test("хранилище: строки таблицы кодируются при записи, ключи не уходят в публичное задание", () => {
  const store = read("core/practical-store.js");
  assert.match(store, /\.\.\.encodeTask\(publicTask\)/);
  assert.match(store, /decodeTask/);
  const mount = read("ui/components/battle-practical.js");
  assert.doesNotMatch(mount, /accept/, "экран не работает с ожидаемыми ответами");
  assert.match(mount, /loadKeys/, "ключи читает только ведущий");
});
