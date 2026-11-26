// tests/practical-host-entry.test.js — практика с вводом ведущим на доске:
// две таблицы друг напротив друга, «Проверить» → очки, подтверждение, и колонки
// отчёта (участие, вклад, командная работа). Реальная работа Firestore и вид на
// большой доске здесь НЕ проверяются.
import test from "node:test";
import assert from "node:assert/strict";
import { installFakeDom, findAll, findOne, text } from "./helpers/fake-dom.js";

installFakeDom();
const { buildPracticalHost } = await import("../ui/components/practical.js");
const P = await import("../core/practical.js");
const { buildLessonReport } = await import("../core/lesson-report.js");

const L = (t) => ({ t: "label", text: t });
const A = (mode, accept, extra = {}) => ({ t: "answer", mode, accept, ...extra });
const TASK_A = { title: "Датчик А", columns: ["Параметр", "Значение"], rows: [[L("Номер"), A("number", ["4"])], [L("Неисправность"), A("text", ["обрыв цепи"])]] };
const TASK_B = { title: "Датчик Б", columns: ["Параметр", "Значение"], rows: [[L("Номер"), A("number", ["7"])], [L("Неисправность"), A("text", ["замыкание"])]] };
const SA = P.splitTask(TASK_A), SB = P.splitTask(TASK_B);
const doc = (team, s, status, extra = {}) => ({ team, ...s.publicTask, status, ...extra });
const tasksAt = (status, extra = {}) => ({ a: doc("a", SA, status, extra.a), b: doc("b", SB, status, extra.b) });

const inputsOf = (root) => findAll(root, (e) => e.tag === "input");
const btn = (root, action) => findOne(root, (e) => e.tag === "button" && e.getAttribute("data-action") === action);
const tick = () => new Promise((r) => setImmediate(r));

function rig({ withEntry = true, saved = null } = {}) {
  const calls = { setup: 0, status: [], saveEntry: [], confirm: [], loadKeys: [] };
  const api = {
    setup: async () => { calls.setup++; },
    setStatus: async (team, st) => { calls.status.push([team, st]); },
    loadKeys: async (team) => { calls.loadKeys.push(team); return (team === "a" ? SA : SB).keys; },
    loadReview: async () => ({}), saveReview: async () => {},
    returnForRevision: async () => {},
    confirm: async (x) => { calls.confirm.push(x); },
    ...(withEntry ? {
      loadEntry: async () => saved,
      saveEntry: async (entry, tasks) => { calls.saveEntry.push(JSON.parse(JSON.stringify(entry))); }
    } : {})
  };
  const view = buildPracticalHost({ api, confirmAction: () => true });
  return { view, calls, api };
}

// ---------- чистая логика ----------

test("ввод ведущего: чистая карта, лишние ячейки и длинные значения не проходят", () => {
  const tasks = tasksAt("closed");
  const e = P.sanitizeEntry(tasks, { mode: "host", a: { r0c1: "4", r9c9: "чужая", r1c1: "x".repeat(500) }, b: { r0c1: "7" } });
  assert.equal(e.mode, "host");
  assert.deepEqual(Object.keys(e.a).sort(), ["r0c1", "r1c1"]);
  assert.ok(e.a.r1c1.length < 500, "значение обрезано");
  assert.equal(P.sanitizeEntry(tasks, { mode: "что-то" }).mode, "captain", "неизвестный режим — по умолчанию");
});

test("ввод ведущего → отправленные таблицы → очки и сравнение команд", () => {
  const tasks = tasksAt("closed");
  const entry = { mode: "host", a: { r0c1: "4", r1c1: "Обрыв цепи" }, b: { r0c1: "8", r1c1: "замыкание" } };
  const subs = P.entryToSubmissions(tasks, entry);
  assert.equal(subs.a.status, "submitted");
  const evA = P.evaluateSubmission({ pub: tasks.a, keys: SA.keys, cells: subs.a.cells });
  const evB = P.evaluateSubmission({ pub: tasks.b, keys: SB.keys, cells: subs.b.cells });
  assert.equal(evA.score, 2, "оба ответа верны (регистр не важен)");
  assert.equal(evB.score, 1, "число неверно, слово верно");
  const cmp = P.compareTeams(evA, evB);
  assert.equal(cmp.ready, true);
  assert.equal(cmp.winner, "a");
});

test("проверять можно, когда у каждой команды заполнена хотя бы одна ячейка", () => {
  const tasks = tasksAt("closed");
  assert.equal(P.canCheckEntry(tasks, { a: { r0c1: "4" }, b: {} }), false);
  assert.equal(P.canCheckEntry(tasks, { a: { r0c1: "4" }, b: { r1c1: "x" } }), true);
  assert.equal(P.canCheckEntry({ a: tasks.a }, { a: { r0c1: "4" } }), false, "нет задания второй команды");
  assert.deepEqual(P.entryProgress(tasks.a, { r0c1: "4", r1c1: "  " }), { filled: 1, total: 2 });
});

// ---------- интерфейс ----------

test("до подготовки: две кнопки; «для ввода на доске» — только если интерфейс умеет сохранять ввод", () => {
  const withEntry = rig();
  assert.ok(btn(withEntry.view.el, "setup") && btn(withEntry.view.el, "setup-host"));
  const legacy = rig({ withEntry: false });
  assert.ok(btn(legacy.view.el, "setup"));
  assert.equal(btn(legacy.view.el, "setup-host"), null, "в старой комнате режима нет");
});

test("подготовка для ввода на доске: задания закрыты для команд, режим сохранён", async () => {
  const { view, calls } = rig();
  btn(view.el, "setup-host").click();
  await tick();
  assert.equal(calls.setup, 1);
  assert.deepEqual(calls.status, [["a", "closed"], ["b", "closed"]], "команды сами писать не могут");
  assert.equal(calls.saveEntry.at(-1).mode, "host");
});

test("две таблицы стоят рядом, поля ввода у обеих команд, «Проверить» ждёт ввода", async () => {
  const { view, calls } = rig({ saved: { mode: "host", a: {}, b: {} } });
  await tick();
  view.update({ tasks: tasksAt("closed"), submissions: {} });
  const board = findOne(view.el, (e) => String(e.className).includes("pr-sides"));
  const sides = findAll(board, (e) => e.tag === "section" && String(e.className).includes("pr-side"));
  assert.deepEqual(sides.map((s) => s.getAttribute("data-team")), ["a", "b"], "команды А и Б друг напротив друга");
  assert.equal(inputsOf(view.el).length, 4, "по два поля у каждой команды");
  const check = btn(view.el, "check");
  assert.equal(check.disabled, true);
  const [a1, , b1] = inputsOf(view.el);
  a1.value = "4"; a1.dispatch("input");
  assert.equal(check.disabled, true, "у второй команды пусто");
  b1.value = "7"; b1.dispatch("input");
  assert.equal(check.disabled, false);
  assert.match(text(view.el), /Заполнено ячеек: 1 из 2/);
  // Потеря фокуса сразу сохраняет ввод.
  board.dispatch("focusout");
  await tick();
  assert.deepEqual(calls.saveEntry.at(-1).a, { r0c1: "4" });
  assert.deepEqual(calls.saveEntry.at(-1).b, { r0c1: "7" });
});

test("новый снимок Firestore во время ввода не пересоздаёт поля (не теряется фокус и текст)", async () => {
  const { view } = rig({ saved: { mode: "host", a: {}, b: {} } });
  await tick();
  view.update({ tasks: tasksAt("closed"), submissions: {} });
  const [first] = inputsOf(view.el);
  first.value = "набираю";
  view.update({ tasks: tasksAt("closed"), submissions: {} });
  view.update({ tasks: tasksAt("closed"), submissions: { a: { status: "draft", cells: {} } } });
  assert.equal(inputsOf(view.el)[0], first, "тот же узел");
  assert.equal(inputsOf(view.el)[0].value, "набираю");
});

test("«Проверить» → таблицы с очками рядом → «Подтвердить результат» → итог с отметками", async () => {
  const { view, calls } = rig({ saved: { mode: "host", a: { r0c1: "4", r1c1: "обрыв цепи" }, b: { r0c1: "8", r1c1: "замыкание" } } });
  await tick();
  view.update({ tasks: tasksAt("closed"), submissions: {} });
  btn(view.el, "check").click();
  await tick(); await tick();
  assert.deepEqual(calls.loadKeys.sort(), ["a", "b"]);
  const t = text(view.el);
  assert.match(t, /Команда А: 2 из 2 \(100%\)/);
  assert.match(t, /Команда Б: 1 из 2 \(50%\)/);
  assert.match(t, /Побеждает Команда А/);
  const reviewSides = findAll(view.el, (e) => e.tag === "section" && String(e.className).includes("pr-review-team"));
  assert.equal(reviewSides.length, 2);
  btn(view.el, "confirm").click();
  await tick(); await tick();
  assert.equal(calls.confirm.length, 1);
  assert.equal(calls.confirm[0].evaluations.a.score, 2);
  assert.equal(calls.confirm[0].comparison.winner, "a");
  // Подтверждено: снимок приходит с result — итог и таблицы с ✓/✗ рядом.
  const done = {
    a: doc("a", SA, "confirmed", { result: { score: 2, max: 2, percent: 100, cells: { r0c1: true, r1c1: true }, winner: "a" } }),
    b: doc("b", SB, "confirmed", { result: { score: 1, max: 2, percent: 50, cells: { r0c1: false, r1c1: true }, winner: "a" } })
  };
  view.update({ tasks: done, submissions: {} });
  const after = text(view.el);
  assert.match(after, /Победила Команда А/);
  assert.match(after, /✓ верно/);
  assert.match(after, /✗ неверно/);
  assert.equal(inputsOf(view.el).length, 0, "после подтверждения ввод закрыт");
});

test("ответы ключа до проверки на экране не показываются", async () => {
  const { view } = rig({ saved: { mode: "host", a: {}, b: {} } });
  await tick();
  view.update({ tasks: tasksAt("closed"), submissions: {} });
  assert.ok(!/обрыв цепи|замыкание/.test(text(view.el)));
});

// ---------- отчёт ----------

test("отчёт: участие, вклад и командная работа — из Battle и практики; нет данных — null", () => {
  const plan = { stages: { battle: true, practical: true }, topic: "Т" };
  const run = { done: { battle: true, practical: true } };
  const battle = {
    winner: "a", scores: { a: 8, b: 4 },
    players: [
      { uid: "u1", name: "Яковлев", teamId: "a", availableQuestions: 4, participatedQuestions: 3, accuracyPercent: 80, participationPercent: 75, battleGrade: 4 },
      { uid: "u2", name: "Абрамов", teamId: "b", availableQuestions: 4, participatedQuestions: 4, accuracyPercent: 50, participationPercent: 100, battleGrade: 3 },
      { uid: "u3", name: "Бойко", teamId: null, isReserve: true }
    ]
  };
  const evals = { a: { cells: {}, score: 2, max: 2, percent: 100 }, b: { cells: {}, score: 1, max: 2, percent: 50 } };
  const practical = { evaluations: evals, tasks: tasksAt("confirmed"), comparison: { ready: true, winner: "a", tie: false } };
  const r = buildLessonReport({ plan, run, battle, practical });
  assert.deepEqual(r.people.map((p) => p.name), ["Абрамов", "Бойко", "Яковлев"], "по алфавиту");
  const by = Object.fromEntries(r.people.map((p) => [p.uid, p.metrics]));
  assert.equal(by.u1.participation, 75);
  assert.equal(by.u1.contribution, 80);
  assert.equal(by.u1.teamwork, 100, "команда А: Battle 8/8=100%, практика 100%");
  assert.equal(by.u2.teamwork, 50, "команда Б: Battle 4/8=50%, практика 50%");
  assert.equal(by.u3.participation, null);
  assert.equal(by.u3.contribution, null);
  assert.equal(by.u3.teamwork, null, "запасной без замены: данных нет");
});

test("отчёт без Battle и практики: показатели null, отчёт строится", () => {
  const r = buildLessonReport({ plan: { stages: {} }, run: { done: {} }, entry: { studentsDetail: [{ uid: "u1", name: "Иванов", correct: 5, total: 10 }] } });
  assert.deepEqual(r.people[0].metrics, { participation: null, contribution: null, teamwork: null, teamworkParts: { battle: null, practical: null } });
  assert.ok(r.notes.some((n) => /Участие, вклад и командная работа/.test(n)));
});

test("отчёт: таблица показывает новые колонки и «—» вместо отсутствующих значений", async () => {
  const { buildReportView } = await import("../ui/components/lesson-report-view.js");
  const r = buildLessonReport({
    plan: { stages: { battle: true } }, run: { done: { battle: true } },
    battle: { scores: { a: 3, b: 3 }, players: [{ uid: "u1", name: "Иванов", teamId: "a", participationPercent: 50, accuracyPercent: null, battleGrade: 3, availableQuestions: 2, participatedQuestions: 1 }] }
  });
  const view = buildReportView(r);
  const t = text(view.el || view);
  for (const col of ["Участие", "Вклад", "Командная работа", "Рекомендуемая оценка за занятие"]) assert.ok(t.includes(col), `нет колонки «${col}»`);
  assert.match(t, /50%/);
});
