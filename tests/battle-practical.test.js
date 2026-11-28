// tests/battle-practical.test.js — таблица после Battle: проверка команды,
// очки один раз, итог с практикой, хранение без вложенных массивов, правила набора.
// Реальный Firestore и несколько клиентов здесь не проверяются (контроллер
// работает на подставных зависимостях).
import test from "node:test";
import assert from "node:assert/strict";
import {
  practicalEnabled, practicalScoresOf, totalScores, checkTeamTable, practicalPatch, withPatch,
  practicalLine, createHostController
} from "../core/battle-practical.js";
import { publicTask, taskKeys, encodeTask, decodeTask, normalizeTask } from "../core/practical.js";
import {
  emptyBattleSet, normalizeBattleSet, validateBattleSet, validateTables, hasTables, isEmptySet, toStoredSet
} from "../core/battle-set.js";

const label = (text) => ({ t: "label", text });
const ans = (accept, extra = {}) => ({ t: "answer", mode: "text", accept, points: 1, ...extra });
const table = (title = "Узлы") => ({
  title, description: "",
  columns: ["Узел", "Значение", "Единица"],
  rows: [
    [label("Давление"), ans(["5"], { mode: "number", points: 2 }), ans(["бар"])],
    [label("Ток"), ans(["120"], { mode: "number", points: 3 }), ans(["а", "A"])]
  ]
});
const pub = publicTask(table());
const keys = taskKeys(table());

// ---------- проверка ----------

test("проверка: верные ячейки дают очки, неверные нет, итог считается по баллам", () => {
  const ev = checkTeamTable({ task: pub, keys, submission: { cells: { r0c1: "5", r0c2: "бар", r1c1: "99", r1c2: "A" } } });
  assert.equal(ev.cells.r0c1.ok, true);
  assert.equal(ev.cells.r1c1.ok, false);
  assert.equal(ev.score, 2 + 1 + 1); // 2 за давление, 1 за «бар», 1 за «A»
  assert.equal(ev.max, 2 + 1 + 3 + 1);
  assert.equal(ev.complete, true);
});

test("проверка: пустая таблица — ноль очков", () => {
  const ev = checkTeamTable({ task: pub, keys, submission: { cells: {} } });
  assert.equal(ev.score, 0);
});

// ---------- очки ----------

test("очки практики прибавляются к счёту команды, а очки Battle не меняются", () => {
  const battle = { scores: { a: 4, b: 3 } };
  const ev = { score: 3, max: 7, percent: 42.86 };
  const patch = practicalPatch(battle, "a", ev);
  const next = withPatch(battle, patch);
  assert.deepEqual(next.scores, { a: 4, b: 3 }, "Battle-счёт не тронут");
  assert.deepEqual(practicalScoresOf(next), { a: 3, b: 0 });
  assert.deepEqual(totalScores(next), { a: 7, b: 3 });
});

test("очки начисляются один раз: повторная проверка той же команды патча не даёт", () => {
  const ev = { score: 3, max: 7, percent: 43 };
  const first = practicalPatch({ scores: { a: 1, b: 1 } }, "a", ev);
  const after = withPatch({ scores: { a: 1, b: 1 } }, first);
  assert.equal(practicalPatch(after, "a", ev), null);
  assert.equal(practicalPatch(after, "a", { ...ev, score: 7 }), null, "даже другой результат не удваивает");
  assert.deepEqual(practicalScoresOf(after), { a: 3, b: 0 });
});

test("обе команды: очки считаются отдельно для каждой", () => {
  let battle = { scores: { a: 2, b: 5 } };
  battle = withPatch(battle, practicalPatch(battle, "a", { score: 4, max: 7, percent: 57 }));
  battle = withPatch(battle, practicalPatch(battle, "b", { score: 6, max: 7, percent: 86 }));
  assert.deepEqual(totalScores(battle), { a: 6, b: 11 });
  assert.equal(practicalLine(battle).done, true);
  assert.equal(practicalLine(battle).a, "4 из 7");
});

test("флаг practical.enabled и пустые данные не ломают расчёты", () => {
  assert.equal(practicalEnabled({ practical: { enabled: true } }), true);
  assert.equal(practicalEnabled({}), false);
  assert.deepEqual(totalScores({}), { a: 0, b: 0 });
  assert.equal(practicalPatch({}, "x", { score: 1 }), null);
  assert.equal(practicalPatch({}, "a", null), null);
});

// ---------- контроллер ведущего ----------

function makeDeps() {
  const calls = { setup: 0, status: [], confirm: [], final: 0, patches: [] };
  const deps = {
    setup: async () => { calls.setup++; },
    taskStatus: async (c, team) => (calls.statuses?.[team] ?? "draft"),
    setStatus: async (c, team, st) => { calls.status.push([team, st]); },
    loadKeys: async () => keys,
    confirmTeam: async (c, team, ev) => { calls.confirm.push([team, ev.score]); },
    saveFinal: async () => { calls.final++; },
    patchBattle: async (p) => { calls.patches.push(p); }
  };
  return { deps, calls };
}
const submitted = (cells) => ({ status: "submitted", cells });
const tasks = (status = "open") => ({ a: { ...pub, status }, b: { ...pub, status } });

test("контроллер: подготовка идемпотентна, задания открываются", async () => {
  const { deps, calls } = makeDeps();
  const ctl = createHostController({ code: "ABC123", tables: { a: table(), b: table() }, deps });
  await ctl.start(); await ctl.start();
  assert.equal(calls.setup, 1);
  assert.deepEqual(calls.status, [["a", "open"], ["b", "open"]]);
});

test("контроллер: после перезагрузки проверенное и открытое задание заново не открывается", async () => {
  const { deps, calls } = makeDeps();
  calls.statuses = { a: "confirmed", b: "open" };
  const ctl = createHostController({ code: "ABC123", tables: { a: table(), b: table() }, deps });
  await ctl.start();
  assert.deepEqual(calls.status, [], "статусы не трогаются");
});

test("контроллер: отправленная таблица проверяется, очки пишутся один раз, команде показывается итог", async () => {
  const { deps, calls } = makeDeps();
  const ctl = createHostController({ code: "ABC123", tables: {}, deps });
  const state = { battle: { scores: { a: 3, b: 2 } }, tasks: tasks(), submissions: { a: submitted({ r0c1: "5", r0c2: "бар", r1c1: "120", r1c2: "A" }) } };
  await ctl.process(state);
  assert.equal(calls.patches.length, 1);
  assert.equal(calls.patches[0].practicalScores.a, 7);
  assert.deepEqual(calls.confirm, [["a", 7]]);
  // повторное событие с теми же данными (снимок пришёл ещё раз)
  await ctl.process({ ...state, battle: { ...state.battle, ...calls.patches[0] } });
  assert.equal(calls.patches.length, 1, "очки не дублируются");
  assert.equal(calls.confirm.length, 1, "результат команде записан один раз");
});

test("контроллер: неотправленная таблица не проверяется", async () => {
  const { deps, calls } = makeDeps();
  const ctl = createHostController({ code: "ABC123", tables: {}, deps });
  await ctl.process({ battle: {}, tasks: tasks(), submissions: { a: { status: "draft", cells: { r0c1: "5" } } } });
  assert.equal(calls.patches.length, 0);
  assert.equal(calls.confirm.length, 0);
});

test("контроллер: неверные ответы очков не дают, но результат показывается", async () => {
  const { deps, calls } = makeDeps();
  const ctl = createHostController({ code: "ABC123", tables: {}, deps });
  await ctl.process({ battle: { scores: { a: 1, b: 1 } }, tasks: tasks(), submissions: { a: submitted({ r0c1: "1", r0c2: "x", r1c1: "2", r1c2: "y" }) } });
  assert.equal(calls.patches[0].practicalScores.a, 0);
  assert.equal(calls.confirm.length, 1);
});

test("контроллер: после сбоя записи результата очки не удваиваются при повторе", async () => {
  const { deps, calls } = makeDeps();
  let fail = true;
  deps.confirmTeam = async (c, team, ev) => { if (fail) throw new Error("сеть"); calls.confirm.push([team, ev.score]); };
  const ctl = createHostController({ code: "ABC123", tables: {}, deps });
  const state = { battle: { scores: { a: 0, b: 0 } }, tasks: tasks(), submissions: { a: submitted({ r0c1: "5", r0c2: "бар", r1c1: "120", r1c2: "A" }) } };
  await assert.rejects(() => ctl.process(state), /сеть/);
  assert.equal(calls.patches.length, 1, "очки записаны до сбоя");
  fail = false;
  await ctl.process({ ...state, battle: { ...state.battle, ...calls.patches[0] } });
  assert.equal(calls.patches.length, 1, "второй раз очки не пишутся");
  assert.equal(calls.confirm.length, 1, "результат команде записан после повтора");
});

test("контроллер: итог для отчёта записывается один раз, когда проверены обе команды", async () => {
  const { deps, calls } = makeDeps();
  const ctl = createHostController({ code: "ABC123", tables: {}, deps });
  const all = { r0c1: "5", r0c2: "бар", r1c1: "120", r1c2: "A" };
  let battle = { scores: { a: 1, b: 1 } };
  const state = () => ({ battle, tasks: tasks(), submissions: { a: submitted(all), b: submitted({ r0c1: "5", r0c2: "бар", r1c1: "1", r1c2: "x" }) } });
  await ctl.process(state());
  for (const p of calls.patches) battle = { ...battle, ...p };
  await ctl.process(state());
  assert.equal(calls.final, 1);
  assert.equal(ctl.isFinalSaved(), true);
});

// ---------- хранение ----------

test("строки таблицы кодируются без массива в массиве и читаются обратно", () => {
  const stored = encodeTask(table());
  assert.ok(stored.rows.every((r) => !Array.isArray(r)), "в базе строка — не массив");
  assert.ok(Array.isArray(stored.rows[0].c));
  assert.deepEqual(decodeTask(stored).rows, table().rows);
  assert.deepEqual(decodeTask(decodeTask(stored)).rows, table().rows, "повторное чтение безопасно");
  assert.deepEqual(normalizeTask(stored).rows.length, 2, "normalizeTask читает и кодированные строки");
});

test("набор: таблицы сохраняются кодированными и читаются в обычном виде", () => {
  const set = { ...emptyBattleSet(), tables: { a: table("А"), b: table("Б") } };
  const stored = toStoredSet(set);
  assert.ok(stored.tables.a.rows.every((r) => !Array.isArray(r)));
  const back = normalizeBattleSet(stored);
  assert.equal(back.tables.a.title, "А");
  assert.equal(back.tables.b.rows.length, 2);
  assert.ok(Array.isArray(back.tables.b.rows[0]));
});

// ---------- правила набора ----------

test("набор: старый набор без таблиц читается и остаётся валидным", () => {
  const old = { version: 1, main: { questions: [] }, placeTies: {} };
  const s = normalizeBattleSet(old);
  assert.deepEqual(s.tables, { a: null, b: null });
  assert.deepEqual(validateBattleSet(old), []);
  assert.equal(hasTables(old), false);
});

test("набор: таблица нужна обеим командам, ручная проверка недоступна", () => {
  assert.deepEqual(validateTables({ a: null, b: null }), []);
  assert.match(validateTables({ a: table(), b: null }).join(" "), /обеих команд/);
  const manual = table(); manual.rows[0][1] = { t: "answer", mode: "manual", accept: [], points: 1 };
  assert.match(validateTables({ a: table(), b: manual }).join(" "), /вручную/);
  assert.deepEqual(validateTables({ a: table(), b: table("Б") }), []);
  assert.equal(hasTables({ tables: { a: table(), b: table() } }), true);
});

test("набор: пустой ответ в таблице — понятная ошибка, а набор с одной таблицей не пустой", () => {
  const bad = table(); bad.rows[0][1] = { t: "answer", mode: "text", accept: [], points: 1 };
  assert.ok(validateTables({ a: bad, b: table() }).length > 0);
  assert.equal(isEmptySet({ tables: { a: table(), b: table() } }), false);
  assert.equal(isEmptySet(emptyBattleSet()), true);
});
