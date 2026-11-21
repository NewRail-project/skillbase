// tests/battle-screens.test.js — экран Battle (ведущий/наблюдатель), интерфейс
// участника, режим просмотра ТОПа и переход «К рейтингу TOP».
import test from "node:test";
import assert from "node:assert/strict";
import { installFakeDom, findAll, text } from "./helpers/fake-dom.js";
import { buildBattleScreen } from "../ui/components/battle-screen.js";
import { buildBattlePlay } from "../ui/components/battle-play.js";
import { openBattleOverlay } from "../ui/components/battle-overlay.js";
import { createTopBoard, topLayout } from "../ui/components/top-board.js";
import { targetScrollTop, findRatingTarget, RATING_ANCHOR_ATTR } from "../ui/components/rating-jump.js";

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
  reserve: ["r1"], eliminated: [], substituted: [],
  scores: { a: 5, b: 3 }, rope: 0.2, correctAnswers: { a: 1, b: 0 },
  questions: [{ id: "q0", type: "single", optionCount: 4, src: 0 }, { id: "q1", type: "multiple", optionCount: 4, src: 1 }],
  roundSummaries: [],
  currentRound: { index: 0, kind: "main", status: "voting", questionId: "q0", type: "single", optionCount: 4, durationSec: 30, startedAt: NOW - 5000, modes: { a: "vote" }, voted: { a: { voted: 2, total: 3 }, b: { voted: 0, total: 3 } } },
  ...over
});
const all = (root) => text(root);
const buttons = (root) => findAll(root, (e) => e.tag === "button");
const btn = (root, label) => buttons(root).filter((e) => text(e).includes(label));
const tick = () => new Promise((r) => setImmediate(r));

// ---------- Экран Battle ----------

test("экран Battle: команды, капитаны, счёт, вопрос, резерв — и ни одной кнопки управления", () => {
  const s = buildBattleScreen({ test: TEST, nameOf: (u) => "Имя-" + u, now: () => NOW });
  s.update(battle());
  const t = all(s.el);
  for (const part of ["Команда А", "Команда Б", "Имя-ca", "Имя-cb", "Столица Франции?", "Общий резерв", "Имя-r1", "Вопрос 1 из 2"]) {
    assert.ok(t.includes(part), `нет «${part}»`);
  }
  assert.equal(buttons(s.el).length, 0, "наблюдатель не получает кнопок управления");
  assert.equal(findAll(s.el, (e) => e.tag === "input").length, 0);
  s.destroy();
});

test("экран Battle: правильный ответ раскрывается только после закрытия раунда", () => {
  const s = buildBattleScreen({ test: TEST, now: () => NOW });
  s.update(battle());
  assert.equal(findAll(s.el, (e) => e.attrs["data-state"] === "correct").length, 0);
  const closed = battle({
    phase: "question_result",
    currentRound: { ...battle().currentRound, status: "closed", correct: [1] },
    roundSummaries: [{ index: 0, kind: "main", type: "single", correct: [1], teams: {
      a: { mode: "vote", status: "resolved", selected: [1], points: { total: 10 }, voters: 3 },
      b: { mode: "vote", status: "resolved", selected: [0], points: { total: 0 }, voters: 3 } } }]
  });
  s.update(closed);
  const correct = findAll(s.el, (e) => e.attrs["data-state"] === "correct");
  assert.equal(correct.length, 1);
  assert.match(text(correct[0]), /Париж/);
  assert.match(all(s.el), /Верно · \+10/);
  assert.match(all(s.el), /Неверно · \+0/);
  s.destroy();
});

test("экран Battle: новый голос меняет только статистику — вопрос и составы не пересобираются", () => {
  const s = buildBattleScreen({ test: TEST, nameOf: (u) => u, now: () => NOW });
  s.update(battle());
  const question = findAll(s.el, (e) => e.className === "bs-question")[0];
  const qFirst = question.children[0];
  const rosterA = findAll(s.el, (e) => e.className === "bs-roster")[0];
  const rowFirst = rosterA.children[0];
  const next = battle();
  next.currentRound = { ...next.currentRound, voted: { a: { voted: 3, total: 3 }, b: { voted: 1, total: 3 } } };
  s.update(next);
  assert.equal(question.children[0], qFirst, "узел вопроса сохранён");
  assert.equal(rosterA.children[0], rowFirst, "строка состава сохранена");
  assert.match(all(s.el), /Проголосовали: 3 из 3 · 100%/);
  assert.match(all(s.el), /Проголосовали: 1 из 3 · 33%/);
  s.destroy();
});

test("экран Battle: замена и выбывание отражаются в составах и резерве", () => {
  const s = buildBattleScreen({ test: TEST, nameOf: (u) => u, now: () => NOW });
  s.update(battle());
  s.update(battle({ eliminated: ["a2"], reserve: [], substituted: ["r1"], teams: { a: ["ca", "a1", "a2", "r1"], b: ["cb", "b1", "b2"] } }));
  const t = all(s.el);
  assert.match(t, /a2выбыл/);
  assert.match(t, /r1замена/);
  assert.match(t, /Резерв пуст/);
  s.destroy();
});

// ---------- Участник ----------

test("участник: голос можно изменить до закрытия, правильный ответ и распределение не видны", async () => {
  const sent = [];
  const v = buildBattlePlay({ uid: "a1", test: TEST, now: () => NOW, api: { castVote: async (x) => { sent.push(x); } } });
  v.update(battle());
  assert.equal(findAll(v.el, (e) => e.attrs["data-state"] === "correct").length, 0);
  assert.doesNotMatch(all(v.el), /%/);
  const pick = (label) => findAll(v.el, (e) => e.tag === "button" && e.attrs["aria-pressed"] !== undefined && text(e).includes(label))[0];
  pick("Париж").click();
  btn(v.el, "Подтвердить голос")[0].click();
  await tick();
  assert.deepEqual(sent[0], { roundId: 0, teamId: "a", selected: [1] });
  pick("Рим").click();
  assert.match(all(v.el), /ещё не отправлен/);
  btn(v.el, "Изменить голос")[0].click();
  await tick();
  assert.deepEqual(sent[1], { roundId: 0, teamId: "a", selected: [2] });
  v.destroy();
});

test("участник: новый голос команды обновляет счётчик, не пересобирая варианты", () => {
  const v = buildBattlePlay({ uid: "a1", test: TEST, now: () => NOW, api: {}, nameOf: (u) => u });
  v.update(battle());
  const list = findAll(v.el, (e) => e.className === "battle-options")[0];
  const next = battle();
  next.currentRound = { ...next.currentRound, voted: { a: { voted: 3, total: 3 }, b: { voted: 0, total: 3 } } };
  v.update(next);
  assert.equal(findAll(v.el, (e) => e.className === "battle-options")[0], list, "список вариантов тот же узел");
  assert.match(all(v.el), /3 из 3 проголосовали/);
  v.destroy();
});

test("участник: видит команду, капитана и счёт", () => {
  const v = buildBattlePlay({ uid: "a1", test: TEST, now: () => NOW, api: {}, nameOf: (u) => "Имя-" + u });
  v.update(battle());
  const t = all(v.el);
  assert.match(t, /Капитан: Имя-ca/);
  assert.match(t, /Команда A/);
  assert.match(t, /Команда A.*5/);
  v.destroy();
});

test("запасной: показывает статус и сам переключается на интерфейс игрока после замены", () => {
  const toasts = [];
  const v = buildBattlePlay({ uid: "r1", test: TEST, now: () => NOW, api: { castVote: async () => {} }, onToast: (m, k) => toasts.push([m, k]) });
  v.update(battle());
  assert.match(all(v.el), /Запасной/);
  assert.equal(findAll(v.el, (e) => e.tag === "button" && e.attrs["aria-pressed"] !== undefined && !e.disabled).length, 0);
  v.update(battle({ reserve: [], substituted: ["r1"], eliminated: ["a2"], teams: { a: ["ca", "a1", "a2", "r1"], b: ["cb", "b1", "b2"] } }));
  assert.equal(findAll(v.el, (e) => e.tag === "button" && e.attrs["aria-pressed"] !== undefined && !e.disabled).length, 4, "варианты доступны");
  assert.ok(toasts.some(([m]) => /заменили/.test(m)), "игрок уведомлён о замене");
  v.destroy();
});

test("капитан: свои кнопки голосования, но без элементов ведущего", () => {
  const decisions = [];
  const v = buildBattlePlay({ uid: "ca", test: TEST, now: () => NOW, api: { makeCaptainDecision: async (x) => { decisions.push(x); } } });
  v.update(battle({ phase: "captain_decision", currentRound: { ...battle().currentRound, status: "answering", modes: {} } }));
  assert.equal(btn(v.el, "Открыть голосование команды").length, 1);
  for (const forbidden of ["Закрыть голосование", "Выбыл", "Завершить", "Следующий вопрос"]) {
    assert.equal(btn(v.el, forbidden).length, 0, `у капитана не должно быть «${forbidden}»`);
  }
  v.destroy();
});

// ---------- Оверлей ведущего ----------

test("оверлей «Экран битвы»: открывается поверх, закрывается и возвращает прокрутку", () => {
  document.body.style.overflow = "auto";
  let unsubbed = 0, closedCb = 0;
  const feed = {};
  const ov = openBattleOverlay({
    subscribe: (onData) => { feed.push = onData; return () => { unsubbed++; }; },
    buildScreen: (controls) => buildBattleScreen({ test: TEST, now: () => NOW, controls }),
    onClosed: () => { closedCb++; }
  });
  assert.equal(document.body.style.overflow, "hidden");
  assert.ok(document.body.children.includes(ov.el));
  feed.push(battle());
  assert.match(all(ov.el), /Столица Франции/);
  assert.equal(btn(ov.el, "К управлению").length, 1);
  ov.close();
  assert.equal(document.body.style.overflow, "auto");
  assert.ok(!document.body.children.includes(ov.el));
  assert.equal(unsubbed, 1);
  assert.equal(closedCb, 1);
  ov.close(); // повторное закрытие безопасно
  assert.equal(closedCb, 1);
});

// ---------- Режим просмотра ТОПа ----------

test("ТОП: раскладка зависит от числа участников и ограничена четырьмя колонками", () => {
  assert.deepEqual(topLayout(0), { cols: 1, rows: 1 });
  assert.deepEqual(topLayout(5), { cols: 1, rows: 5 });
  assert.deepEqual(topLayout(12), { cols: 1, rows: 12 });
  assert.deepEqual(topLayout(13), { cols: 2, rows: 7 });
  assert.deepEqual(topLayout(48), { cols: 4, rows: 12 });
  assert.equal(topLayout(500).cols, 4);
  for (const n of [1, 7, 12, 13, 25, 40, 61, 100]) {
    const { cols, rows } = topLayout(n);
    assert.ok(cols * rows >= n, `${n} участников помещаются в ${cols}×${rows}`);
  }
});

test("ТОП: показывает ВСЕХ участников (не только пятёрку) и обновляется на месте", () => {
  const board = createTopBoard({ avatar: () => document.createElement("span") });
  const rows = Array.from({ length: 23 }, (_, i) => ({ uid: `u${i}`, name: `Участник ${i}`, score: 100 - i, place: i + 1 }));
  board.update(rows);
  const list = findAll(board.el, (e) => e.className === "top-list")[0];
  assert.equal(list.children.length, 23);
  const first = list.children[0];
  const next = rows.map((r) => ({ ...r }));
  next[0].score = 150;
  board.update(next);
  assert.equal(list.children[0], first, "строка не пересоздана");
  assert.match(text(first), /150 б\./);
  board.update(next.slice(0, 5));
  assert.equal(list.children.length, 5);
  board.update([]);
  assert.equal(findAll(board.el, (e) => e.className === "top-empty")[0].hidden, false, "пустой рейтинг показывает подсказку");
});

test("ТОП: порядок строк следует за местами", () => {
  const board = createTopBoard();
  board.update([{ uid: "a", name: "A", score: 5, place: 1 }, { uid: "b", name: "B", score: 3, place: 2 }]);
  const list = findAll(board.el, (e) => e.className === "top-list")[0];
  const [la, lb] = list.children;
  board.update([{ uid: "b", name: "B", score: 9, place: 1 }, { uid: "a", name: "A", score: 5, place: 2 }]);
  assert.deepEqual(list.children, [lb, la]);
});

// ---------- «К рейтингу TOP» ----------

test("переход к рейтингу: верх блока оказывается под закреплённой шапкой", () => {
  assert.equal(targetScrollTop({ targetTop: 700, scrollY: 0, offset: 72, maxScroll: 5000 }), 628);
  assert.equal(targetScrollTop({ targetTop: -300, scrollY: 1000, offset: 72, maxScroll: 5000 }), 628, "прокрутка вверх");
  assert.equal(targetScrollTop({ targetTop: 100, scrollY: 0, offset: 200, maxScroll: 5000 }), 0, "не уходит выше начала");
  assert.equal(targetScrollTop({ targetTop: 4000, scrollY: 0, offset: 72, maxScroll: 900 }), 900, "короткая страница — предел прокрутки");
});

test("переход к рейтингу: берётся первый видимый блок, пустые пропускаются", () => {
  const mk = (h) => ({ hidden: false, getBoundingClientRect: () => ({ height: h, width: h ? 300 : 0, top: 0 }) });
  const empty = mk(0), shown = mk(240), later = mk(500);
  const root = { querySelectorAll: (sel) => (sel === `[${RATING_ANCHOR_ATTR}]` ? [empty, shown, later] : []) };
  assert.equal(findRatingTarget(root), shown);
  assert.equal(findRatingTarget({ querySelectorAll: () => [empty] }), null, "рейтинг пуст — перехода нет");
});
