import test from "node:test";
import assert from "node:assert/strict";
import * as L from "../core/battle-logic.js";

const S = L.DEFAULT_BATTLE_SETTINGS;
const ids = (n) => Array.from({ length: n }, (_, i) => "u" + (i + 1));
const mk = (n, seed = 1) => {
  const members = ids(n);
  const r = L.buildRoster({ memberIds: members, captains: { a: "u1", b: "u2" }, rng: L.createSeededRng(seed) });
  assert.ok(!r.error, r.error);
  return r.roster;
};

// ---------- настройки / фазы ----------
test("настройки по умолчанию соответствуют ТЗ и валидны", () => {
  const { settings, errors } = L.normalizeSettings();
  assert.deepEqual(errors, []);
  assert.equal(settings.minPlayers, 8);
  assert.equal(settings.reconnectMs, 60000);
  assert.equal(settings.captainTiebreakSeconds, 15);
  assert.equal(settings.teamworkThreshold, 0.8);
  assert.equal(settings.weightLive, 0.6);
  assert.equal(settings.wrongPenalty, 1.25);
});
test("настройки: неверная сумма весов отклоняется", () => {
  assert.ok(L.normalizeSettings({ weightLive: 0.9 }).errors.length > 0);
  assert.ok(L.normalizeSettings({ shareSpeed: 0.5 }).errors.length > 0);
});
test("фазы: допустимые и запрещённые переходы, идемпотентность", () => {
  const s = { phase: L.PHASES.READY };
  assert.ok(L.transitionPhase(s, L.PHASES.VOTING).error);
  const a = L.transitionPhase(s, L.PHASES.QUESTION_STARTING);
  assert.equal(a.state.phase, L.PHASES.QUESTION_STARTING);
  assert.equal(L.transitionPhase(a.state, L.PHASES.QUESTION_STARTING).changed, false);
  assert.ok(L.transitionPhase({ phase: L.PHASES.FINISHED }, L.PHASES.VOTING).error);
});

// ---------- капитаны и команды ----------
test("капитаны: 1-е → A, 2-е → B", () => {
  const r = L.pickCaptains([{ uid: "x", score: 90 }, { uid: "y", score: 80 }, { uid: "z", score: 70 }]);
  assert.deepEqual(r.captains, { a: "x", b: "y" });
});
test("капитаны: ничья за 2-е место требует Дуэли и разрешается ею", () => {
  const r = L.pickCaptains([{ uid: "x", score: 90 }, { uid: "y", score: 80 }, { uid: "z", score: 80 }, { uid: "w", score: 10 }]);
  assert.equal(r.needsDuel, true);
  assert.deepEqual(r.tied.sort(), ["y", "z"]);
  assert.equal(r.captainA, "x");
  assert.deepEqual(L.resolveCaptainsAfterDuel(r, ["z"]).captains, { a: "x", b: "z" });
  assert.ok(L.resolveCaptainsAfterDuel(r, []).error);
});
test("капитаны: двое делят 1-е место — оба капитаны, без Дуэли", () => {
  const r = L.pickCaptains([{ uid: "x", score: 90 }, { uid: "y", score: 90 }, { uid: "z", score: 10 }]);
  assert.equal(r.needsDuel, false);
});
test("команды: чётное число — равные команды без резерва", () => {
  const r = mk(10);
  assert.equal(r.teams.a.length, 5);
  assert.equal(r.teams.b.length, 5);
  assert.equal(r.reserve.length, 0);
  assert.equal(r.teams.a[0], "u1");
  assert.equal(r.teams.b[0], "u2");
});
test("команды: нечётное число — один в общий резерв, команды равны", () => {
  const r = mk(9);
  assert.equal(r.teams.a.length, 4);
  assert.equal(r.teams.b.length, 4);
  assert.equal(r.reserve.length, 1);
  assert.ok(!r.reserve.includes("u1") && !r.reserve.includes("u2"));
});
test("команды: все участники ровно один раз, капитаны не перемешиваются", () => {
  const r = mk(13);
  const all = [...r.teams.a, ...r.teams.b, ...r.reserve];
  assert.equal(new Set(all).size, 13);
});
test("команды: детерминированно при одном seed, различается при другом", () => {
  assert.deepEqual(mk(12, 5), mk(12, 5));
  assert.notDeepEqual(mk(12, 5).teams, mk(12, 6).teams);
});
test("команды: меньше 8 участников — ошибка", () => {
  assert.ok(L.buildRoster({ memberIds: ids(7), captains: { a: "u1", b: "u2" } }).error);
});
test("состав: перемещение в резерв и обратно, капитана двигать нельзя", () => {
  const r = mk(8);
  const mover = r.teams.a[1];
  const m = L.movePlayer(r, mover, "reserve");
  assert.deepEqual(m.roster.reserve, [mover]);
  assert.equal(m.roster.teams.a.length, 3);
  assert.ok(L.movePlayer(r, "u1", "reserve").error);
  assert.deepEqual(r.reserve, []); // оригинал не изменён
});
test("состав: смена капитана до старта", () => {
  const r = mk(8);
  const p = r.teams.a[1];
  const s = L.setCaptain(r, "a", p);
  assert.equal(s.roster.captains.a, p);
  assert.ok(s.roster.teams.a.includes("u1"));
  assert.ok(L.setCaptain(r, "a", "u2").error);
});

// ---------- выбывание / замены / капитанство ----------
const live = { u1: { score: 100, place: 1 }, u2: { score: 90, place: 2 } };
test("замена: резервный выходит по очереди, второй раз выйти нельзя", () => {
  let r = mk(11); // резерв из 1 → расширим вручную
  r = L.movePlayer(r, r.teams.a[2], "reserve").roster;
  r = L.movePlayer(r, r.teams.b[2], "reserve").roster;
  const [first, second] = r.reserve;
  const victim = r.teams.a[1];
  const e = L.eliminatePlayer(r, victim, { roundIndex: 3 });
  assert.ok(e.roster.teams.a.includes(first));
  assert.ok(!e.roster.reserve.includes(first));
  assert.equal(e.roster.availableFrom[first], 3);
  assert.equal(e.roster.availableTo[victim], 3);
  assert.ok(e.roster.substituted.includes(first));
  // повторная замена тем же запасным запрещена
  assert.ok(L.applySubstitution(e.roster, { replacingUid: e.roster.teams.a[1], newUid: first, roundIndex: 4 }).error);
  assert.ok(second);
});
test("выбывание идемпотентно", () => {
  const r = mk(9);
  const e1 = L.eliminatePlayer(r, r.teams.a[1], { roundIndex: 1 });
  const e2 = L.eliminatePlayer(e1.roster, r.teams.a[1], { roundIndex: 2 });
  assert.equal(e2.changed, false);
  assert.deepEqual(e2.roster, e1.roster);
});
test("пустой резерв: команда играет в уменьшенном составе", () => {
  const r = mk(8);
  const e = L.eliminatePlayer(r, r.teams.b[1], { roundIndex: 1 });
  assert.equal(L.eligibleVoters(e.roster, "b").length, 3);
  assert.ok(!e.events.some((x) => x.type === "substitution"));
});
test("капитан выбыл: капитанство к лучшему по Live; замена капитанство не наследует", () => {
  let r = mk(9); // резерв = 1 человек
  const team = r.teams.a;
  const li = { ...live, [team[1]]: { score: 50, place: 5 }, [team[2]]: { score: 70, place: 3 }, [team[3]]: { score: 70, place: 4 } };
  const sub = r.reserve[0];
  const e = L.eliminatePlayer(r, "u1", { roundIndex: 2, liveInfo: { ...li, [sub]: { score: 999, place: 0 } } });
  assert.equal(e.roster.captains.a, team[2]); // 70/место 3, а не заменивший с 999
  assert.ok(e.events.some((x) => x.type === "captain_changed"));
  assert.ok(e.roster.teams.a.includes(sub));
});
test("капитан: равные баллы Live → лучшее итоговое место, без жребия", () => {
  assert.equal(L.pickNewCaptain(["p", "q"], { p: { score: 5, place: 4 }, q: { score: 5, place: 3 } }), "q");
  assert.equal(L.pickNewCaptain(["q", "p"], { p: { score: 5, place: 3 }, q: { score: 5, place: 3 } }), "p");
});
test("доступность: заменивший доступен только с раунда выхода", () => {
  const r = mk(9);
  const sub = r.reserve[0];
  const e = L.eliminatePlayer(r, r.teams.a[1], { roundIndex: 4 });
  assert.equal(L.isAvailableInRound(e.roster, sub, 3), false);
  assert.equal(L.isAvailableInRound(e.roster, sub, 4), true);
  assert.equal(L.isAvailableInRound(e.roster, r.teams.a[1], 4), false);
  assert.equal(L.isAvailableInRound(e.roster, r.teams.a[1], 3), true);
});
test("окно переподключения 60 с", () => {
  assert.equal(L.checkReconnectWindow(0, 59000), true);
  assert.equal(L.checkReconnectWindow(0, 60001), false);
  assert.equal(L.connectionState({ lastSeenMs: 0, nowMs: 5000 }), "online");
  assert.equal(L.connectionState({ lastSeenMs: 0, nowMs: 60000 }), "grace");
  assert.equal(L.connectionState({ lastSeenMs: 0, nowMs: 200000 }), "dropped");
});

// ---------- голосование ----------
const base = { phase: L.PHASES.VOTING, optionCount: 4, type: "single" };
test("голос: только своя команда, открытая фаза, не запасной", () => {
  const r = mk(9);
  const a = r.teams.a[1];
  assert.ok(L.validateVote({ ...base, roster: r, uid: a, teamId: "a", selected: [1] }).ok);
  assert.ok(!L.validateVote({ ...base, roster: r, uid: a, teamId: "b", selected: [1] }).ok);
  assert.ok(!L.validateVote({ ...base, phase: L.PHASES.QUESTION_RESULT, roster: r, uid: a, teamId: "a", selected: [1] }).ok);
  assert.ok(!L.validateVote({ ...base, roster: r, uid: r.reserve[0], teamId: "a", selected: [1] }).ok);
  assert.ok(!L.validateVote({ ...base, roster: r, uid: a, teamId: "a", selected: [1, 2] }).ok);
  assert.ok(!L.validateVote({ ...base, roster: r, uid: a, teamId: "a", selected: [9] }).ok);
});
test("голос: смена голоса — один действующий голос, повтор идемпотентен", () => {
  let v = L.applyVote({}, { uid: "p", selected: [1], at: 1 });
  v = L.applyVote(v, { uid: "p", selected: [2], at: 2 });
  assert.deepEqual(Object.keys(v), ["p"]);
  assert.deepEqual(v.p.selected, [2]);
  assert.equal(L.applyVote(v, { uid: "p", selected: [2], at: 99 }), v);
});
test("голос: видно только количество проголосовавших", () => {
  const c = L.votedCount({ a: { selected: [0] }, z: { selected: [1] } }, ["a", "b", "c"]);
  assert.deepEqual(c, { voted: 1, total: 3 });
});
const vt = (m) => Object.fromEntries(Object.entries(m).map(([k, s]) => [k, { selected: s }]));
test("одиночный: побеждает большинство", () => {
  const r = L.resolveTeamAnswer({ type: "single", optionCount: 4, votes: vt({ a: [1], b: [1], c: [2] }), eligible: ["a", "b", "c"] });
  assert.deepEqual([r.status, r.selected], ["resolved", [1]]);
});
test("одиночный: ничья → ожидание капитана; решил — принято; не решил за 15 с — ответа нет", () => {
  const args = { type: "single", optionCount: 4, votes: vt({ a: [1], b: [2] }), eligible: ["a", "b"] };
  assert.equal(L.resolveTeamAnswer(args).status, "tiebreak");
  assert.deepEqual(L.resolveTeamAnswer({ ...args, decisions: { pick: 2 } }).selected, [2]);
  const exp = L.resolveTeamAnswer({ ...args, tiebreakExpired: true });
  assert.deepEqual([exp.status, exp.selected], ["unresolved", []]);
  // капитан не может выбрать вариант вне спорных
  assert.equal(L.resolveTeamAnswer({ ...args, decisions: { pick: 3 } }).status, "tiebreak");
});
test("множественный: большинство по каждому варианту", () => {
  const r = L.resolveTeamAnswer({ type: "multiple", optionCount: 4, votes: vt({ a: [0, 1], b: [0, 2], c: [0, 1] }), eligible: ["a", "b", "c"] });
  assert.deepEqual([r.status, r.selected], ["resolved", [0, 1]]);
});
test("множественный: спорный вариант (ровно половина) — решает капитан, иначе исключается", () => {
  const args = { type: "multiple", optionCount: 3, votes: vt({ a: [0, 1], b: [0], c: [0, 1], d: [0] }), eligible: ["a", "b", "c", "d"] };
  const pending = L.resolveTeamAnswer(args);
  assert.equal(pending.status, "tiebreak");
  assert.deepEqual(pending.tied, [1]);
  assert.deepEqual(L.resolveTeamAnswer({ ...args, decisions: { options: { 1: true } } }).selected, [0, 1]);
  assert.deepEqual(L.resolveTeamAnswer({ ...args, decisions: { options: { 1: false } } }).selected, [0]);
  assert.deepEqual(L.resolveTeamAnswer({ ...args, tiebreakExpired: true }).selected, [0]);
});
test("нет голосов → ответа нет", () => {
  assert.equal(L.resolveTeamAnswer({ type: "single", optionCount: 3, votes: {}, eligible: ["a"] }).status, "unresolved");
});
test("голоса запасных/выбывших не учитываются в подсчёте", () => {
  const r = L.resolveTeamAnswer({ type: "single", optionCount: 3, votes: vt({ a: [1], ghost: [2], ghost2: [2] }), eligible: ["a"] });
  assert.deepEqual(r.selected, [1]);
});
test("таймер решения капитана 15 с", () => {
  assert.equal(L.captainTiebreakLeftMs(1000, 6000), 10000);
  assert.equal(L.captainTiebreakLeftMs(1000, 17000), 0);
});

// ---------- очки ----------
test("множественный выбор: штраф 125% от одного верного (пример из ТЗ)", () => {
  // верные A,B,C (0,1,2); выбрал A,B,D → 2 − 1.25 = 0.75 из 3
  assert.equal(L.answerRatio({ selected: [0, 1, 3], correct: [0, 1, 2] }), 0.25);
  assert.equal(L.answerRatio({ selected: [0, 1, 2], correct: [0, 1, 2] }), 1);
  assert.equal(L.answerRatio({ selected: [0], correct: [0, 1, 2] }), 1 / 3);
  assert.equal(L.answerRatio({ selected: [0, 3, 4], correct: [0, 1, 2] }), 0); // не ниже 0
  assert.equal(L.answerRatio({ selected: [0, 1, 2, 3], correct: [0, 1, 2] }), 0.25 * 0 + (3 - 1.25) / 3);
  assert.equal(L.answerRatio({ selected: [0, 1], correct: [0, 1] }), 1);
});
test("штраф считается без накопленной ошибки округления", () => {
  const r = L.answerRatio({ selected: [0, 1, 2, 3, 4, 5, 6], correct: [0, 1, 2, 3, 4, 5, 6, 7, 8] });
  assert.equal(r, 7 / 9);
  assert.equal(L.answerRatio({ selected: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], correct: [0, 1, 2, 3, 4, 5, 6, 7, 8] }), (9 - 1.25) / 9);
});
test("штраф настраивается", () => {
  assert.equal(L.answerRatio({ selected: [0, 1, 3], correct: [0, 1, 2], penalty: 1 }), 1 / 3);
});
test("одиночный: только точное совпадение", () => {
  assert.equal(L.answerRatio({ selected: [2], correct: [2] }), 1);
  assert.equal(L.answerRatio({ selected: [1], correct: [2] }), 0);
  assert.equal(L.answerRatio({ selected: [1, 2], correct: [2] }), 0);
});
test("скорость линейна", () => {
  assert.equal(L.timeLeftRatio(30, 0), 1);
  assert.equal(L.timeLeftRatio(30, 15000), 0.5);
  assert.equal(L.timeLeftRatio(30, 30000), 0);
  assert.equal(L.timeLeftRatio(30, 99999), 0);
});
test("очки: правильный быстрый ответ с бонусом команды = 100%", () => {
  const p = L.scoreTeamAnswer({ ratio: 1, fullyCorrectShare: 1, voters: 5, mode: "vote", answered: true, answeredMs: 0, durationSec: 30 });
  assert.deepEqual(p, { correctness: 6, speed: 2, teamwork: 2, total: 10 });
});
test("очки: правильность 60% / скорость 20% / команда 20% — раздельно", () => {
  const p = L.scoreTeamAnswer({ ratio: 1, fullyCorrectShare: 0.5, voters: 4, mode: "vote", answered: true, answeredMs: 15000, durationSec: 30 });
  assert.deepEqual(p, { correctness: 6, speed: 1, teamwork: 0, total: 7 });
});
test("очки: неправильный ответ не получает скорость и бонус", () => {
  const p = L.scoreTeamAnswer({ ratio: 0, fullyCorrectShare: 0, voters: 5, mode: "vote", answered: true, answeredMs: 0, durationSec: 30 });
  assert.equal(p.total, 0);
});
test("очки: частично верный множественный — скорость пропорциональна доле", () => {
  const p = L.scoreTeamAnswer({ ratio: 0.5, mode: "vote", answered: true, answeredMs: 0, durationSec: 30 });
  assert.deepEqual([p.correctness, p.speed, p.teamwork], [3, 1, 0]);
});
test("командный бонус: порог 80% включительно", () => {
  const f = (share) => L.scoreTeamAnswer({ ratio: 1, fullyCorrectShare: share, voters: 5, mode: "vote", answered: true, answeredMs: 30000, durationSec: 30 }).teamwork;
  assert.equal(f(0.8), 2);
  assert.equal(f(0.79), 0);
});
test("самостоятельный ответ капитана — без командного бонуса", () => {
  const p = L.scoreTeamAnswer({ ratio: 1, fullyCorrectShare: 1, voters: 1, mode: "self", answered: true, answeredMs: 0, durationSec: 30 });
  assert.equal(p.teamwork, 0);
  assert.equal(p.total, 8);
});
test("истечение времени: все компоненты 0", () => {
  assert.equal(L.scoreTeamAnswer({ ratio: 1, answered: false, durationSec: 30 }).total, 0);
});

// ---------- раунд целиком ----------
const q1 = { id: "q1", type: "single", optionCount: 4, correct: [2] };
const q2 = { id: "q2", type: "multiple", optionCount: 5, correct: [0, 1, 2] };
const team = (o) => ({ teamId: "a", mode: "vote", captainUid: "c", eligible: ["c", "p", "q", "r", "s"], votes: {}, decisions: {}, tiebreakExpired: false, answeredMs: 0, timedOut: false, ...o });

test("раунд: 4 из 5 полностью верно → бонус (80%)", () => {
  const t = L.evaluateTeamRound({
    question: q1, durationSec: 30, settings: S,
    team: team({ votes: vt({ c: [2], p: [2], q: [2], r: [2], s: [1] }), answeredMs: 0 })
  });
  assert.equal(t.status, "resolved");
  assert.equal(t.points.teamwork, 2);
  assert.equal(t.points.total, 10);
  assert.equal(t.voters, 5);
});
test("раунд: капитан отвечает сам — остальные недоступны, бонус 0", () => {
  const t = L.evaluateTeamRound({ question: q1, durationSec: 30, settings: S, team: team({ mode: "self", captainSelected: [2], answeredMs: 0 }) });
  assert.equal(t.points.teamwork, 0);
  assert.deepEqual(Object.keys(t.answers), ["c"]);
});
test("раунд: таймаут сохраняет участие проголосовавших, очки 0", () => {
  const t = L.evaluateTeamRound({ question: q1, durationSec: 30, settings: S, team: team({ votes: vt({ p: [2] }), timedOut: true }) });
  assert.equal(t.points.total, 0);
  assert.equal(t.status, "timeout");
  assert.deepEqual(t.voted, ["p"]);
});
test("раунд: нерешённая ничья — 0 очков, участие сохранено", () => {
  const t = L.evaluateTeamRound({ question: q1, durationSec: 30, settings: S, team: team({ votes: vt({ p: [2], q: [1] }), tiebreakExpired: true }) });
  assert.equal(t.points.total, 0);
  assert.equal(t.voted.length, 2);
});
test("раунд: множественный, частично верно", () => {
  const t = L.evaluateTeamRound({ question: q2, durationSec: 30, settings: S, team: team({ votes: vt({ c: [0, 1], p: [0, 1], q: [0, 1], r: [0, 1], s: [0, 1] }), answeredMs: 0 }) });
  assert.equal(t.ratio, 0.6667);
  assert.equal(t.fullyCorrect, false);
  assert.equal(t.points.teamwork, 0);
});

// ---------- состояние, идемпотентность, победитель ----------
const record = (index, ptsA, ptsB, kind = "main") => ({
  index, kind, teams: {
    a: { points: { total: ptsA, teamwork: 0 }, fullyCorrect: ptsA > 0 },
    b: { points: { total: ptsB, teamwork: 0 }, fullyCorrect: ptsB > 0 }
  }
});
test("очки раунда не начисляются дважды", () => {
  const st = L.createBattleState({ settings: S, roster: mk(8), questionIds: ["q1", "q2"] });
  const a = L.applyRoundResult(st, record(0, 5, 3));
  const b = L.applyRoundResult(a.state, record(0, 5, 3));
  assert.equal(b.changed, false);
  assert.deepEqual(b.state.scores, { a: 5, b: 3 });
});
test("победитель и ничья", () => {
  assert.equal(L.determineWinner({ a: 5, b: 3 }).winnerId, "a");
  const t = L.determineWinner({ a: 4, b: 4 });
  assert.deepEqual([t.winnerId, t.tie], [null, true]);
});
test("ничья после всех вопросов → решающий раунд; иначе нет", () => {
  let st = L.createBattleState({ settings: S, roster: mk(8), questionIds: ["q1"] });
  st = L.applyRoundResult(st, record(0, 5, 5)).state;
  assert.equal(L.needsSuddenDeath(st), true);
  st = L.createBattleState({ settings: S, roster: mk(8), questionIds: ["q1"] });
  st = L.applyRoundResult(st, record(0, 6, 5)).state;
  assert.equal(L.needsSuddenDeath(st), false);
});
test("решающий раунд: правила победы", () => {
  const w = (a, b) => L.resolveSuddenDeathRound({ a, b });
  assert.equal(w({ correct: true, ms: 3000 }, { correct: true, ms: 2000 }).winner, "b");
  assert.equal(w({ correct: false, ms: 100 }, { correct: true, ms: 9000 }).winner, "b"); // быстрый неверный не побеждает
  assert.equal(w({ correct: false, ms: 1 }, { correct: false, ms: 2 }).next, true);
  assert.equal(w({ correct: true, ms: 2000 }, { correct: true, ms: 2000 }).next, true);
});
test("доп. вопросы без ограничения: банк идёт по кругу", () => {
  const bank = ["x", "y"];
  assert.equal(L.pickExtraQuestion(bank, 0), "x");
  assert.equal(L.pickExtraQuestion(bank, 5), "y");
  assert.equal(L.pickExtraQuestion([], 3), null);
});
test("победа капитана в решающем раунде определяет победителя битвы", () => {
  let st = L.createBattleState({ settings: S, roster: mk(8), questionIds: ["q1"] });
  st = L.applyRoundResult(st, record(0, 5, 5)).state;
  st = L.applySuddenDeathResult(st, { winner: "b" });
  const f = L.finishBattle(st).state;
  assert.equal(f.winner, "b");
  assert.equal(L.finishBattle(f).changed, false);
});
test("досрочное завершение: считаются только закрытые раунды", () => {
  let st = L.createBattleState({ settings: S, roster: mk(8), questionIds: ["q1", "q2", "q3"] });
  st = L.applyRoundResult(st, record(0, 4, 2)).state;
  const f = L.finishBattle(st, { early: true }).state;
  assert.equal(f.finishedEarly, true);
  assert.equal(f.rounds.length, 1);
  assert.equal(f.winner, "a");
});
test("канат: пропорционален, ограничен, равный счёт = центр", () => {
  assert.equal(L.ropePosition({ scoreA: 5, scoreB: 5, scale: 30 }), 0);
  assert.equal(L.ropePosition({ scoreA: 15, scoreB: 0, scale: 30 }), 0.5);
  assert.equal(L.ropePosition({ scoreA: 0, scoreB: 99, scale: 30 }), -1);
  assert.equal(L.ropePercent(0), 50);
  assert.ok(L.ropePercent(1) < 100 && L.ropePercent(-1) > 0);
});

// ---------- оценки ----------
function playRounds(roster, rounds) {
  return rounds;
}
const rr = (index, a, b) => ({ index, kind: "main", teams: { a, b } });
const side = (o) => ({ mode: "vote", captainUid: "u1", eligible: [], answers: {}, points: { total: 0, teamwork: 0 }, ...o });

test("личная статистика: самостоятельный ответ капитана не снижает участие остальных", () => {
  const roster = mk(8);
  const mem = roster.teams.a[1];
  const rounds = [
    rr(0, side({ eligible: roster.teams.a, answers: { [mem]: 1, u1: 1 } }), side({ teamId: "b", eligible: roster.teams.b, captainUid: "u2" })),
    rr(1, side({ mode: "self", eligible: roster.teams.a, answers: { u1: 1 } }), side({ eligible: roster.teams.b, captainUid: "u2" }))
  ];
  const s = L.computePlayerStats({ uid: mem, rounds, roster, teamScores: { a: 10, b: 5 } });
  assert.equal(s.available, 1);
  assert.equal(s.participation, 1);
  const cap = L.computePlayerStats({ uid: "u1", rounds, roster, teamScores: { a: 10, b: 5 } });
  assert.equal(cap.available, 2);
});
test("неправильный ответ — не отсутствие участия", () => {
  const roster = mk(8);
  const mem = roster.teams.a[1];
  const rounds = [rr(0, side({ eligible: roster.teams.a, answers: { [mem]: 0 } }), side({ eligible: roster.teams.b, captainUid: "u2" }))];
  const s = L.computePlayerStats({ uid: mem, rounds, roster, teamScores: { a: 0, b: 0 } });
  assert.equal(s.participation, 1);
  assert.equal(s.accuracy, 0);
});
test("не голосовал, хотя мог — участие падает", () => {
  const roster = mk(8);
  const mem = roster.teams.a[1];
  const rounds = [0, 1].map((i) => rr(i, side({ eligible: roster.teams.a, answers: i === 0 ? { [mem]: 1 } : {} }), side({ eligible: roster.teams.b, captainUid: "u2" })));
  const s = L.computePlayerStats({ uid: mem, rounds, roster, teamScores: { a: 1, b: 1 } });
  assert.equal(s.participation, 0.5);
});
test("заменивший оценивается только по доступным вопросам", () => {
  const roster = mk(9);
  const sub = roster.reserve[0];
  const eligA = [...roster.teams.a];
  const rounds = [
    rr(0, side({ eligible: eligA, answers: {} }), side({ eligible: roster.teams.b, captainUid: "u2" })),
    rr(1, side({ eligible: [...eligA, sub], answers: { [sub]: 1 } }), side({ eligible: roster.teams.b, captainUid: "u2" }))
  ];
  const s = L.computePlayerStats({ uid: sub, rounds, roster: L.eliminatePlayer(roster, roster.teams.a[1], { roundIndex: 1 }).roster, teamScores: { a: 5, b: 5 } });
  assert.equal(s.available, 1);
  assert.equal(s.participation, 1);
  assert.equal(s.accuracy, 1);
});
test("запасной без замены: battle = null, итог = Live", () => {
  const roster = mk(9);
  const stats = L.computePlayerStats({ uid: roster.reserve[0], rounds: [], roster, teamScores: {} });
  assert.equal(L.battleGrade(stats), null);
  assert.equal(L.preparedness(stats), null);
  assert.equal(L.finalGrade({ live: 83.5, battle: null }), 83.5);
});
test("battle = 70/20/10 и итог 60/40", () => {
  const st = { available: 10, participated: 10, accuracy: 1, participation: 1, teamResult: 1 };
  assert.equal(L.battleGrade(st), 100);
  const mid = { available: 10, participated: 8, accuracy: 0.5, participation: 0.8, teamResult: 0.5 };
  assert.equal(L.battleGrade(mid), 56); // 35 + 16 + 5
  assert.equal(L.finalGrade({ live: 80, battle: 56 }), 70.4); // 48 + 22.4
});
test("победа команды не даёт слабому высокую оценку, поражение не обнуляет сильного", () => {
  const weakWinner = L.battleGrade({ available: 5, accuracy: 0.2, participation: 0.4, teamResult: 1 });
  const strongLoser = L.battleGrade({ available: 5, accuracy: 1, participation: 1, teamResult: 0 });
  assert.ok(strongLoser > weakWinner);
  assert.ok(strongLoser >= 90);
});
test("итоговый отчёт: сортировка по ФИО, статусы, команды", () => {
  const roster = mk(9);
  let st = L.createBattleState({ settings: S, roster, questionIds: ["q1"] });
  const info = {};
  for (const uid of ids(9)) info[uid] = { name: uid === "u3" ? "Алексеев" : uid === "u4" ? "Яковлев" : "Борисов " + uid, place: Number(uid.slice(1)), liveGrade: 80 };
  const rep = L.buildFinalReport({ state: L.finishBattle(st).state, liveInfo: info });
  assert.equal(rep.players.length, 9);
  assert.equal(rep.players[0].name, "Алексеев");
  assert.equal(rep.players.at(-1).name, "Яковлев");
  const res = rep.players.find((p) => p.isReserve);
  assert.equal(res.battleGrade, null);
  assert.equal(res.finalGrade, 80);
  assert.equal(rep.teams.a.members, 4);
});

import { sanitizeBattlePreset, BATTLE_PRESET_LIMITS as PRESET_LIMITS } from "../core/battle-logic.js";
test("настройки вопросов битвы при запуске: границы, умолчания, чужой id", () => {
  assert.deepEqual(sanitizeBattlePreset({}), { questionCount: 10, questionSeconds: 30 });
  assert.deepEqual(sanitizeBattlePreset({ battleTestId: " t1 ", questionCount: "12", questionSeconds: "45" }),
    { battleTestId: "t1", questionCount: 12, questionSeconds: 45 });
  assert.equal(sanitizeBattlePreset({ questionCount: 999 }).questionCount, PRESET_LIMITS.countMax);
  assert.equal(sanitizeBattlePreset({ questionSeconds: 1 }).questionSeconds, PRESET_LIMITS.secMin);
  assert.equal(sanitizeBattlePreset({ questionCount: -5, questionSeconds: "abc" }).questionCount, 10);
  assert.equal("battleTestId" in sanitizeBattlePreset({ battleTestId: "a/b" }), false);
  assert.equal("battleTestId" in sanitizeBattlePreset({ battleTestId: "" }), false);
});
