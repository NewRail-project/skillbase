// tests/scenario-lesson.test.js — сквозной сценарий занятия в памяти:
// сценарий → этапы и условия переходов → тест с подготовленными вопросами →
// Battle с ничьей и решающими вопросами → итоговая таблица → снимок в историю →
// практика с вводом ведущим → отчёт (по алфавиту, участие, вклад, командная
// работа, рекомендуемая оценка).
// НЕ проверяется: Firestore (правила, подписки, несколько устройств), вид на
// экране, сеть. Это проверка связности логики, а не замена живой проверке.
import test from "node:test";
import assert from "node:assert/strict";
import * as L from "../core/battle-logic.js";
import { BattleGame } from "../core/battle-game.js";
import { buildBattleSnapshot, readBattleSnapshot } from "../core/battle-snapshot.js";
import { buildBattleSummary } from "../core/battle-summary.js";
import { buildLaunchPlan } from "../core/battle-launch.js";
import * as S from "../core/battle-set.js";
import * as P from "../core/practical.js";
import * as Plan from "../core/lesson-plan.js";
import { buildLessonReport, practicalForReport } from "../core/lesson-report.js";

const NAMES = ["Яковлев Пётр", "Ёлкин Иван", "Абрамов Олег", "Егоров Сергей", "Зайцева Мария", "Бойко Анна", "Нестеров Глеб", "Орлов Денис"];
const ids = NAMES.map((_, i) => "u" + (i + 1));
const nameOf = (u) => NAMES[ids.indexOf(u)];
const liveInfo = Object.fromEntries(ids.map((u, i) => [u, { name: NAMES[i], place: i + 1, score: 10 - i, liveGrade: 80 - i * 5 }]));

const Q = (n, right) => `${n}. Вопрос ${n}?\nA) один${right === 0 ? " [+]" : ""}\nB) два${right === 1 ? " [+]" : ""}\nC) три${right === 2 ? " [+]" : ""}`;
const set = S.emptyBattleSet();
set.main.questions = S.parseBattleText([Q(1, 1), Q(2, 0)].join("\n\n")).questions;
set.placeTies[1] = S.parseBattleText([Q(11, 2), Q(12, 1)].join("\n\n")).questions;

const L_ = (t) => ({ t: "label", text: t });
const A_ = (m, a) => ({ t: "answer", mode: m, accept: a });
const TASK_A = { title: "Датчик А", columns: ["Параметр", "Значение"], rows: [[L_("Номер"), A_("number", ["4"])], [L_("Неисправность"), A_("text", ["обрыв цепи"])]] };
const TASK_B = { title: "Датчик Б", columns: ["Параметр", "Значение"], rows: [[L_("Номер"), A_("number", ["7"])], [L_("Неисправность"), A_("text", ["замыкание"])]] };

// ---------- 1. Сценарий и переходы между этапами ----------

test("сценарий: этапы идут по порядку, переходы закрыты до выполнения условий, двойной клик безопасен", () => {
  const plan = Plan.normalizePlan({ topic: "Тормозная магистраль", stages: {}, tasks: { a: TASK_A, b: TASK_B } });
  assert.deepEqual(Plan.enabledStages(plan), ["material", "entry_test", "battle", "practical", "final_test", "report"]);
  let run = Plan.newRun(plan, { id: "L1", nowMs: 1 });
  assert.equal(run.stage, "material");
  run = Plan.advance(run, plan, {}, 2);
  assert.equal(run.stage, "entry_test");
  assert.throws(() => Plan.advance(run, plan, {}, 3), /Входной тест ещё не завершён/);
  run = Plan.advance(run, plan, { entryCompleted: true }, 4);
  assert.equal(run.stage, "battle");
  assert.throws(() => Plan.advance(run, plan, { entryCompleted: true }, 5), /Battle ещё не завершена/);
  run = Plan.advance(run, plan, { battleFinished: true }, 6);
  assert.equal(run.stage, "practical");
  assert.throws(() => Plan.advance(run, plan, { battleFinished: true }, 7), /не подтверждён/);
  run = Plan.advance(run, plan, { practicalConfirmed: true }, 8);
  run = Plan.advance(run, plan, { finalCompleted: true }, 9);
  assert.equal(run.stage, "report");
  assert.equal(Plan.completion(run, Plan.planOfRun(run)).percent, 100);
  assert.throws(() => Plan.advance(run, plan, { finalCompleted: true }), /последнем этапе|завершено/);
});

test("сценарий: без Battle практика пропускается сама (нет команд)", () => {
  const plan = Plan.normalizePlan({ topic: "Т", stages: { battle: false } });
  let run = Plan.newRun(plan, { id: "L2" });
  run = Plan.advance(run, plan, {});
  run = Plan.advance(run, plan, { entryCompleted: true });
  assert.equal(run.stage, "final_test", "Battle и практика отключены → сразу итоговый тест");
});

// ---------- 2. Battle: подготовленные вопросы, ничья, решающие вопросы ----------

async function playBattle() {
  const main = S.mainQuestionsForLaunch(set);
  const extras = S.extraQuestionsForBattle(set);
  assert.equal(main.questions.length, 2);
  assert.equal(extras.length, 2);
  const roster = L.buildRoster({ memberIds: ids, captains: { a: "u1", b: "u2" }, rng: L.createSeededRng(3) }).roster;
  const launch = buildLaunchPlan({ roster, questions: main.questions, extraQuestions: extras, settings: {}, hostId: "h", testId: "t" });
  assert.equal(launch.errors, undefined, "план запуска без ошибок");
  const { settings } = L.normalizeSettings({ questionSeconds: 30 });
  const saved = [], choices = {}, votes = {};
  let clock = 1000;
  const store = {
    saveBattle: async (p) => { saved.push(JSON.parse(JSON.stringify(p))); }, saveRound: async () => {}, savePlayerFields: async () => {},
    readVotes: async (i) => votes[i] || {}, readChoices: async (i) => choices[i] || {}, readDecisions: async () => ({}), logEvent: async () => {}
  };
  const game = new BattleGame({ settings, roster, questions: main.questions, extraQuestions: extras, liveInfo, store, now: () => clock });
  const vote = (uids, sel) => Object.fromEntries(uids.map((u) => [u, { selected: sel }]));
  // Основные раунды: обе команды отвечают одинаково верно → ничья по очкам.
  for (const [i, correct] of [[0, [1]], [1, [0]]]) {
    await game.startNextQuestion();
    choices[i] = { a: { mode: "vote" }, b: { mode: "vote" } };
    votes[i] = { ...vote(roster.teams.a, correct), ...vote(roster.teams.b, correct) };
    await game.autoStep();
  }
  assert.equal(await game.afterMainRounds(), "sudden_death", "счёт равный → решающий раунд капитанов");
  return { game, saved, choices, extras, roster, store };
}

test("Battle: при ничьей решающие вопросы берутся из набора «1-е место», по очереди, победитель определяется", async () => {
  const { game, saved, choices } = await playBattle();
  await game.autoStep();
  assert.equal(game.round.question.id, "x0", "первый подготовленный решающий вопрос");
  const r0 = game.round;
  choices[2] = { a: { mode: "self", selected: [0], atMs: r0.startedAt + 1 }, b: { mode: "self", selected: [1], atMs: r0.startedAt + 2 } };
  assert.equal(await game.autoStep(), "next", "оба неверно — ничья сохраняется");
  await game.autoStep();
  assert.equal(game.round.question.id, "x1", "следующий вопрос набора, без повторов");
  const r1 = game.round;
  choices[3] = { a: { mode: "self", selected: [1], atMs: r1.startedAt + 1 }, b: { mode: "self", selected: [0], atMs: r1.startedAt + 2 } };
  await game.autoStep();
  const state = game.state;
  assert.ok(["finished", "sudden_death"].includes(state.phase), "битва идёт к финалу");
  if (state.phase !== "finished") await game.finish();
  assert.equal(game.state.phase, "finished");
  assert.equal(game.state.winner, "a", "капитан A ответил верно, B — нет");
});

// Доигрывает решающие вопросы до победителя (A отвечает верно, B — нет).
async function playToWinner(env) {
  const { game, choices } = env;
  await game.autoStep();
  const r0 = game.round;
  choices[2] = { a: { mode: "self", selected: [0], atMs: r0.startedAt + 1 }, b: { mode: "self", selected: [1], atMs: r0.startedAt + 2 } };
  await game.autoStep();
  await game.autoStep();
  const r1 = game.round;
  choices[3] = { a: { mode: "self", selected: [1], atMs: r1.startedAt + 1 }, b: { mode: "self", selected: [0], atMs: r1.startedAt + 2 } };
  await game.autoStep();
  if (game.state.phase !== "finished") await game.finish();
  return env;
}

// ---------- 3. Итоговая таблица, снимок, история ----------

test("Battle → итоговая таблица → снимок → история: те же участники и счёт, личное участие только в снимке", async () => {
  const env = await playToWinner(await playBattle());
  const { game, saved } = env;
  const pub = saved.at(-1);
  assert.equal(pub.winner, "a");
  const live = buildBattleSummary({ battle: pub, nameOf });
  assert.equal(live.hasPersonal, false, "в публичном документе личного участия нет");
  assert.deepEqual(live.players.map((p) => p.name), [...live.players.map((p) => p.name)].sort((a, b) => a.localeCompare(b, "ru")));
  const snap = buildBattleSnapshot({ state: game.state, liveInfo, initialRoster: game.initialRoster, events: game.events, questions: [], finishedAtMs: 9 });
  const hist = JSON.parse(JSON.stringify({ battle: snap }));
  const read = readBattleSnapshot(hist);
  const sum = buildBattleSummary({ battle: read });
  assert.equal(sum.score.text, live.score.text, "счёт в истории = счёт на экранах");
  assert.equal(sum.hasPersonal, true);
  assert.equal(sum.players.length, live.players.length);
  assert.equal(JSON.stringify(sum).includes('"answers"'), false);
});

// ---------- 4. Практика с вводом ведущим ----------

function practicalConfirmed() {
  const SA = P.splitTask(TASK_A), SB = P.splitTask(TASK_B);
  const tasks = { a: { team: "a", ...SA.publicTask, status: "closed" }, b: { team: "b", ...SB.publicTask, status: "closed" } };
  const entry = { mode: "host", a: { r0c1: "4", r1c1: "Обрыв цепи" }, b: { r0c1: "8", r1c1: "замыкание" } };
  const subs = P.entryToSubmissions(tasks, entry);
  const evaluations = {
    a: P.evaluateSubmission({ pub: tasks.a, keys: SA.keys, cells: subs.a.cells }),
    b: P.evaluateSubmission({ pub: tasks.b, keys: SB.keys, cells: subs.b.cells })
  };
  const comparison = P.compareTeams(evaluations.a, evaluations.b);
  return practicalForReport({
    snapshot: { tasks, keys: { a: SA.keys, b: SB.keys }, submissions: {} },
    confirmed: { evaluations, comparison, confirmedAt: 5 }
  });
}

test("практика: ввод ведущим → очки → подтверждённый результат попадает в отчёт (без заполнившего капитана)", () => {
  const pr = practicalConfirmed();
  assert.equal(pr.comparison.winner, "a");
  assert.equal(pr.evaluations.a.score, 2);
  assert.equal(pr.evaluations.b.score, 1);
  assert.equal(pr.submissions.a, undefined, "в режиме ввода на доске отправленных капитаном таблиц нет");
});

// ---------- 5. Отчёт ----------

test("отчёт: участники по алфавиту, участие/вклад/командная работа, рекомендуемая оценка, практика команды", async () => {
  const { game } = await playToWinner(await playBattle());
  const snap = buildBattleSnapshot({ state: game.state, liveInfo, initialRoster: game.initialRoster, events: game.events, questions: [], finishedAtMs: 9 });
  const entry = {
    battle: readBattleSnapshot({ battle: JSON.parse(JSON.stringify(snap)) }),
    studentsDetail: ids.map((u, i) => ({ uid: u, name: nameOf(u), status: "graded", correctCount: 8 - (i % 3), total: 10, answered: 10, grade: 80 }))
  };
  const final = { studentsDetail: ids.map((u, i) => ({ uid: u, name: nameOf(u), status: "graded", correctCount: 9 - (i % 2), total: 10, answered: 10, grade: 90 })) };
  const plan = Plan.normalizePlan({ topic: "Тормозная магистраль", stages: {}, tasks: { a: TASK_A, b: TASK_B } });
  let run = Plan.newRun(plan, { id: "L3", nowMs: 1 });
  run = Plan.advance(run, plan, {}); run = Plan.advance(run, plan, { entryCompleted: true });
  run = Plan.advance(run, plan, { battleFinished: true }); run = Plan.advance(run, plan, { practicalConfirmed: true });
  run = Plan.advance(run, plan, { finalCompleted: true });
  const report = buildLessonReport({
    plan: Plan.reportPlanOfRun(run), run, entry, final, battle: entry.battle, practical: practicalConfirmed(), decisions: {}
  });
  const names = report.people.map((p) => p.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "ru")), "по алфавиту");
  assert.equal(report.participants, 8);
  for (const p of report.people) {
    assert.ok(p.recommended.grade >= 2 && p.recommended.grade <= 5, `рекомендуемая оценка есть у ${p.name}`);
    assert.ok(p.entry.available && p.final.available);
    assert.ok(p.metrics.participation !== null, `участие у ${p.name}`);
    assert.ok(p.metrics.contribution !== null || p.battle.available === false, `вклад у ${p.name}`);
    assert.ok(p.metrics.teamwork !== null, `командная работа у ${p.name}`);
    assert.ok(p.practical.available, "результат практики команды у всех, кто был в команде");
  }
  assert.equal(report.summary.practical.winner, "a");
  assert.equal(report.summary.battle.winner, "a");
  assert.equal(report.completion.percent, 100);
  assert.ok(report.notes.some((n) => /Участие, вклад и командная работа/.test(n)));
});
