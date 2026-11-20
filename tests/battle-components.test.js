import test from "node:test";
import assert from "node:assert/strict";
import { installFakeDom, findAll, text } from "./helpers/fake-dom.js";
import { roleInBattle, buildBattlePlay, battleQuestionContent } from "../ui/components/battle-play.js";
import { buildBattleScreen } from "../ui/components/battle-screen.js";
import { buildBattleHost } from "../ui/components/battle-host.js";
import { buildRope } from "../ui/components/battle-rope.js";
import { BattleGame } from "../core/battle-game.js";
import * as L from "../core/battle-logic.js";

installFakeDom();

const TEST = { questions: [
  { text: "Столица Франции?", options: ["Берлин", "Париж", "Рим", "Мадрид"] },
  { text: "Простые числа?", options: ["2", "4", "5", "9"] }
] };
const NOW = 100000;
const battle = (over = {}) => ({
  phase: "voting", settings: { captainTiebreakSeconds: 15 },
  captains: { a: "ca", b: "cb" },
  teams: { a: ["ca", "a1", "a2"], b: ["cb", "b1", "b2"] },
  reserve: ["r1"], eliminated: [],
  scores: { a: 5, b: 3 }, rope: 0.2,
  questions: [{ id: "q0", type: "single", optionCount: 4, src: 0 }, { id: "q1", type: "multiple", optionCount: 4, src: 1 }],
  roundSummaries: [],
  currentRound: { index: 0, kind: "main", status: "voting", questionId: "q0", type: "single", optionCount: 4, durationSec: 30, startedAt: NOW - 5000, modes: { a: "vote" }, voted: { a: { voted: 2, total: 3 }, b: { voted: 0, total: 3 } } },
  ...over
});
const btns = (root, label) => findAll(root, (e) => e.tag === "button" && text(e).includes(label));
const all = (root) => text(root);

test("роли: капитан, игрок, запасной, выбывший, зритель", () => {
  const b = battle({ eliminated: ["a2"] });
  assert.deepEqual(roleInBattle(b, "ca"), { role: "captain", teamId: "a" });
  assert.deepEqual(roleInBattle(b, "b1"), { role: "player", teamId: "b" });
  assert.equal(roleInBattle(b, "r1").role, "reserve");
  assert.equal(roleInBattle(b, "a2").role, "out");
  assert.equal(roleInBattle(b, "zzz").role, "viewer");
});

test("содержимое вопроса берётся из теста по src", () => {
  assert.equal(battleQuestionContent(TEST, { id: "q1", src: 1 }).options[2], "5");
  assert.equal(battleQuestionContent(TEST, { id: "q0" }).text, "Столица Франции?");
});

test("игрок: видит варианты и счётчик «2 из 3», голос уходит одним кликом (single)", async () => {
  const sent = [];
  const v = buildBattlePlay({ uid: "a1", test: TEST, now: () => NOW, api: { castVote: async (x) => { sent.push(x); } } });
  v.update(battle());
  const s = all(v.el);
  assert.match(s, /Столица Франции/);
  assert.match(s, /2 из 3 проголосовали/);
  assert.equal(findAll(v.el, (e) => e.tag === "button" && e.attrs["aria-pressed"] !== undefined).length, 4);
  findAll(v.el, (e) => e.tag === "button" && text(e).includes("Париж"))[0].click();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent, [{ roundId: 0, teamId: "a", selected: [1] }]);
  v.destroy();
});

test("игрок: не видит правильный ответ и чужие голоса до закрытия", () => {
  const v = buildBattlePlay({ uid: "a1", test: TEST, now: () => NOW, api: {} });
  v.update(battle());
  assert.equal(findAll(v.el, (e) => e.attrs["data-state"] === "correct").length, 0);
  v.destroy();
});

test("игрок множественного выбора: отправка только по кнопке, голос можно изменить", async () => {
  const sent = [];
  const v = buildBattlePlay({ uid: "a1", test: TEST, now: () => NOW, api: { castVote: async (x) => { sent.push(x); } } });
  const b = battle({ currentRound: { ...battle().currentRound, index: 1, questionId: "q1", type: "multiple" } });
  v.update(b);
  findAll(v.el, (e) => e.tag === "button" && text(e).includes("5"))[0].click();
  findAll(v.el, (e) => e.tag === "button" && text(e).includes("2") && e.attrs["aria-pressed"] !== undefined)[0].click();
  assert.equal(sent.length, 0);
  btns(v.el, "Подтвердить голос")[0].click();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent[0].selected, [0, 2]);
  assert.equal(btns(v.el, "Изменить голос").length, 1);
  v.destroy();
});

test("капитан: выбор способа — самостоятельно или голосование", async () => {
  const decisions = [];
  const v = buildBattlePlay({ uid: "ca", test: TEST, now: () => NOW, api: { makeCaptainDecision: async (x) => { decisions.push(x); } } });
  v.update(battle({ phase: "captain_decision", currentRound: { ...battle().currentRound, status: "answering", modes: {} } }));
  assert.equal(btns(v.el, "Ответить самостоятельно").length, 1);
  btns(v.el, "Открыть голосование")[0].click();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(decisions[0], { roundId: 0, teamId: "a", decision: { mode: "vote" } });
  v.destroy();
});

test("капитан отвечает сам: выбирает вариант и отправляет", async () => {
  const decisions = [];
  const v = buildBattlePlay({ uid: "ca", test: TEST, now: () => NOW, api: { makeCaptainDecision: async (x) => { decisions.push(x); } } });
  v.update(battle({ phase: "captain_decision", currentRound: { ...battle().currentRound, status: "answering", modes: {} } }));
  btns(v.el, "Ответить самостоятельно")[0].click();
  findAll(v.el, (e) => e.tag === "button" && text(e).includes("Париж"))[0].click();
  btns(v.el, "Отправить ответ")[0].click();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(decisions[0].decision, { mode: "self", selected: [1] });
  v.destroy();
});

test("не-капитан ждёт выбора; при самостоятельном ответе капитана голосовать не нужно", () => {
  const v = buildBattlePlay({ uid: "a1", test: TEST, now: () => NOW, api: {} });
  v.update(battle({ phase: "captain_decision", currentRound: { ...battle().currentRound, status: "answering", modes: {} } }));
  assert.match(all(v.el), /Капитан выбирает способ/);
  v.update(battle({ currentRound: { ...battle().currentRound, modes: { a: "self" } } }));
  assert.match(all(v.el), /Капитан отвечает самостоятельно/);
  v.destroy();
});

test("спор: капитан выбирает вариант, игроки ждут", async () => {
  const decisions = [];
  const cr = { ...battle().currentRound, status: "tiebreak", tiebreakStartedAt: NOW - 1000, tiebreak: { a: [1, 2] } };
  const cap = buildBattlePlay({ uid: "ca", test: TEST, now: () => NOW, api: { makeCaptainDecision: async (x) => { decisions.push(x); } } });
  cap.update(battle({ phase: "captain_tiebreak", currentRound: cr }));
  btns(cap.el, "Париж")[0].click();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(decisions[0], { roundId: 0, teamId: "a", decision: { pick: 1 }, tiebreak: true });
  const pl = buildBattlePlay({ uid: "a1", test: TEST, now: () => NOW, api: {} });
  pl.update(battle({ phase: "captain_tiebreak", currentRound: cr }));
  assert.match(all(pl.el), /Капитан принимает решение/);
  cap.destroy(); pl.destroy();
});

test("результат: правильный ответ и очки показываются после закрытия", () => {
  const cr = { ...battle().currentRound, status: "closed", correct: [1] };
  const v = buildBattlePlay({ uid: "a1", test: TEST, now: () => NOW, api: {} });
  v.update(battle({ phase: "question_result", currentRound: cr, roundSummaries: [{ index: 0, kind: "main", correct: [1], teams: { a: { mode: "vote", status: "resolved", selected: [1], points: { total: 8 } }, b: { mode: "vote", status: "timeout", selected: [], points: { total: 0 } } } }] }));
  assert.equal(findAll(v.el, (e) => e.attrs["data-state"] === "correct").length, 1);
  assert.match(all(v.el), /A: \+8 · B: \+0/);
  v.destroy();
});

test("запасной и выбывший не голосуют", () => {
  const rs = buildBattlePlay({ uid: "r1", test: TEST, now: () => NOW, api: {} });
  rs.update(battle());
  assert.match(all(rs.el), /наблюдаете/);
  assert.equal(findAll(rs.el, (e) => e.tag === "button" && !e.disabled).length, 0);
  const out = buildBattlePlay({ uid: "a2", test: TEST, now: () => NOW, api: {} });
  out.update(battle({ eliminated: ["a2"] }));
  assert.match(all(out.el), /выбыли/);
  rs.destroy(); out.destroy();
});

test("итог: победитель и счёт; текст «null» не появляется", () => {
  const v = buildBattlePlay({ uid: "a1", test: TEST, now: () => NOW, api: {} });
  v.update(battle({ phase: "finished", winner: "a", currentRound: null }));
  assert.match(all(v.el), /Победила команда A/);
  assert.doesNotMatch(all(v.el), /null|undefined/);
  v.destroy();
});

test("проектор: команды, капитаны, счёт, число проголосовавших; без личных ответов", () => {
  const s = buildBattleScreen({ test: TEST, nameOf: (u) => "Имя-" + u, now: () => NOW });
  s.update(battle());
  const t = all(s.el);
  assert.match(t, /Капитан: Имя-ca/);
  assert.match(t, /Проголосовали: A 2\/3 · B 0\/3/);
  assert.doesNotMatch(t, /null|undefined/);
  s.update(battle({ phase: "finished", winner: "b", scores: { a: 1, b: 9 }, currentRound: null }));
  assert.match(all(s.el), /Победила команда B/);
  s.destroy();
});

test("канат: узел смещается к лидеру и ограничен краями", () => {
  const r = buildRope(0);
  const left = () => findAll(r.el, (e) => e.style && e.style.left)[0]?.style.left;
  r.set(0); assert.equal(left(), "50%");
  r.set(1); assert.equal(left(), "8%");   // к A — влево
  r.set(-1); assert.equal(left(), "92%"); // к B — вправо
  r.set(5); assert.equal(left(), "8%");
});

// ---------- панель ведущего с реальным контроллером ----------
function hostSetup() {
  const { settings } = L.normalizeSettings({});
  const ids = Array.from({ length: 8 }, (_, i) => "u" + (i + 1));
  const roster = L.buildRoster({ memberIds: ids, captains: { a: "u1", b: "u2" }, rng: L.createSeededRng(2) }).roster;
  const votes = {}; const choices = {}; const saved = [];
  let clock = 5000;
  const store = {
    saveBattle: async (p) => saved.push(p), saveRound: async () => {}, logEvent: async () => {},
    readVotes: async (i) => votes[i] || {}, readChoices: async (i) => choices[i] || {}, readDecisions: async () => ({})
  };
  const qs = [{ id: "q0", src: 0, type: "single", optionCount: 4, correct: [1] }];
  const game = new BattleGame({ settings, roster, questions: qs, store, now: () => clock });
  return { game, votes, choices, saved, roster, tick: (ms) => { clock += ms; } };
}

test("ведущий: старт вопроса → автошаг закрывает раунд → итог сохраняется один раз", async () => {
  const { game, votes, choices, roster } = hostSetup();
  const finished = [];
  const host = buildBattleHost({ game, test: TEST, players: [], confirmFn: () => true, onFinish: async (g) => { finished.push(g.state.winner); } });
  btns(host.el, "Первый вопрос")[0].click();
  await new Promise((r) => setImmediate(r));
  assert.equal(game.phase, L.PHASES.CAPTAIN_DECISION);
  assert.doesNotMatch(all(host.el), /null|undefined/);
  choices[0] = { a: { mode: "vote" }, b: { mode: "vote" } };
  votes[0] = Object.fromEntries([...roster.teams.a, ...roster.teams.b].map((u) => [u, { selected: [1] }]));
  await host.step();
  await new Promise((r) => setImmediate(r));
  assert.equal(game.state.rounds.length, 1);
  assert.equal(game.state.scores.a > 0, true);
  // единственный вопрос и равный счёт → начинается решающий раунд капитанов
  assert.equal(game.phase, L.PHASES.SUDDEN_DEATH);
  assert.match(all(host.el), /решающий раунд капитанов/i);
  btns(host.el, "Завершить досрочно")[0].click();
  await new Promise((r) => setImmediate(r));
  assert.equal(game.phase, L.PHASES.FINISHED);
  assert.equal(finished.length, 1);
  host.stop();
});

test("ведущий: ручное выбытие игрока работает и повтор безопасен", async () => {
  const { game, roster } = hostSetup();
  const host = buildBattleHost({ game, test: TEST, players: [], confirmFn: () => true });
  const victim = roster.teams.a[1];
  assert.equal(await game.eliminate(victim), true);
  assert.equal(await game.eliminate(victim), false);
  host.render();
  host.stop();
});


test("решающий раунд: капитан отправляет ответ, остальные только наблюдают", async () => {
  const decisions = [];
  const cr = { index: 2, kind: "extra", status: "answering", questionId: "q0", type: "single", optionCount: 4, durationSec: 30, startedAt: NOW - 1000, modes: {} };
  const b = battle({ phase: "sudden_death", currentRound: cr });
  const cap = buildBattlePlay({ uid: "cb", test: TEST, now: () => NOW, api: { makeCaptainDecision: async (x) => { decisions.push(x); } } });
  cap.update(b);
  assert.match(all(cap.el), /Решающий раунд капитанов/);
  assert.equal(btns(cap.el, "Ответить самостоятельно").length, 0);
  assert.equal(btns(cap.el, "Открыть голосование").length, 0);
  btns(cap.el, "Париж")[0].click();
  btns(cap.el, "Отправить ответ")[0].click();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(decisions[0], { roundId: 2, teamId: "b", decision: { mode: "self", selected: [1] } });
  assert.match(all(cap.el), /Ответ отправлен/);
  const pl = buildBattlePlay({ uid: "a1", test: TEST, now: () => NOW, api: {} });
  pl.update(b);
  assert.match(all(pl.el), /Отвечают капитаны/);
  assert.equal(findAll(pl.el, (e) => e.tag === "button" && !e.disabled).length, 0);
  cap.destroy(); pl.destroy();
});

test("решающий раунд: между вопросами показывается причина повтора", () => {
  const pl = buildBattlePlay({ uid: "a1", test: TEST, now: () => NOW, api: {} });
  pl.update(battle({ phase: "sudden_death", currentRound: null, lastExtra: { reason: "both_wrong", next: true } }));
  assert.match(all(pl.el), /Верного ответа не было/);
  pl.destroy();
});

test("ведущий: выбывание по связи сообщает ведущему и не ломает ход", async () => {
  const { game, roster } = hostSetup();
  const msgs = [];
  await game.startNextQuestion();
  const victim = roster.teams.a.find((u) => u !== "u1");
  const now = game.now();
  const presence = Object.fromEntries([...roster.teams.a, ...roster.teams.b].map((u) => [u, now]));
  presence[victim] = now - 200000;
  const host = buildBattleHost({ game, test: TEST, players: [], getPresence: () => presence, onToast: (m) => msgs.push(m) });
  await host.step();
  assert.ok(game.state.roster.eliminated.includes(victim));
  assert.ok(msgs.some((m) => /нет связи/.test(m)));
  host.stop();
});
