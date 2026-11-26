// tests/battle-summary.test.js — завершение Battle: счёт, итоговая таблица,
// снимок и история. Игра и хранилище — в памяти; реальная синхронизация клиентов
// и правила Firestore здесь НЕ проверяются.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import * as L from "../core/battle-logic.js";
import { BattleGame } from "../core/battle-game.js";
import { buildBattleSnapshot, readBattleSnapshot, BATTLE_SNAPSHOT_VERSION } from "../core/battle-snapshot.js";
import { buildBattleSummary, formatScore, scoreLine, outcomeOf } from "../core/battle-summary.js";
import { animateNumber } from "../ui/components/battle-fx.js";
import { battleSummaryView } from "../ui/components/battle-summary-view.js";
import { installFakeDom, text, findAll } from "./helpers/fake-dom.js";

installFakeDom();
// core/battle.js тянет Firebase SDK по https: подменяем слой доступа заглушками.
register("./helpers/stub-loader.mjs", import.meta.url);
const { attachBattleToHistory } = await import("../core/battle.js");

const NAMES = ["Яковлев Пётр", "Ёлкин Иван", "Абрамов Олег", "Егоров Сергей", "Зайцева Мария", "Бойко Анна", "Нестеров Глеб", "Орлов Денис", "Иванов Илья"];
const ids = NAMES.map((_, i) => "u" + (i + 1));
const nameOf = (u) => NAMES[ids.indexOf(u)] || u;
const liveInfo = Object.fromEntries(ids.map((u, i) => [u, { name: NAMES[i], place: i + 1, score: 10 - i, liveGrade: 70 }]));

function setup({ questions } = {}) {
  const { settings } = L.normalizeSettings({ questionSeconds: 30 });
  const roster = L.buildRoster({ memberIds: ids, captains: { a: "u1", b: "u2" }, rng: L.createSeededRng(3) }).roster;
  const saved = [], rounds = [], choices = {}, votes = {};
  let clock = 1000;
  const store = {
    saveBattle: async (p) => { saved.push(JSON.parse(JSON.stringify(p))); },
    saveRound: async (r) => { rounds.push(JSON.parse(JSON.stringify(r))); },
    savePlayerFields: async () => {},
    readVotes: async (i) => votes[i] || {}, readChoices: async (i) => choices[i] || {}, readDecisions: async () => ({}),
    logEvent: async () => {}
  };
  const qs = questions || [
    { id: "q0", type: "single", optionCount: 3, correct: [1] },
    { id: "q1", type: "single", optionCount: 3, correct: [0] },
    { id: "q2", type: "single", optionCount: 3, correct: [2] }
  ];
  const game = new BattleGame({ settings, roster, questions: qs, liveInfo, store, now: () => clock });
  return { game, saved, rounds, choices, votes, roster, tick: (ms) => { clock += ms; } };
}

// Играет вопрос: капитан A отвечает правильно сам, капитан B — неверно.
async function playRound(env, index, correct) {
  await env.game.startNextQuestion();
  env.choices[index] = { a: { mode: "self", selected: [correct] }, b: { mode: "self", selected: [(correct + 1) % 3] } };
  await env.game.syncCaptainChoices();
  await env.game.closeRound();
}

// ---------- 1. Таблица ----------

test("таблица: участники по алфавиту (кириллица, Ё), «—» вместо отсутствующих данных, сводка команд", async () => {
  const env = setup();
  await playRound(env, 0, 1);
  await playRound(env, 1, 0);
  await env.game.finish();
  const battle = env.saved.at(-1);
  const s = buildBattleSummary({ battle, nameOf });
  const names = s.players.map((p) => p.name);
  assert.deepEqual(names, [...names].sort((x, y) => x.localeCompare(y, "ru")), "порядок как у localeCompare ru");
  assert.equal(names[0], "Абрамов Олег");
  assert.ok(names.indexOf("Егоров Сергей") < names.indexOf("Ёлкин Иван"), "Е идёт перед Ё");
  assert.equal(s.players.length, 9);
  // Личного участия в публичном документе нет → null (в таблице «—»), а не 0.
  assert.ok(s.players.every((p) => p.participated === null && p.participationPercent === null));
  assert.equal(s.hasPersonal, false);
  // Сводка: команда A отвечала верно оба раза.
  assert.equal(s.teams.a.correctAnswers, 2);
  assert.equal(s.teams.b.correctAnswers, 0);
  assert.equal(s.teams.a.points, battle.scores.a);
  assert.equal(s.teams.a.rounds, 2);
  assert.equal(s.questions.byTeam.a.correct, 2);
  assert.equal(s.questions.byTeam.b.wrong, 2);
  assert.equal(s.questions.byTeam.a.tiebreak, null, "споры в публичном документе не записаны → «—»");
  assert.equal(s.outcome.winnerId, "a");
  const view = text(battleSummaryView(s));
  assert.match(view, /Победила Команда А/);
  assert.match(view, /—/);
  assert.match(view, /Участники \(9\) — по алфавиту/);
});

test("таблица: роли, замена и выбывание; верные ответы команды — только за вопросы, где игрок был в игре", async () => {
  const env = setup();
  await playRound(env, 0, 1);
  const teamA = env.roster.teams.a.filter((u) => u !== "u1");
  const out = teamA[0];
  assert.equal(await env.game.eliminate(out), true, "игрок выбыл");
  await playRound(env, 1, 0);
  await env.game.finish();
  const s = buildBattleSummary({ battle: env.saved.at(-1), nameOf });
  const row = (uid) => s.players.find((p) => p.uid === uid);
  assert.equal(row("u1").role, "captain");
  assert.equal(row("u1").teamCorrect, 2);
  assert.equal(row(out).role, "eliminated");
  assert.equal(row(out).teamCorrect, 1, "после выбывания его вопросы не считаются");
});

test("исход: победитель и ничья", () => {
  assert.equal(outcomeOf({ phase: "finished", winner: "b" }).text, "Победила Команда Б");
  assert.equal(outcomeOf({ phase: "finished", winner: null, tie: true }).text, "Ничья");
  assert.equal(outcomeOf({ phase: "finished", winner: "a", finishedEarly: true }).text, "Победила Команда А (досрочно)");
  assert.equal(outcomeOf({ phase: "voting" }).finished, false);
  const tie = buildBattleSummary({ battle: { phase: "finished", tie: true, scores: { a: 5, b: 5 }, teams: { a: ["u1"], b: ["u2"] }, captains: {}, roundSummaries: [] }, nameOf });
  assert.equal(tie.outcome.tie, true);
  assert.equal(tie.outcome.winnerId, null);
});

test("таблица: нет данных → null и заглушка «Итоговая таблица не сохранена»", () => {
  assert.equal(buildBattleSummary({ battle: null }), null);
  assert.equal(buildBattleSummary({ battle: { version: 1 } }), null);
  assert.match(text(battleSummaryView(null)), /Итоговая таблица не сохранена/);
});

// ---------- 2. Досрочное завершение ----------

test("досрочное завершение: счёт = сумме закрытых раундов, незакрытый вопрос не засчитан", async () => {
  const env = setup();
  await playRound(env, 0, 1);
  const before = { ...env.game.state.scores };
  await env.game.startNextQuestion(); // вопрос открыт, но не закрыт
  env.choices[1] = { a: { mode: "self", selected: [0] } };
  await env.game.syncCaptainChoices();
  await env.game.finish({ early: true });
  const state = env.game.state;
  assert.equal(state.phase, "finished");
  assert.equal(state.finishedEarly, true);
  assert.deepEqual(state.scores, before, "очки открытого вопроса не начислены");
  const sum = (id) => Math.round(state.rounds.reduce((acc, r) => acc + r.teams[id].points.total, 0) * 100) / 100;
  assert.equal(state.scores.a, sum("a"));
  assert.equal(state.scores.b, sum("b"));
  assert.equal(state.rounds.length, 1, "в историю попал только закрытый раунд");
  const pub = env.saved.at(-1);
  assert.equal(pub.finishedEarly, true);
  const s = buildBattleSummary({ battle: pub, nameOf });
  assert.equal(s.outcome.early, true);
  assert.equal(s.score.text, scoreLine(pub).text);
  assert.equal(s.questions.total, 1);
});

test("повторное завершение ничего не меняет", async () => {
  const env = setup();
  await playRound(env, 0, 1);
  await env.game.finish();
  const n = env.saved.length;
  const scores = { ...env.game.state.scores };
  await env.game.finish();
  await env.game.finish({ early: true });
  assert.deepEqual(env.game.state.scores, scores);
  assert.equal(env.game.state.finishedEarly, false, "повторный вызов не превращает финал в досрочный");
  assert.equal(env.saved.length, n, "публикация не дублируется");
});

// ---------- 3. История: одно сохранение ----------

test("история: attachBattleToHistory — первое сохранение пишет, второе возвращает exists", async () => {
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
  const store = { "roomHistory/TFU4HB": { testTitle: "t" } };
  const writes = [];
  globalThis.__FB = {
    doc: (_db, col, id) => `${col}/${id}`,
    getDoc: async (ref) => ({ exists: () => ref in store, data: () => store[ref] }),
    updateDoc: async (ref, data) => { writes.push([ref, data]); Object.assign(store[ref], data); }
  };
  try {
    const snap = { version: 1, scores: { a: 1, b: 0 } };
    assert.deepEqual(await attachBattleToHistory("TFU4HB", snap), { saved: true });
    assert.deepEqual(await attachBattleToHistory("TFU4HB", snap), { saved: false, reason: "exists" });
    assert.deepEqual(await attachBattleToHistory("TFU4HB", snap), { saved: false, reason: "exists" });
    assert.equal(writes.length, 1, "в историю записано ровно один раз");
    assert.deepEqual(await attachBattleToHistory("KMN7PQ", snap), { saved: false, reason: "no-history" });
  } finally { delete globalThis.__FB; }
});

test("история: гонка двух клиентов — отказ правил для проигравшего считается exists", async () => {
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
  const store = { "roomHistory/HJK2LM": {} };
  let reads = 0;
  globalThis.__FB = {
    doc: (_db, col, id) => `${col}/${id}`,
    getDoc: async (ref) => { reads++; return { exists: () => true, data: () => store[ref] }; },
    updateDoc: async (ref) => { store[ref].battle = { version: 1 }; const e = new Error("denied"); e.code = "permission-denied"; throw e; }
  };
  try {
    assert.deepEqual(await attachBattleToHistory("HJK2LM", { version: 1 }), { saved: false, reason: "exists" });
  } finally { delete globalThis.__FB; }
  // Другая ошибка не маскируется.
  globalThis.__FB = {
    doc: (_db, col, id) => `${col}/${id}`,
    getDoc: async () => ({ exists: () => true, data: () => ({}) }),
    updateDoc: async () => { const e = new Error("net"); e.code = "unavailable"; throw e; }
  };
  try { await assert.rejects(attachBattleToHistory("HJK2LM", { version: 1 }), /net/); }
  finally { delete globalThis.__FB; }
});

// ---------- 4. Снимок ----------

test("снимок → чтение даёт ту же таблицу; личное участие берётся из отчёта ведущего", async () => {
  const env = setup();
  await playRound(env, 0, 1);
  await playRound(env, 1, 0);
  await env.game.finish();
  const snap = buildBattleSnapshot({ state: env.game.state, liveInfo, initialRoster: env.game.initialRoster, events: env.game.events, questions: env.game.questions.map(({ correct, ...q }) => q), finishedAtMs: 5 });
  const stored = JSON.parse(JSON.stringify({ battle: snap })); // как после Firestore
  const read = readBattleSnapshot(stored);
  assert.equal(read.version, BATTLE_SNAPSHOT_VERSION);
  const fromSnap = buildBattleSummary({ battle: read });
  const live = buildBattleSummary({ battle: env.saved.at(-1), nameOf });
  assert.equal(fromSnap.source, "snapshot");
  assert.deepEqual(fromSnap.players.map((p) => p.name), live.players.map((p) => p.name), "тот же алфавитный порядок");
  assert.deepEqual(fromSnap.teams.a.points, live.teams.a.points);
  assert.equal(fromSnap.teams.a.correctAnswers, live.teams.a.correctAnswers);
  assert.deepEqual(fromSnap.questions.byTeam.a.correct, live.questions.byTeam.a.correct);
  assert.equal(fromSnap.hasPersonal, true, "в снимке есть личное участие");
  const cap = fromSnap.players.find((p) => p.uid === "u1");
  assert.equal(cap.participationPercent, 100);
  assert.equal(cap.participated, 2);
  assert.equal(cap.teamCorrect, 2);
  assert.equal(fromSnap.questions.byTeam.a.tiebreak, 0, "споры считаются по журналу снимка");
  assert.match(text(battleSummaryView(fromSnap)), /100%/);
});

test("старый снимок без раундов и игроков читается без ошибки", () => {
  const old = { battle: { version: 1, scores: { a: 3, b: 1 }, winner: "a" } };
  const snap = readBattleSnapshot(old);
  assert.ok(snap);
  assert.equal(buildBattleSummary({ battle: snap }), null);
  assert.match(text(battleSummaryView(buildBattleSummary({ battle: snap }))), /не сохранена/);
  assert.equal(readBattleSnapshot({}), null);
  assert.equal(readBattleSnapshot({ battle: "строка" }), null);
});

// ---------- 5. Секретность ----------

test("таблица и открытый раунд не раскрывают правильных ответов и личных ответов", async () => {
  const env = setup();
  await env.game.startNextQuestion();
  env.choices[0] = { a: { mode: "vote" }, b: { mode: "vote" } };
  env.votes[0] = { u3: { selected: [1] }, u4: { selected: [2] } };
  await env.game.syncCaptainChoices();
  const open = env.saved.at(-1);
  assert.equal(open.currentRound.correct, undefined, "до закрытия правильного ответа нет в публичном документе");
  assert.equal(JSON.stringify(open).includes("u3"), true, "uid есть только в составах");
  assert.equal(JSON.stringify(open.currentRound).includes('"selected"'), false, "личных голосов нет");
  const openSummary = buildBattleSummary({ battle: open, nameOf });
  assert.equal(openSummary.questions.total, 0);
  await env.game.closeRound();
  await env.game.finish();
  const s = buildBattleSummary({ battle: env.saved.at(-1), nameOf });
  const json = JSON.stringify(s);
  for (const forbidden of ['"correct":[', '"selected"', '"answers"', '"votes"', '"keys"']) {
    assert.equal(json.includes(forbidden), false, `в таблице не должно быть ${forbidden}`);
  }
  // Даже из полного снимка (где есть answers по игрокам) таблица берёт только агрегаты.
  const snap = buildBattleSnapshot({ state: env.game.state, liveInfo, initialRoster: env.game.initialRoster, events: env.game.events, questions: [], finishedAtMs: 1 });
  assert.equal(JSON.stringify(buildBattleSummary({ battle: JSON.parse(JSON.stringify(snap)) })).includes('"answers"'), false);
});

// ---------- 6. Счёт ----------

test("счёт: одно событие публичного документа — одинаковый текст для всех экранов", () => {
  const b = { scores: { a: 0.1 + 0.2, b: 2.456 } };
  assert.equal(formatScore(0.1 + 0.2), "0.3");
  assert.deepEqual(scoreLine(b), { a: "0.3", b: "2.46", text: "0.3 : 2.46" });
  // Анимация счётчика (участник и проектор используют её же) приходит к тому же тексту.
  const el = { textContent: "", setAttribute() {}, removeAttribute() {} };
  animateNumber(el, b.scores.a, {}, { reduced: () => true });
  assert.equal(el.textContent, formatScore(b.scores.a));
});

test("счёт: участник и проектор берут счёт из одного источника (структурная проверка)", () => {
  const play = readFileSync(new URL("../ui/components/battle-play.js", import.meta.url), "utf8");
  const screen = readFileSync(new URL("../ui/components/battle-screen.js", import.meta.url), "utf8");
  assert.match(play, /animateNumber\(scoreA, Number\(b\.scores\?\.a\)/);
  assert.match(screen, /animateNumber\(teamEls\[id\]\.score, Number\(battle\.scores\?\.\[id\]\)/);
  assert.match(play, /scoreLine\(battle\)/, "итоговый счёт участника — через общую функцию");
  assert.match(screen, /const fmtNum = formatScore/, "итоговый счёт проектора — через общую функцию");
  assert.doesNotMatch(play, /battle\.scores\?\.a \?\? 0\} —/, "сырое значение без форматирования не выводится");
});
