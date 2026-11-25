// tests/battle-fixes.test.js — целевые проверки исправлений Battle:
// капитаны (ответ и смена капитана), начисление очков, общий вопрос,
// восстановление после перезагрузки ведущего, однократный переход к вопросу.
// Проверяется логика контроллера на хранилище в памяти. Реальная синхронизация
// нескольких клиентов и правила Firestore здесь НЕ проверяются (см. отчёт).
import test from "node:test";
import assert from "node:assert/strict";
import * as L from "../core/battle-logic.js";
import { BattleGame, ROUND_STATES } from "../core/battle-game.js";
import { buildLaunchPlan, toBattleQuestions } from "../core/battle-launch.js";
import { battleQuestionContent } from "../ui/components/battle-play.js";

const ids = (n) => Array.from({ length: n }, (_, i) => "u" + (i + 1));

function setup({ n = 9, questions, seed = 3, extra = [] } = {}) {
  const { settings } = L.normalizeSettings({ questionSeconds: 30 });
  const roster = L.buildRoster({ memberIds: ids(n), captains: { a: "u1", b: "u2" }, rng: L.createSeededRng(seed) }).roster;
  const saved = [];
  const playerWrites = [];
  const choices = {};
  const votes = {};
  const rounds = [];
  let clock = 1000;
  const store = {
    saveBattle: async (p) => { saved.push(JSON.parse(JSON.stringify(p))); },
    saveRound: async (rec) => { rounds.push(JSON.parse(JSON.stringify(rec))); },
    savePlayerFields: async (uid, fields) => { playerWrites.push({ uid, fields }); },
    readVotes: async (i) => votes[i] || {},
    readChoices: async (i) => choices[i] || {},
    readDecisions: async () => ({}),
    logEvent: async () => {}
  };
  const qs = questions || [
    { id: "q1", type: "single", optionCount: 4, correct: [1] },
    { id: "q2", type: "multiple", optionCount: 4, correct: [0, 1] }
  ];
  const game = new BattleGame({ settings, roster, questions: qs, extraQuestions: extra, liveInfo: {}, store, now: () => clock });
  return { game, saved, rounds, choices, votes, playerWrites, qs, store, roster, settings, tick: (ms) => { clock += ms; }, now: () => clock };
}

// 1. Капитан первой команды: ответ сохраняется за командой A.
test("капитан A отвечает самостоятельно — ответ засчитан команде A", async () => {
  const { game, choices, rounds } = setup();
  await game.startNextQuestion();
  choices[0] = { a: { mode: "self", selected: [1] } };
  await game.syncCaptainChoices();
  await game.closeRound();
  assert.equal(rounds[0].teams.a.mode, "self");
  assert.equal(rounds[0].teams.a.status, "resolved");
  assert.ok(rounds[0].teams.a.points.total > 0, "правильный ответ даёт очки команде A");
  assert.equal(rounds[0].teams.b.points.total, 0, "команда B не получает чужие очки");
});

// 2. Капитан второй команды может ответить за команду B.
test("капитан B отвечает за свою команду, а не за A", async () => {
  const { game, choices, rounds } = setup();
  await game.startNextQuestion();
  choices[0] = { b: { mode: "self", selected: [1] } };
  await game.syncCaptainChoices();
  await game.closeRound();
  assert.equal(rounds[0].teams.b.status, "resolved");
  assert.ok(rounds[0].teams.b.points.total > 0);
  assert.equal(rounds[0].teams.a.mode, "none");
});

// 3. Правильный ответ начисляет очки один раз.
test("правильный ответ начисляет очки ровно один раз, даже при повторном закрытии", async () => {
  const { game, choices, rounds } = setup();
  await game.startNextQuestion();
  choices[0] = { a: { mode: "self", selected: [1] } };
  await game.syncCaptainChoices();
  await game.closeRound();
  const once = game.state.scores.a;
  await game.closeRound(); // повторное событие
  await game.closeRound();
  assert.equal(game.state.scores.a, once, "счёт не растёт при повторах");
  assert.equal(rounds.length, 1, "раунд записан один раз");
});

// 4. Неправильный ответ очков не даёт.
test("неправильный ответ капитана не начисляет очки", async () => {
  const { game, choices, rounds } = setup();
  await game.startNextQuestion();
  choices[0] = { a: { mode: "self", selected: [0] } };
  await game.syncCaptainChoices();
  await game.closeRound();
  assert.equal(rounds[0].teams.a.points.total, 0);
  assert.equal(game.state.scores.a, 0);
});

// 6/5. Один и тот же вопрос для всех: публичный вопрос несёт текст и варианты,
// поэтому наблюдатель и команда без локального теста видят то же самое.
test("публичный вопрос содержит текст и варианты, одинаковые для всех клиентов", () => {
  const testQs = [
    { text: "Сколько осей у тепловоза?", options: ["2", "4", "6"] },
    { text: "Какой ток у контактной сети?", options: [{ text: "3 кВ" }, { text: "25 кВ" }] }
  ];
  const keys = [{ type: "single", correct: [1] }, { type: "single", correct: [1] }];
  const { questions } = toBattleQuestions({ questions: testQs, keys });
  const plan = buildLaunchPlan({
    roster: L.buildRoster({ memberIds: ids(9), captains: { a: "u1", b: "u2" }, rng: L.createSeededRng(1) }).roster,
    questions, settings: {}, hostId: "h", testId: "t", orgId: "o"
  });
  const pub = plan.plan.battle.questions;
  assert.equal(pub[0].text, "Сколько осей у тепловоза?");
  assert.deepEqual(pub[1].options, ["3 кВ", "25 кВ"], "варианты — строки, без признака правильности");
  const serialized = JSON.stringify(pub);
  assert.equal(serialized.includes('"correct"'), false, "правильный ответ не попадает в публичный вопрос");

  // Наблюдатель без локального теста (test = null) видит тот же текст.
  const meta = pub[0];
  assert.equal(battleQuestionContent(null, meta).text, "Сколько осей у тепловоза?");
  assert.deepEqual(battleQuestionContent(null, meta).options, ["2", "4", "6"]);
  // И команда с другим локальным тестом тоже (публичный текст приоритетнее).
  assert.equal(battleQuestionContent({ questions: [{ text: "Чужой" }] }, meta).text, "Сколько осей у тепловоза?");
});

// 8. Повторное событие или повторная отправка не дублируют переход.
test("второй вызов startNextQuestion во время вопроса не открывает новый", async () => {
  const { game, rounds } = setup();
  await game.startNextQuestion();
  await assert.rejects(() => game.startNextQuestion(), /Нельзя начать вопрос/);
  assert.equal(game.state.rounds.length, 0);
  assert.equal(game.round.index, 0, "вопрос один и тот же");
  assert.equal(rounds.length, 0);
});

// 7. После завершения вопроса переход к одному следующему вопросу.
test("после закрытия вопроса следующий начинается один раз, с индексом 1", async () => {
  const { game, choices } = setup();
  await game.startNextQuestion();
  choices[0] = { a: { mode: "self", selected: [1] }, b: { mode: "self", selected: [1] } };
  await game.syncCaptainChoices();
  await game.closeRound();
  const next = await game.startNextQuestion();
  assert.equal(next.index, 1);
  await assert.rejects(() => game.startNextQuestion(), /Нельзя начать вопрос/);
  assert.equal(game.round.index, 1);
});

// Смена капитана выравнивает players/{uid} — иначе новый капитан не может ответить.
test("выбывший капитан: новый капитан получает isCaptain, старый — сброс", async () => {
  const { game, playerWrites, roster } = setup();
  await game.startNextQuestion();
  playerWrites.length = 0;
  await game.eliminate("u1"); // капитан A выбывает
  const newCap = game.state.roster.captains.a;
  assert.ok(newCap && newCap !== "u1", "вместо выбывшего назначен новый капитан");
  const toNew = playerWrites.find(w => w.uid === newCap);
  assert.ok(toNew, "новому капитану записано поле");
  assert.equal(toNew.fields.isCaptain, true);
  const toOld = playerWrites.find(w => w.uid === "u1");
  assert.equal(toOld.fields.isCaptain, false, "выбывший больше не капитан");
});

test("повторная публикация без изменений состава не пишет поля игроков", async () => {
  const { game, playerWrites } = setup();
  await game.startNextQuestion();
  playerWrites.length = 0;
  await game.startSuddenDeathRound().catch(() => {});
  assert.equal(playerWrites.length, 0);
});

// Перезагрузка ведущего во время вопроса: ответ капитана не теряется.
test("после перезагрузки ведущего ответ самостоятельного капитана восстанавливается", async () => {
  const first = setup();
  await first.game.startNextQuestion();
  first.choices[0] = { a: { mode: "self", selected: [1] } };
  await first.game.captainChoose("a", { mode: "self", selected: [1] }); // режим записан
  // Документ как после запуска: в нём есть settings (их пишет launch).
  const doc = { ...first.saved.at(-1), settings: first.settings };
  const restored = BattleGame.restore({
    doc, questions: first.qs, rounds: [], liveInfo: {}, store: first.store, now: first.now
  });
  // Память нового экземпляра пуста, но решение капитана в хранилище есть.
  assert.equal(restored.round.selfAnswers.a, undefined);
  await restored.syncCaptainChoices();
  await restored.closeRound();
  assert.equal(first.rounds.length, 1, "раунд записан один раз через store.saveRound");
  const rec = restored.state.rounds.at(-1);
  assert.equal(rec.teams.a.status, "resolved");
  assert.ok(rec.teams.a.points.total > 0, "очки не теряются после перезагрузки");
});

// Капитан передаёт право ответа команде голосованием (mode: "vote").
test("капитан открывает голосование: раунд переходит в voting, голоса команды засчитываются", async () => {
  const { game, choices, votes, rounds, roster } = setup();
  await game.startNextQuestion();
  // Команда B отвечает сама, раунд закроется, когда проголосует команда A.
  choices[0] = { a: { mode: "vote" }, b: { mode: "self", selected: [1] } };
  await game.syncCaptainChoices();
  assert.equal(game.phase, "voting", "после решения капитана раунд в голосовании");
  assert.equal(game.round.modes.a, "vote");
  // Все участники команды A (включая капитана) голосуют за верный вариант.
  const team = L.eligibleVoters(roster, "a");
  // Хранилище голосов индексируется номером раунда.
  votes[0] = Object.fromEntries(team.map(uid => [uid, { selected: [1] }]));
  await game.refreshVoteCounts();
  assert.equal(game.voted.a.voted, team.length, "счётчик «проголосовало» совпадает");
  await game.autoStep();
  assert.equal(rounds.length, 1, "раунд закрыт, когда команда проголосовала");
  assert.equal(rounds[0].teams.a.mode, "vote");
  assert.equal(rounds[0].teams.a.status, "resolved");
  assert.ok(rounds[0].teams.a.points.total > 0, "голосование команды даёт очки");
});
