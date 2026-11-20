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
  const choices = {};
  const rounds = [];
  let clock = 1000;
  const store = {
    saveBattle: async (p) => { saved.push(JSON.parse(JSON.stringify(p))); },
    saveRound: async (rec) => { rounds.push(JSON.parse(JSON.stringify(rec))); },
    readVotes: async (i) => votesByRound[i] || {},
    readChoices: async (i) => choices[i] || {},
    readDecisions: async (i) => decisions[i] || {},
    logEvent: async () => {}
  };
  const qs = questions || [
    { id: "q1", type: "single", optionCount: 4, correct: [1] },
    { id: "q2", type: "multiple", optionCount: 4, correct: [0, 1] }
  ];
  const liveInfo = Object.fromEntries(ids(n).map((u, i) => [u, { name: "Имя" + (n - i), place: i + 1, score: 100 - i, liveGrade: 90 - i }]));
  const game = new BattleGame({ settings, roster, questions: qs, liveInfo, store, now: () => clock });
  return { game, saved, votesByRound, decisions, choices, rounds, store, qs, roster, tick: (ms) => { clock += ms; }, liveInfo };
}
const vote = (uids, sel) => Object.fromEntries(uids.map((u) => [u, { selected: sel }]));

test("публичный документ не содержит правильных ответов до закрытия раунда", async () => {
  const { game, saved } = setup();
  await game.startNextQuestion();
  await game.captainChoose("a", { mode: "vote" });
  const open = saved.at(-1);
  assert.equal(open.currentRound.status, ROUND_STATES.VOTING);
  assert.equal(JSON.stringify(open).includes('"correct":'), false);
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


test("публичный документ не содержит личных ответов и распределения голосов", async () => {
  const { game, saved, votesByRound, roster } = setup();
  await game.startNextQuestion();
  await game.captainChoose("a", { mode: "vote" });
  votesByRound[0] = { [roster.teams.a[1]]: { selected: [1] }, [roster.teams.a[2]]: { selected: [2] } };
  await game.refreshVoteCounts();
  const json = JSON.stringify(saved.at(-1));
  assert.deepEqual(saved.at(-1).currentRound.voted.a, { voted: 2, total: roster.teams.a.length });
  assert.equal(json.includes('"selected"'), false);
  assert.equal(json.includes('"answers"'), false);
  votesByRound[0][roster.teams.a[3]] = { selected: [1] };
  await game.closeRound();
  const after = JSON.stringify(saved.at(-1));
  assert.equal(after.includes('"answers"'), false);
  assert.equal(after.includes('"eligible"'), false);
});

test("счётчик голосов публикуется только при изменении", async () => {
  const { game, saved, votesByRound, roster } = setup();
  await game.startNextQuestion();
  await game.captainChoose("a", { mode: "vote" });
  votesByRound[0] = { [roster.teams.a[1]]: { selected: [1] } };
  await game.refreshVoteCounts();
  const n = saved.length;
  await game.refreshVoteCounts();
  assert.equal(saved.length, n);
});

test("полные записи раундов уходят в host-only хранилище", async () => {
  const { game, votesByRound, roster, rounds } = setup();
  await game.startNextQuestion();
  await game.captainChoose("a", { mode: "vote" });
  votesByRound[0] = vote(roster.teams.a, [1]);
  await game.closeRound();
  assert.equal(rounds.length, 1);
  assert.ok(Object.keys(rounds[0].teams.a.answers).length > 0);
});

test("спор голосов: фаза tiebreak, решение капитана, итог раунда", async () => {
  const { game, votesByRound, decisions, roster, tick, saved } = setup({ n: 8 });
  await game.startNextQuestion();
  await game.captainChoose("a", { mode: "vote" });
  const [p1, p2, p3, p4] = roster.teams.a;
  votesByRound[0] = { [p1]: { selected: [1] }, [p2]: { selected: [1] }, [p3]: { selected: [2] }, [p4]: { selected: [2] } };
  const res = await game.closeVotingPhase();
  assert.equal(res.tiebreak, true);
  assert.deepEqual(res.tied.a.sort(), [1, 2]);
  assert.equal(game.phase, L.PHASES.CAPTAIN_TIEBREAK);
  assert.equal(saved.at(-1).currentRound.status, ROUND_STATES.TIEBREAK);
  assert.equal(game.tiebreakLeftMs(), 15000);
  tick(5000);
  decisions[0] = { a: { pick: 1 } };
  const rec = await game.closeRound();
  assert.deepEqual(rec.teams.a.selected, [1]);
  assert.equal(rec.teams.a.status, "resolved");
});

test("спор голосов: капитан не решил за 15 с — ответа команды нет", async () => {
  const { game, votesByRound, roster, tick } = setup({ n: 8 });
  await game.startNextQuestion();
  await game.captainChoose("a", { mode: "vote" });
  const [p1, p2] = roster.teams.a;
  votesByRound[0] = { [p1]: { selected: [1] }, [p2]: { selected: [2] } };
  await game.closeVotingPhase();
  tick(15001);
  assert.equal(game.tiebreakLeftMs(), 0);
  const rec = await game.closeRound();
  assert.equal(rec.teams.a.points.total, 0);
  assert.equal(rec.teams.a.status, "unresolved");
});

test("выбор капитанов подтягивается из хранилища и применяется один раз", async () => {
  const { game, choices } = setup();
  await game.startNextQuestion();
  choices[0] = { a: { mode: "vote" }, b: { mode: "self", selected: [1], atMs: 4000 } };
  assert.equal(await game.syncCaptainChoices(), 2);
  assert.equal(await game.syncCaptainChoices(), 0);
  assert.equal(game.round.modes.b, "self");
  assert.equal(game.round.selfAnswers.b.answeredMs, 3000); // 4000 − старт 1000
});

test("восстановление после перезагрузки: счёт, раунды и открытый вопрос сохраняются", async () => {
  const { game, votesByRound, roster, saved, rounds, store, qs, liveInfo } = setup();
  await game.startNextQuestion();
  await game.captainChoose("a", { mode: "vote" });
  votesByRound[0] = vote(roster.teams.a, [1]);
  await game.closeRound();
  await game.startNextQuestion();
  const doc = saved.at(-1);
  const g2 = BattleGame.restore({ doc, questions: qs, rounds, liveInfo, store, now: () => 9999 });
  assert.deepEqual(g2.state.scores, game.state.scores);
  assert.equal(g2.state.rounds.length, 1);
  assert.equal(g2.phase, L.PHASES.CAPTAIN_DECISION);
  assert.equal(g2.round.index, 1);
  // повторное закрытие уже закрытого раунда после восстановления не удваивает очки
  g2.round = { ...g2.round, index: 0 };
  const before = JSON.stringify(g2.state.scores);
  await g2.closeRound();
  assert.equal(JSON.stringify(g2.state.scores), before);
});


test("autoStep: ждёт, пока не все проголосовали; закрывает, когда все", async () => {
  const { game, votesByRound, choices, roster } = setup();
  await game.startNextQuestion();
  choices[0] = { a: { mode: "vote" }, b: { mode: "self", selected: [1] } };
  assert.equal(await game.autoStep(), "waiting");
  votesByRound[0] = vote(roster.teams.a.slice(0, 2), [1]);
  assert.equal(await game.autoStep(), "waiting");
  votesByRound[0] = vote(roster.teams.a, [1]);
  assert.equal(await game.autoStep(), "closed");
  assert.equal(game.phase, L.PHASES.QUESTION_RESULT);
  assert.equal(game.state.rounds.length, 1);
  assert.equal(await game.autoStep(), "idle");
});

test("autoStep: время вышло — раунд закрывается с нулём очков тем, кто не ответил", async () => {
  const { game, tick } = setup();
  await game.startNextQuestion();
  tick(31000);
  assert.equal(await game.autoStep(), "timeout");
  const rec = game.state.rounds[0];
  assert.equal(rec.teams.a.points.total, 0);
  assert.equal(rec.teams.b.points.total, 0);
});

test("autoStep: спор → ждёт капитана → закрывает после его решения", async () => {
  const { game, votesByRound, decisions, choices, roster } = setup({ n: 8 });
  await game.startNextQuestion();
  choices[0] = { a: { mode: "vote" }, b: { mode: "self", selected: [0] } };
  const [p1, p2, p3, p4] = roster.teams.a;
  votesByRound[0] = { [p1]: { selected: [1] }, [p2]: { selected: [1] }, [p3]: { selected: [2] }, [p4]: { selected: [2] } };
  assert.equal(await game.autoStep(), "tiebreak");
  assert.equal(await game.autoStep(), "waiting");
  decisions[0] = { a: { pick: 1 } };
  assert.equal(await game.autoStep(), "closed");
  assert.deepEqual(game.state.rounds[0].teams.a.selected, [1]);
});

test("autoStep: спор без решения за 15 с — закрывается, ответа команды нет", async () => {
  const { game, votesByRound, choices, roster, tick } = setup({ n: 8 });
  await game.startNextQuestion();
  choices[0] = { a: { mode: "vote" }, b: { mode: "self", selected: [0] } };
  const [p1, p2, p3, p4] = roster.teams.a;
  votesByRound[0] = { [p1]: { selected: [1] }, [p2]: { selected: [1] }, [p3]: { selected: [2] }, [p4]: { selected: [2] } };
  await game.autoStep();
  tick(15001);
  assert.equal(await game.autoStep(), "closed");
  assert.equal(game.state.rounds[0].teams.a.points.total, 0);
});

test("autoStep: игра из двух вопросов идёт до конца без ручных вызовов закрытия", async () => {
  const { game, votesByRound, choices, roster } = setup();
  for (let i = 0; i < 2; i++) {
    await game.startNextQuestion();
    choices[i] = { a: { mode: "vote" }, b: { mode: "vote" } };
    const ok = i === 0 ? [1] : [0, 1];
    votesByRound[i] = { ...vote(roster.teams.a, ok), ...vote(roster.teams.b, ok) };
    assert.equal(await game.autoStep(), "closed");
  }
  assert.equal(game.state.rounds.length, 2);
  assert.equal(await game.afterMainRounds(), "sudden_death"); // равный счёт
});

test("сквозной сценарий: 3 вопроса, замена посреди игры, итоги и снимок", async () => {
  const qs = [
    { id: "q0", type: "single", optionCount: 4, correct: [1] },
    { id: "q1", type: "multiple", optionCount: 4, correct: [0, 1] },
    { id: "q2", type: "single", optionCount: 3, correct: [2] }
  ];
  const { game, votesByRound, choices, roster, liveInfo, tick } = setup({ n: 9, questions: qs });
  const A = roster.teams.a, B = roster.teams.b, sub = roster.reserve[0];

  // Раунд 0: обе команды голосуют верно.
  await game.startNextQuestion();
  choices[0] = { a: { mode: "vote" }, b: { mode: "vote" } };
  votesByRound[0] = { ...vote(A, [1]), ...vote(B, [1]) };
  assert.equal(await game.autoStep(), "closed");

  // Между раундами выбывает рядовой игрок A; его заменяет запасной.
  const victim = A.find((u) => u !== "u1");
  assert.equal(await game.eliminate(victim), true);
  assert.ok(game.state.roster.teams.a.includes(sub));

  // Раунд 1: A голосует частично верно (капитан B отвечает сам).
  await game.startNextQuestion();
  const aNow = L.eligibleVoters(game.state.roster, "a");
  choices[1] = { a: { mode: "vote" }, b: { mode: "self", selected: [0, 1], atMs: 2000 } };
  votesByRound[1] = vote(aNow, [0]);
  assert.equal(await game.autoStep(), "closed");

  // Раунд 2: время вышло.
  await game.startNextQuestion();
  tick(31000);
  assert.equal(await game.autoStep(), "timeout");

  assert.equal(game.state.rounds.length, 3);
  const outcome = await game.afterMainRounds();
  assert.ok(["finished", "sudden_death"].includes(outcome));
  if (outcome === "sudden_death") await game.finish();

  const snap = buildBattleSnapshot({ state: game.state, liveInfo, initialRoster: roster, events: game.events, questions: qs.map(({ correct, ...p }) => p) });
  const by = Object.fromEntries(snap.players.map((p) => [p.uid, p]));
  // Заменивший оценивается только по доступным ему вопросам (раунды 1 и 2).
  assert.equal(by[sub].substituted, true);
  assert.equal(by[sub].availableQuestions, 2);
  // Выбывший был доступен только в раунде 0.
  assert.equal(by[victim].availableQuestions, 1);
  // Капитан B отвечал сам в раунде 1: у остальных игроков B этот вопрос недоступен.
  const bMember = B.find((u) => u !== "u2");
  assert.equal(by[bMember].availableQuestions, 2);
  assert.equal(by["u2"].availableQuestions, 3);
  // Оценки в диапазоне, итог = Live·0.6 + Battle·0.4.
  for (const p of snap.players) {
    if (p.battleGrade === null) continue;
    assert.ok(p.battleGrade >= 0 && p.battleGrade <= 100);
    assert.equal(p.finalGrade, Math.round((p.liveGrade * 0.6 + p.battleGrade * 0.4) * 100) / 100);
  }
  // Запасной, не вышедший на замену, получил бы итог = Live (здесь запасной один и вышел).
  assert.equal(JSON.stringify(snap).includes('"correct":'), true); // только в итогах закрытых раундов
  assert.equal(snap.rounds.length, 3);
});
