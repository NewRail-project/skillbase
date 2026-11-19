import test from "node:test";
import assert from "node:assert/strict";
import * as L from "../core/battle-logic.js";
import { BattleGame, ROUND_STATES } from "../core/battle-game.js";
import { buildBattleSnapshot, readBattleSnapshot } from "../core/battle-snapshot.js";
import { buildRoomHistorySnapshot } from "../core/room-history.js";

const ids = (n) => Array.from({ length: n }, (_, i) => "u" + (i + 1));
function setup({ n = 9, questions, seed = 3 } = {}) {
  const { settings } = L.normalizeSettings({ questionSeconds: 30 });
  const roster = L.buildRoster({ memberIds: ids(n), captains: { a: "u1", b: "u2" }, rng: L.createSeededRng(seed) }).roster;
  const saved = [];
  const votesByRound = {};
  const decisions = {};
  let clock = 1000;
  const store = {
    saveBattle: async (p) => { saved.push(JSON.parse(JSON.stringify(p))); },
    readVotes: async (i) => votesByRound[i] || {},
    readDecisions: async (i) => decisions[i] || {},
    logEvent: async () => {}
  };
  const qs = questions || [
    { id: "q1", type: "single", optionCount: 4, correct: [1] },
    { id: "q2", type: "multiple", optionCount: 4, correct: [0, 1] }
  ];
  const liveInfo = Object.fromEntries(ids(n).map((u, i) => [u, { name: "Имя" + (n - i), place: i + 1, score: 100 - i, liveGrade: 90 - i }]));
  const game = new BattleGame({ settings, roster, questions: qs, liveInfo, store, now: () => clock });
  return { game, saved, votesByRound, decisions, roster, tick: (ms) => { clock += ms; }, liveInfo };
}
const vote = (uids, sel) => Object.fromEntries(uids.map((u) => [u, { selected: sel }]));

test("публичный документ не содержит правильных ответов до закрытия раунда", async () => {
  const { game, saved } = setup();
  await game.startNextQuestion();
  await game.captainChoose("a", { mode: "vote" });
  const open = saved.at(-1);
  assert.equal(open.currentRound.status, ROUND_STATES.VOTING);
  assert.equal(JSON.stringify(open).includes("correct"), false);
  game.closeVoting("a");
  await game.closeRound({ timedOut: true });
  assert.deepEqual(saved.at(-1).currentRound.correct, [1]); // раскрыт после закрытия
});

test("полный ход: голосование команды A, самостоятельный ответ капитана B, очки и канат", async () => {
  const { game, votesByRound, roster, tick } = setup();
  await game.startNextQuestion();
  await game.captainChoose("a", { mode: "vote" });
  tick(3000);
  await game.captainChoose("b", { mode: "self", selected: [1] });
  votesByRound[0] = vote(roster.teams.a, [1]);
  game.closeVoting("a");
  const rec = await game.closeRound();
  assert.equal(rec.teams.a.points.teamwork, 2); // 100% верных голосов
  assert.equal(rec.teams.b.points.teamwork, 0); // самостоятельный ответ
  assert.ok(rec.teams.a.points.total > 0 && rec.teams.b.points.total > 0);
  assert.ok(game.state.scores.a >= game.state.scores.b);
  assert.ok(game.rope() >= 0);
  assert.equal(game.phase, L.PHASES.QUESTION_RESULT);
});

test("повторное закрытие раунда не начисляет очки дважды", async () => {
  const { game, votesByRound, roster } = setup();
  await game.startNextQuestion();
  await game.captainChoose("a", { mode: "vote" });
  votesByRound[0] = vote(roster.teams.a, [1]);
  await game.closeRound();
  const before = JSON.stringify(game.state.scores);
  await game.closeRound();
  assert.equal(JSON.stringify(game.state.scores), before);
});

test("выбор способа капитаном делается один раз", async () => {
  const { game } = setup();
  await game.startNextQuestion();
  assert.equal(await game.captainChoose("a", { mode: "vote" }), true);
  assert.equal(await game.captainChoose("a", { mode: "self", selected: [0] }), false);
});

test("выбывание капитана на лету: капитанство и замена, повтор идемпотентен", async () => {
  const { game, roster } = setup({ n: 9 });
  assert.equal(await game.eliminate("u1"), true);
  assert.equal(await game.eliminate("u1"), false);
  assert.notEqual(game.state.roster.captains.a, "u1");
  assert.ok(game.state.roster.substituted.length === 1);
  assert.ok(roster.reserve.length === 1);
});

test("ничья после всех вопросов → решающий раунд → победитель", async () => {
  const { game, votesByRound, roster } = setup({ questions: [{ id: "q1", type: "single", optionCount: 3, correct: [0] }] });
  await game.startNextQuestion();
  await game.captainChoose("a", { mode: "vote" });
  await game.captainChoose("b", { mode: "vote" });
  votesByRound[0] = { ...vote(roster.teams.a, [0]), ...vote(roster.teams.b, [0]) };
  await game.closeRound();
  assert.equal(game.state.scores.a, game.state.scores.b);
  assert.equal(await game.afterMainRounds(), "sudden_death");
  const r1 = await game.resolveSuddenDeath({ a: { correct: false, ms: 1 }, b: { correct: false, ms: 2 } });
  assert.equal(r1.next, true);
  assert.equal(game.phase, L.PHASES.SUDDEN_DEATH);
  const r2 = await game.resolveSuddenDeath({ a: { correct: true, ms: 2000 }, b: { correct: true, ms: 1500 } });
  assert.equal(r2.winner, "b");
  assert.equal(game.state.winner, "b");
  assert.equal(game.phase, L.PHASES.FINISHED);
});

test("досрочное завершение не засчитывает незакрытый вопрос", async () => {
  const { game } = setup();
  await game.startNextQuestion();
  await game.captainChoose("a", { mode: "vote" });
  const st = await game.finish({ early: true });
  assert.equal(st.rounds.length, 0);
  assert.equal(st.finishedEarly, true);
});

test("снимок битвы: без ключей, попадает в снимок истории, старые комнаты без battle", async () => {
  const { game, votesByRound, roster, liveInfo } = setup();
  await game.startNextQuestion();
  await game.captainChoose("a", { mode: "vote" });
  votesByRound[0] = vote(roster.teams.a, [1]);
  await game.closeRound();
  await game.finish({ early: true });
  const snap = buildBattleSnapshot({
    state: game.state, liveInfo, initialRoster: roster, events: game.events,
    questions: [{ id: "q1", type: "single", optionCount: 4, key: { correct: [1] } }], finishedAtMs: 123
  });
  assert.equal(JSON.stringify(snap).includes('"key"'), false);
  assert.equal(snap.players.length, 9);
  assert.equal(snap.finishedEarly, true);
  const hist = buildRoomHistorySnapshot({ room: { code: "ABC123" }, players: [], scores: [], keysByPos: [], questions: [], positions: [], battle: snap });
  assert.equal(readBattleSnapshot(hist).version, 1);
  const legacy = buildRoomHistorySnapshot({ room: { code: "OLD111" }, players: [], scores: [], keysByPos: [], questions: [], positions: [] });
  assert.equal("battle" in legacy, false);
  assert.equal(readBattleSnapshot(legacy), null);
});
