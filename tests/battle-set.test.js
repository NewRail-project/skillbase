// tests/battle-set.test.js — вопросы Battle и ничьих, подготовленные вместе с тестом.
import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyBattleSet, normalizeBattleSet, parseBattleText, validateBattleSet, mainQuestionsForLaunch,
  extraQuestionsForBattle, duelBankForPlace, isPreparedQid, questionsToText, toStoredSet,
  isEmptySet, battleSetDocId, publicOf
} from "../core/battle-set.js";
import { buildLaunchPlan } from "../core/battle-launch.js";
import { buildDuelsDoc, openDuelRound, applyRound, groupBank, settleGroup } from "../core/duel-logic.js";
import { BattleGame } from "../core/battle-game.js";
import * as L from "../core/battle-logic.js";

const Q = (n) => `${n}. Вопрос ${n}?\nA) Нет\nB) Да [+]\nC) Не знаю`;
const text = (...ns) => ns.map(Q).join("\n\n");

function setOf({ main = [], p1 = [], p2 = [], p3 = [], count = null, order = "set" } = {}) {
  const s = emptyBattleSet();
  s.main = { questions: parseBattleText(text(...main)).questions, count, order, questionSeconds: null };
  s.placeTies[1] = parseBattleText(text(...p1)).questions;
  s.placeTies[2] = parseBattleText(text(...p2)).questions;
  s.placeTies[3] = parseBattleText(text(...p3)).questions;
  return s;
}

// ---------- разбор и проверка ----------

test("разбор: вопросы теста в том же формате, тип выводится из отметок", () => {
  const { questions, errors } = parseBattleText("1. Простые?\nA) 2 [+]\nB) 3 [+]\nC) 4\n\n2. Один?\nA) да [+]\nB) нет");
  assert.deepEqual(errors, []);
  assert.equal(questions[0].type, "multiple");
  assert.equal(questions[1].type, "single");
  assert.equal(parseBattleText("   ").questions.length, 0);
});

test("разбор: короткий ответ и вопрос без верного варианта — ошибки", () => {
  const short = parseBattleText("1. Столица?\nОтвет: Москва");
  assert.ok(short.errors.length > 0, "вопрос без вариантов отклоняется");
  const noCorrect = validateBattleSet(setOf({ main: [] }));
  assert.deepEqual(noCorrect, []);
  const s = emptyBattleSet();
  s.main.questions = [{ type: "single", text: "Без ответа?", options: [{ text: "a", correct: false }, { text: "b", correct: false }] }];
  assert.match(validateBattleSet(s)[0], /не отмечен верный ответ/);
});

test("проверка: число вопросов не больше подготовленных, всё верное недопустимо", () => {
  const s = setOf({ main: [1, 2], count: 5 });
  assert.match(validateBattleSet(s).join(" "), /больше подготовленных/);
  const all = emptyBattleSet();
  all.placeTies[2] = [{ type: "multiple", text: "Все?", options: [{ text: "a", correct: true }, { text: "b", correct: true }] }];
  assert.match(validateBattleSet(all).join(" "), /все варианты/);
});

test("хранение: набор переживает запись и чтение, текст редактора восстанавливается", () => {
  const s = setOf({ main: [1, 2], p1: [3], p2: [4, 5] });
  const stored = JSON.parse(JSON.stringify(toStoredSet(s)));
  const back = normalizeBattleSet(stored);
  assert.equal(back.main.questions.length, 2);
  assert.equal(back.placeTies[2].length, 2);
  assert.equal(parseBattleText(questionsToText(back.placeTies[2])).questions.length, 2);
  assert.equal(battleSetDocId("abc"), "abc__battle");
  assert.equal(isEmptySet(emptyBattleSet()), true);
  assert.equal(isEmptySet(s), false);
});

test("публичная часть вопроса не содержит правильных ответов", () => {
  const q = setOf({ main: [1] }).main.questions[0];
  assert.equal(JSON.stringify(publicOf(q)).includes("correct"), false);
});

// ---------- Battle ----------

test("основные вопросы Battle: количество, порядок, идентификаторы и ключи", () => {
  const s = setOf({ main: [1, 2, 3, 4], count: 2 });
  const a = mainQuestionsForLaunch(s);
  assert.equal(a.used, true);
  assert.deepEqual(a.questions.map((q) => q.id), ["m0", "m1"]);
  assert.deepEqual(a.questions[0].correct, [1]);
  const seq = [0.9, 0.1, 0.5];
  let i = 0;
  const r = mainQuestionsForLaunch(s, { count: 3, order: "random", rng: () => seq[i++ % 3] });
  assert.equal(r.questions.length, 3);
  assert.equal(new Set(r.questions.map((q) => q.id)).size, 3);
  // Приоритет у настроек запуска.
  assert.equal(mainQuestionsForLaunch(s, { count: 4 }).questions.length, 4);
});

test("без подготовленных вопросов Battle работает по-старому (used=false)", () => {
  const r = mainQuestionsForLaunch(emptyBattleSet());
  assert.deepEqual(r, { questions: [], errors: [], used: false });
  assert.deepEqual(extraQuestionsForBattle(emptyBattleSet()), []);
  assert.deepEqual(extraQuestionsForBattle(setOf({ p2: [1] })), [], "набор 2-го места к Battle не относится");
});

test("план запуска: текст вопросов публичный, ответы — только в ключах; решающие вопросы отдельно", () => {
  const set = setOf({ main: [1, 2], p1: [3, 4] });
  const main = mainQuestionsForLaunch(set).questions;
  const extra = extraQuestionsForBattle(set);
  const ids = (n) => Array.from({ length: n }, (_, i) => "u" + (i + 1));
  const roster = L.buildRoster({ memberIds: ids(8), captains: { a: "u1", b: "u2" }, rng: L.createSeededRng(1) }).roster;
  const { plan, errors } = buildLaunchPlan({ roster, questions: main, extraQuestions: extra, settings: {}, hostId: "h", testId: "t" });
  assert.equal(errors, undefined);
  assert.equal(plan.battle.questions[0].text, "Вопрос 1?");
  assert.deepEqual(plan.battle.questions[0].options, ["Нет", "Да", "Не знаю"]);
  assert.equal(plan.battle.extraQuestions.length, 2);
  assert.equal(JSON.stringify(plan.battle).includes('"correct"'), false, "правильных ответов в публичном документе нет");
  assert.deepEqual(plan.keys.map((k) => k.id), ["m0", "m1", "x0", "x1"]);
  // Обычный запуск без решающих вопросов не меняется.
  const plain = buildLaunchPlan({ roster, questions: main, settings: {}, hostId: "h", testId: "t" });
  assert.deepEqual(plain.plan.battle.extraQuestions, []);
});

async function tiedGame(extras) {
  const { settings } = L.normalizeSettings({ questionSeconds: 30 });
  const ids = Array.from({ length: 8 }, (_, i) => "u" + (i + 1));
  const roster = L.buildRoster({ memberIds: ids, captains: { a: "u1", b: "u2" }, rng: L.createSeededRng(3) }).roster;
  const saved = []; const choices = {}; const votes = {};
  let clock = 1000;
  const store = {
    saveBattle: async (p) => { saved.push(JSON.parse(JSON.stringify(p))); }, saveRound: async () => {},
    readVotes: async (i) => votes[i] || {}, readChoices: async (i) => choices[i] || {}, readDecisions: async () => ({}),
    logEvent: async () => {}
  };
  const questions = [{ id: "q0", type: "single", optionCount: 3, correct: [0] }, { id: "q1", type: "single", optionCount: 3, correct: [2] }];
  const game = new BattleGame({ settings, roster, questions, extraQuestions: extras, liveInfo: {}, store, now: () => clock });
  const vote = (uids, sel) => Object.fromEntries(uids.map((u) => [u, { selected: sel }]));
  for (const [i, ans] of [[0, [0]], [1, [2]]]) {
    await game.startNextQuestion();
    choices[i] = { a: { mode: "vote" }, b: { mode: "vote" } };
    votes[i] = { ...vote(roster.teams.a, ans), ...vote(roster.teams.b, ans) };
    await game.autoStep();
  }
  assert.equal(await game.afterMainRounds(), "sudden_death");
  return { game, choices, saved };
}

test("ничья команд: решающие вопросы берутся из подготовленного набора 1-го места, по очереди", async () => {
  const extras = [
    { id: "x0", type: "single", optionCount: 3, correct: [1], text: "Решающий 1", options: ["a", "b", "c"] },
    { id: "x1", type: "single", optionCount: 3, correct: [2], text: "Решающий 2", options: ["a", "b", "c"] }
  ];
  const { game, choices, saved } = await tiedGame(extras);
  await game.autoStep();
  assert.equal(game.round.question.id, "x0");
  assert.equal(saved.at(-1).currentRound.questionId, "x0");
  assert.equal(saved.at(-1).currentRound.correct, undefined, "ответ решающего вопроса не публикуется до закрытия");
  const r = game.round;
  const wrong = { mode: "self", selected: [0], atMs: r.startedAt + 1 };
  choices[2] = { a: wrong, b: { ...wrong, atMs: r.startedAt + 2 } };
  assert.equal(await game.autoStep(), "next");
  await game.autoStep();
  assert.equal(game.round.question.id, "x1", "ничья не решена — следующий подготовленный вопрос");
});

test("ничья команд без подготовленных решающих вопросов — прежний банк основных", async () => {
  const { game } = await tiedGame([]);
  await game.autoStep();
  assert.equal(game.round.question.id, "q0");
});

// ---------- ничьи участников (дуэли) ----------

test("банк ничьей: только для 1-3 места и только если набор подготовлен", () => {
  const set = setOf({ p1: [1, 2], p3: [3] });
  const bank = duelBankForPlace(set, 1);
  assert.deepEqual(bank.map((b) => b.qid), ["t1:0", "t1:1"]);
  assert.deepEqual(bank[0].key, { type: "single", points: 1, correct: [1] });
  assert.equal(JSON.stringify(bank[0].question).includes("correct"), false);
  assert.equal(duelBankForPlace(set, 2), null, "для 2-го места набора нет");
  assert.equal(duelBankForPlace(set, 4), null, "для 4-го места наборов не бывает");
  assert.equal(isPreparedQid("t3:0"), true);
  assert.equal(isPreparedQid("7"), false);
});

const rows = [
  { uid: "a", name: "A", score: 10, correctCount: 3, place: 1 },
  { uid: "b", name: "B", score: 10, correctCount: 3, place: 1 },
  { uid: "c", name: "C", score: 7, correctCount: 2, place: 3 },
  { uid: "d", name: "D", score: 7, correctCount: 2, place: 3 },
  { uid: "e", name: "E", score: 2, correctCount: 1, place: 5 },
  { uid: "f", name: "F", score: 2, correctCount: 1, place: 5 }
];

test("дуэли: у групп за 1-е и 3-е место свои вопросы, у остальных — вопросы теста", () => {
  const doc = buildDuelsDoc({ rows, questionCount: 5, banks: { 1: ["t1:0", "t1:1"], 3: ["t3:0"] } });
  const [g1, g3, g5] = doc.groups;
  assert.deepEqual(g1.bank, ["t1:0", "t1:1"]);
  assert.equal(g1.place, 1);
  assert.deepEqual(g3.bank, ["t3:0"]);
  assert.equal(g5.bank, undefined, "место 5 — без подготовленных вопросов");
  assert.deepEqual(groupBank(g5, 5), ["0", "1", "2", "3", "4"]);
});

test("дуэль за место: несколько вопросов до разрешения, без повторов, исчерпание — решение преподавателя", () => {
  const doc = buildDuelsDoc({ rows, questionCount: 5, banks: { 1: ["t1:0", "t1:1", "t1:2"] } });
  let g = doc.groups[0];
  let next = openDuelRound(g, 5);
  assert.equal(next.currentQid, "t1:0");
  // Оба верно — ничья раунда, нужен следующий вопрос.
  g = settleGroup(applyRound(next, "t1:0", { a: true, b: true }), 5);
  assert.equal(g.status, "running");
  next = openDuelRound(g, 5);
  assert.equal(next.currentQid, "t1:1", "вопросы не повторяются");
  // a верно, b нет — после 2 из 3 раундов отрыв 1 при одном оставшемся: ещё не решено.
  g = settleGroup(applyRound(next, "t1:1", { a: true, b: false }), 5);
  assert.equal(g.status, "running");
  next = openDuelRound(g, 5);
  g = settleGroup(applyRound(next, "t1:2", { a: true, b: false }), 5);
  assert.equal(g.status, "resolved");
  assert.deepEqual(g.order, ["a", "b"]);
  assert.equal(g.currentQuestion, undefined, "закрытый раунд не оставляет открытого вопроса");
});

test("дуэль: банк исчерпан, а ничья осталась — pending, победитель не назначается", () => {
  let g = buildDuelsDoc({ rows, questionCount: 5, banks: { 1: ["t1:0"] } }).groups[0];
  g = settleGroup(applyRound(openDuelRound(g, 5), "t1:0", { a: true, b: true }), 5);
  assert.equal(g.status, "pending");
  assert.equal(openDuelRound(g, 5), null, "новых вопросов нет");
  assert.equal(g.order, null);
});

test("совместимость: без banks документ дуэлей такой же, как раньше", () => {
  const old = buildDuelsDoc({ rows, questionCount: 5 });
  assert.equal(old.groups.every((g) => g.bank === undefined), true);
});
