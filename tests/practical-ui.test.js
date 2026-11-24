// tests/practical-ui.test.js — экраны практики: капитан, участник, проектор, преподаватель.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom, findAll, findOne, text } from "./helpers/fake-dom.js";

installFakeDom();
const { buildPracticalPlayer, buildPracticalScreen, buildPracticalHost, renderTable } = await import("../ui/components/practical.js");
const { splitTask } = await import("../core/practical.js");

const L = (t) => ({ t: "label", text: t });
const A = (mode, accept, extra = {}) => ({ t: "answer", mode, accept, ...extra });
const TASK = {
  title: "Диагностика датчика", description: "Заполните таблицу.", columns: ["Параметр", "Значение"],
  rows: [[L("Номер датчика"), A("number", ["4"])], [L("Неисправность"), A("text", ["обрыв цепи"])], [L("Действие"), A("manual", [])]]
};
const { publicTask: PUB, keys: KEYS } = splitTask(TASK);
const taskDoc = (status, extra = {}) => ({ team: "a", ...PUB, status, ...extra });

// Ручные таймеры.
function timers() {
  let id = 0; const q = [];
  return { schedule: (fn) => { id += 1; q.push({ id, fn }); return id; }, clear: (i) => { const k = q.findIndex(x => x.id === i); if (k >= 0) q.splice(k, 1); }, run() { while (q.length) q.shift().fn(); }, size: () => q.length };
}
const inputs = (root) => findAll(root, e => e.tag === "input");
const btn = (root, action) => findOne(root, e => e.tag === "button" && e.getAttribute("data-action") === action);

// ---------- капитан ----------

function captainRig(over = {}) {
  const tm = timers();
  const calls = { saveDraft: [], submit: [] };
  const api = { saveDraft: async (c) => { calls.saveDraft.push({ ...c }); }, submit: async (c) => { calls.submit.push({ ...c }); } };
  const view = buildPracticalPlayer({ api, getMe: () => ({ team: "a", isCaptain: true }), confirmSubmit: () => true, schedule: tm.schedule, clear: tm.clear, ...over });
  return { view, calls, tm };
}

test("капитан: пока задание не открыто, таблицы нет", () => {
  const { view } = captainRig();
  view.update({ task: null, submission: null });
  assert.match(text(view.el), /Задание появится/);
  view.update({ task: taskDoc("draft"), submission: null });
  assert.equal(inputs(view.el).length, 0);
});

test("капитан: открытое задание — таблица с полями только для ячеек-ответов", () => {
  const { view } = captainRig();
  view.update({ task: taskDoc("open"), submission: null });
  assert.equal(inputs(view.el).length, 3, "три ячейки для ответа");
  assert.match(text(view.el), /Номер датчика/);
  assert.match(text(view.el), /Диагностика датчика/);
  assert.ok(!/обрыв цепи/.test(text(view.el)), "ожидаемого ответа на экране нет");
  assert.ok(btn(view.el, "submit") && btn(view.el, "save"));
});

test("капитан: ввод → автосохранение черновика одним отложенным вызовом", async () => {
  const { view, calls, tm } = captainRig();
  view.update({ task: taskDoc("open"), submission: null });
  const [first] = inputs(view.el);
  for (const v of ["1", "12", "123"]) { first.value = v; first.dispatch("input"); }
  assert.equal(tm.size(), 1, "серия нажатий — один таймер");
  assert.equal(view.isDirty(), true);
  tm.run();
  await new Promise(r => setImmediate(r));
  assert.equal(calls.saveDraft.length, 1);
  assert.equal(calls.saveDraft[0].r0c1, "123");
  assert.match(text(view.el), /Черновик сохранён/);
});

test("капитан: обновление снимка не затирает набираемый текст и не пересоздаёт поля", () => {
  const { view } = captainRig();
  view.update({ task: taskDoc("open"), submission: null });
  const [first] = inputs(view.el);
  first.value = "мой ответ"; first.dispatch("input");
  view.update({ task: taskDoc("open"), submission: { status: "draft", cells: { r0c1: "старое" } } });
  assert.strictEqual(inputs(view.el)[0], first, "тот же элемент — фокус не теряется");
  assert.equal(first.value, "мой ответ");
});

test("капитан: отправка один раз (двойной клик), затем таблица заморожена", async () => {
  const { view, calls } = captainRig();
  view.update({ task: taskDoc("open"), submission: null });
  const [a, b] = inputs(view.el);
  a.value = "4"; a.dispatch("input"); b.value = "обрыв цепи"; b.dispatch("input");
  const send = btn(view.el, "submit");
  send.click(); send.click();
  await new Promise(r => setImmediate(r));
  assert.equal(calls.submit.length, 1, "повторное нажатие не отправляет вторично");
  assert.deepEqual(calls.submit[0], { r0c1: "4", r1c1: "обрыв цепи" });
  view.update({ task: taskDoc("open"), submission: { status: "submitted", cells: calls.submit[0] } });
  assert.equal(inputs(view.el).length, 0, "после отправки полей ввода нет");
  assert.match(text(view.el), /отправлена и зафиксирована/);
});

test("капитан: отказ в подтверждении — таблица не отправляется", async () => {
  const { view, calls } = captainRig({ confirmSubmit: () => false });
  view.update({ task: taskDoc("open"), submission: null });
  btn(view.el, "submit").click();
  await new Promise(r => setImmediate(r));
  assert.equal(calls.submit.length, 0);
});

test("капитан: ошибка записи показывается понятной фразой, а не кодом", async () => {
  const tm = timers();
  const view = buildPracticalPlayer({
    api: { saveDraft: async () => { const e = new Error("x"); e.code = "permission-denied"; throw e; }, submit: async () => {} },
    getMe: () => ({ team: "a", isCaptain: true }), confirmSubmit: () => true, schedule: tm.schedule, clear: tm.clear
  });
  view.update({ task: taskDoc("open"), submission: null });
  await view.flush();
  assert.match(text(view.el), /задание закрыто или таблица уже отправлена/);
  assert.ok(!/permission-denied/.test(text(view.el)));
});

// ---------- участник ----------

test("участник (не капитан): только чтение, видит ответы капитана", () => {
  const view = buildPracticalPlayer({ api: {}, getMe: () => ({ team: "a", isCaptain: false }) });
  view.update({ task: taskDoc("open"), submission: { status: "draft", cells: { r0c1: "4" } } });
  assert.equal(inputs(view.el).length, 0);
  assert.match(text(view.el), /Таблицу заполняет капитан/);
  view.update({ task: taskDoc("open"), submission: { status: "draft", cells: { r0c1: "5" } } });
  assert.match(text(findOne(view.el, e => e.getAttribute && e.getAttribute("data-cell") === "r0c1")), /5/, "ответ обновился на месте");
});

test("участник без команды видит пояснение, а не пустой экран", () => {
  const view = buildPracticalPlayer({ api: {}, getMe: () => ({ team: null }) });
  view.update({ task: taskDoc("open"), submission: null });
  assert.match(text(view.el), /не в команде/);
});

test("итог: верно/неверно по ячейкам и объявление результата (победа, поражение, ничья)", () => {
  const result = (winner) => ({ score: 2, max: 3, percent: 66.67, winner, cells: { r0c1: true, r1c1: false, r2c1: true } });
  for (const [winner, outcome, phrase] of [["a", "win", /Ваша команда победила/], ["b", "lose", /победила другая/], ["tie", "tie", /Ничья/]]) {
    const view = buildPracticalPlayer({ api: {}, getMe: () => ({ team: "a", isCaptain: true }) });
    view.update({ task: taskDoc("confirmed", { result: result(winner) }), submission: { status: "submitted", cells: { r0c1: "4", r1c1: "x", r2c1: "y" } } });
    const fin = findOne(view.el, e => e.getAttribute && e.getAttribute("data-outcome"));
    assert.equal(fin.getAttribute("data-outcome"), outcome);
    assert.match(text(fin), phrase);
    assert.match(text(fin), /2 из 3/);
    assert.equal(findAll(view.el, e => e.getAttribute && e.getAttribute("data-ok") === "1").length, 2);
    assert.equal(findAll(view.el, e => e.getAttribute && e.getAttribute("data-ok") === "0").length, 1);
    assert.match(text(view.el), /✗ неверно/, "значок, а не только цвет");
  }
});

// ---------- проектор ----------

test("проектор: до подтверждения — только статусы, без ответов; после — победитель", () => {
  const screen = buildPracticalScreen();
  screen.update({ tasks: { a: taskDoc("open"), b: { ...taskDoc("open"), team: "b", title: "Другое задание" } }, submissions: { a: { status: "submitted", cells: { r0c1: "СЕКРЕТНЫЙ ОТВЕТ" } }, b: { status: "draft", cells: {} } } });
  assert.match(text(screen.el), /Отправлено/);
  assert.match(text(screen.el), /Заполняет/);
  assert.ok(!/СЕКРЕТНЫЙ ОТВЕТ/.test(text(screen.el)), "ответы команд на проекторе не показываются");
  const r = (winner, percent) => ({ score: 1, max: 2, percent, winner, cells: {} });
  screen.update({ tasks: { a: taskDoc("confirmed", { result: r("a", 80) }), b: { ...taskDoc("confirmed", { result: r("a", 50) }), team: "b" } }, submissions: {} });
  assert.match(text(screen.el), /Победила Команда А/);
  screen.update({ tasks: { a: taskDoc("confirmed", { result: r("tie", 50) }), b: { ...taskDoc("confirmed", { result: r("tie", 50) }), team: "b" } }, submissions: {} });
  assert.match(text(screen.el), /Ничья/);
  assert.ok(!/Победила/.test(text(screen.el)));
});

// ---------- преподаватель ----------

function hostRig(extra = {}) {
  const calls = { setup: 0, status: [], keys: [], saveReview: [], confirm: [], back: [] };
  const api = {
    setup: async () => { calls.setup += 1; },
    setStatus: async (t, s) => { calls.status.push([t, s]); },
    loadKeys: async (t) => { calls.keys.push(t); return KEYS; },
    loadReview: async () => ({}),
    saveReview: async (o) => { calls.saveReview.push(JSON.parse(JSON.stringify(o))); },
    returnForRevision: async (t) => { calls.back.push(t); },
    confirm: async (x) => { calls.confirm.push(x); },
    ...extra
  };
  const view = buildPracticalHost({ api, confirmAction: () => true });
  return { view, calls };
}
const settle = () => new Promise(r => setImmediate(r));
const both = (aCells, bCells) => ({
  tasks: { a: taskDoc("open"), b: { ...taskDoc("open"), team: "b" } },
  submissions: { a: { status: "submitted", cells: aCells }, b: { status: "submitted", cells: bCells } }
});

test("ведущий: подготовка и открытие заданий — одной кнопкой, без дублей при повторном нажатии", async () => {
  const { view, calls } = hostRig();
  view.update({ tasks: {}, submissions: {} });
  const setup = btn(view.el, "setup");
  setup.click(); setup.click();
  await settle();
  assert.equal(calls.setup, 1);
  assert.deepEqual(calls.status, [["a", "open"], ["b", "open"]]);
});

test("ведущий: «Определить результат» недоступно, пока не отправили обе команды", () => {
  const { view } = hostRig();
  view.update({ tasks: { a: taskDoc("open"), b: { ...taskDoc("open"), team: "b" } }, submissions: { a: { status: "submitted", cells: {} }, b: { status: "draft", cells: {} } } });
  assert.equal(btn(view.el, "determine").disabled, true);
  assert.match(text(view.el), /обе команды отправят/);
  assert.match(text(view.el), /Таблица отправлена/);
});

test("ведущий: проверка по ключам, ожидаемые ответы видны только ему, ручная ячейка ждёт решения", async () => {
  const { view, calls } = hostRig();
  view.update(both({ r0c1: "4", r1c1: "обрыв цепи", r2c1: "заменить" }, { r0c1: "5", r1c1: "?", r2c1: "" }));
  btn(view.el, "determine").click();
  await settle();
  assert.deepEqual(calls.keys, ["a", "b"]);
  const t = text(view.el);
  assert.match(t, /Ожидается: обрыв цепи/);
  assert.match(t, /Ожидается: проверяет преподаватель/);
  assert.match(t, /Команда А: 2 из 3/);
  assert.match(t, /Ждут вашей проверки: 1/);
  assert.equal(btn(view.el, "confirm").disabled, true, "пока есть непроверенная вручную ячейка, подтвердить нельзя");
});

test("ведущий: решение по спорной ячейке пересчитывает баллы и сохраняется сразу", async () => {
  const { view, calls } = hostRig();
  view.update(both({ r0c1: "4", r1c1: "обрыв цепи", r2c1: "заменить" }, { r0c1: "5", r1c1: "x", r2c1: "y" }));
  btn(view.el, "determine").click();
  await settle();
  const decide = (label, id) => findOne(view.el, e => e.tag === "button" && e.getAttribute("aria-label") === `${label}: ${id}`);
  // Команда А: засчитать ручную ячейку.
  findAll(view.el, e => e.tag === "button" && e.getAttribute("aria-label") === "Верно: r2c1")[0].click();
  assert.equal(calls.saveReview.length, 1, "решение записано сразу — перезагрузка его не потеряет");
  assert.equal(calls.saveReview[0].a.r2c1, true);
  assert.match(text(view.el), /Команда А: 3 из 3 \(100%\)/);
  // Команде Б тоже закрыть ручную ячейку (неверно).
  findAll(view.el, e => e.tag === "button" && e.getAttribute("aria-label") === "Неверно: r2c1")[1].click();
  assert.equal(btn(view.el, "confirm").disabled, false);
  assert.match(text(view.el), /Побеждает Команда А/);
  assert.ok(decide("Авто", "r2c1"));
});

test("ведущий: ничья при равном проценте; подтверждение вызывается один раз", async () => {
  const { view, calls } = hostRig();
  view.update(both({ r0c1: "4", r1c1: "обрыв цепи", r2c1: "заменить" }, { r0c1: "4", r1c1: "обрыв цепи", r2c1: "заменить" }));
  btn(view.el, "determine").click();
  await settle();
  for (const b of findAll(view.el, e => e.tag === "button" && e.getAttribute("aria-label") === "Верно: r2c1")) b.click();
  assert.match(text(view.el), /Ничья/);
  assert.ok(!/Побеждает/.test(text(view.el)));
  const confirm = btn(view.el, "confirm");
  confirm.click(); confirm.click();
  await settle();
  assert.equal(calls.confirm.length, 1, "двойной клик подтверждает один раз");
  assert.equal(calls.confirm[0].comparison.tie, true);
  assert.equal(calls.confirm[0].evaluations.a.percent, 100);
});

test("ведущий: после подтверждения результат зафиксирован и повторно не определяется", () => {
  const { view } = hostRig();
  const r = (w, p) => ({ score: 1, max: 1, percent: p, winner: w, cells: {} });
  view.update({
    tasks: { a: taskDoc("confirmed", { result: r("a", 100) }), b: { ...taskDoc("confirmed", { result: r("a", 40) }), team: "b" } },
    submissions: { a: { status: "submitted", cells: {} }, b: { status: "submitted", cells: {} } }
  });
  assert.match(text(view.el), /Результат подтверждён/);
  assert.match(text(view.el), /Победила Команда А/);
  assert.equal(btn(view.el, "determine"), null);
  assert.equal(btn(view.el, "return-a"), null, "вернуть на доработку после подтверждения нельзя");
});

test("ведущий: вернуть таблицу на доработку; ошибка — понятной фразой", async () => {
  const { view, calls } = hostRig({ returnForRevision: async () => { const e = new Error("x"); e.code = "permission-denied"; throw e; } });
  view.update(both({}, {}));
  btn(view.el, "return-a").click();
  await settle();
  assert.match(text(view.el), /Нет прав на это действие/);
  assert.deepEqual(calls.back, []);
});

test("таблица: заголовки строк — th, ответы — поля; mobile-обёртка с прокруткой внутри", () => {
  const t = renderTable(PUB, { editable: true });
  assert.equal(t.el.className, "pr-table-wrap");
  assert.equal(findAll(t.el, e => e.tag === "th" && e.getAttribute("scope") === "row").length, 3);
  assert.equal(Object.keys(t.inputs).length, 3);
});

test("ведущий: видит прогресс заполнения и черновик до отправки", () => {
  const { view } = hostRig();
  view.update({
    tasks: { a: taskDoc("open"), b: { ...taskDoc("open"), team: "b" } },
    submissions: { a: { status: "draft", cells: { r0c1: "4", r1c1: "  ", r2c1: "заменить" } } }
  });
  const progress = findAll(view.el, e => e.className === "pr-progress");
  assert.equal(progress.length, 2);
  assert.match(text(progress[0]), /Заполнено ячеек: 2 из 3/, "пустые и из одних пробелов не считаются");
  assert.match(text(progress[1]), /Заполнено ячеек: 0 из 3/);
  const draft = findAll(view.el, e => e.className === "pr-draft");
  assert.equal(draft.length, 1, "у команды без ответов черновика нет");
  assert.match(text(draft[0]), /Посмотреть черновик/);
  assert.match(text(draft[0]), /заменить/);
  assert.equal(findAll(draft[0], e => e.tag === "input").length, 0, "черновик только для чтения");
  view.update({
    tasks: { a: taskDoc("open"), b: { ...taskDoc("open"), team: "b" } },
    submissions: { a: { status: "submitted", cells: { r0c1: "4" } } }
  });
  assert.match(text(findAll(view.el, e => e.className === "pr-draft")[0]), /Посмотреть отправленную таблицу/);
});
