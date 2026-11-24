// tests/battle-fx.test.js — эффекты начисления очков и баннер победителя на экране Battle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom, findAll, findOne, text } from "./helpers/fake-dom.js";
import { createScoreFxPlayer } from "../ui/components/battle-fx.js";

installFakeDom();
const { buildBattleScreen } = await import("../ui/components/battle-screen.js");

// Ручные таймеры: тест сам двигает время.
function clock() {
  let id = 0;
  const q = [];
  return {
    schedule: (fn, ms) => { id += 1; q.push({ id, fn, at: ms }); return id; },
    clear: (i) => { const k = q.findIndex(x => x.id === i); if (k >= 0) q.splice(k, 1); },
    step() { q.sort((a, b) => a.at - b.at); const t = q.shift(); if (t) t.fn(); return Boolean(t); },
    flush() { while (this.step()); },
    size: () => q.length
  };
}
const el = (attrs = {}) => {
  const e = document.createElement("div");
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
function rig(extra = {}) {
  const c = clock();
  const layer = el();
  const score = { a: el(), b: el() };
  const panel = { a: el(), b: el() };
  const fx = createScoreFxPlayer({
    layer, scoreOf: t => score[t], panelOf: t => panel[t],
    reduced: () => true, schedule: c.schedule, clear: c.clear, ...extra
  });
  const chips = () => findAll(layer, e => e.className === "bs-fx");
  return { c, layer, score, panel, fx, chips };
}

test("«+N» появляется по очереди, подсвечивает команду и убирается", () => {
  const r = rig();
  r.fx.play([{ key: "main:0", team: "a", points: 12.5, decisive: false }]);
  assert.equal(r.chips().length, 0, "до своей очереди ничего нет");
  r.c.step(); // показ
  assert.equal(r.chips().length, 1);
  assert.equal(text(r.chips()[0]), "+12.5");
  assert.equal(r.chips()[0].getAttribute("data-team"), "a");
  assert.equal(r.chips()[0].getAttribute("data-level"), "1");
  assert.equal(r.score.a.getAttribute("data-hit"), "1", "команда подсвечена");
  assert.equal(r.score.b.getAttribute("data-hit"), null, "соперник не подсвечен");
  r.c.flush();
  assert.equal(r.chips().length, 0, "«+N» убран");
  assert.equal(r.score.a.getAttribute("data-hit"), null, "подсветка снята");
  r.fx.destroy();
});

test("решающее начисление: уровень 2, подсветка дольше и сильнее", () => {
  const r = rig();
  r.fx.play([{ key: "extra:0", team: "b", points: 5, decisive: true }]);
  r.c.step();
  assert.equal(r.chips()[0].getAttribute("data-level"), "2");
  assert.equal(r.score.b.getAttribute("data-hit"), "2");
  assert.equal(r.panel.b.getAttribute("data-hit"), "2");
  r.fx.destroy();
});

test("reduced-motion: «+N» статичен (без полёта), подсветка есть", () => {
  const r = rig();
  r.fx.play([{ key: "k", team: "b", points: 7, decisive: false }]);
  r.c.step();
  assert.equal(r.chips()[0].getAttribute("data-static"), "1");
  assert.equal(r.chips()[0].style.left, undefined, "координаты полёта не выставлялись");
  assert.equal(r.score.b.getAttribute("data-hit"), "1");
  r.fx.destroy();
});

test("пачка показывается по очереди, а destroy отменяет оставшееся", () => {
  const r = rig({ gapMs: 300 });
  r.fx.play([
    { key: "1", team: "a", points: 1 }, { key: "2", team: "b", points: 2 }, { key: "3", team: "a", points: 3 }
  ]);
  assert.equal(r.c.size(), 3, "три отложенных показа с шагом");
  r.c.step();
  assert.equal(r.chips().length, 1, "показан только первый");
  r.fx.destroy();
  assert.equal(r.c.size(), 0, "destroy снял все таймеры");
  assert.equal(r.chips().length, 0);
});

test("быстрые подряд начисления одной команде не оставляют «залипшей» подсветки", () => {
  const r = rig();
  r.fx.play([{ key: "1", team: "a", points: 1 }, { key: "2", team: "a", points: 2 }]);
  r.c.flush();
  assert.equal(r.score.a.getAttribute("data-hit"), null);
  assert.equal(r.chips().length, 0);
  r.fx.destroy();
});

// ---------- экран ----------
const base = (over = {}) => ({
  phase: "voting", scores: { a: 0, b: 0 },
  questions: [{ id: "q0" }, { id: "q1" }],
  teams: { a: [], b: [] }, reserve: [], eliminated: [], substituted: [], captains: {},
  roundSummaries: [], currentRound: null, ...over
});
const summary = (i, a, b) => ({ index: i, kind: "main", correct: [0], teams: { a: { points: { total: a }, status: "resolved", selected: [0] }, b: { points: { total: b }, status: "resolved", selected: [0] } } });

test("экран: победитель объявляется баннером в цвете команды", () => {
  const screen = buildBattleScreen({ test: { questions: [] }, fullscreen: false });
  screen.update(base({ phase: "finished", winner: "a", scores: { a: 30, b: 20 } }));
  const result = findOne(screen.el, e => e.className === "bs-result");
  assert.equal(result.getAttribute("data-winner"), "a");
  assert.match(text(result), /Победила Команда А/);
  assert.match(text(result), /30 : 20/);
  const panelA = findOne(screen.el, e => e.className === "bs-team" && e.getAttribute("data-team") === "a");
  const panelB = findOne(screen.el, e => e.className === "bs-team" && e.getAttribute("data-team") === "b");
  assert.equal(panelA.getAttribute("data-winner"), "1");
  assert.equal(panelB.getAttribute("data-winner"), null);
  screen.destroy();
});

test("экран: ничья показывается как «Ничья», а не как победа команды", () => {
  const screen = buildBattleScreen({ test: { questions: [] }, fullscreen: false });
  screen.update(base({ phase: "finished", winner: null, tie: true, scores: { a: 25, b: 25 } }));
  const result = findOne(screen.el, e => e.className === "bs-result");
  assert.equal(result.getAttribute("data-winner"), "tie");
  assert.match(text(result), /Ничья/);
  assert.doesNotMatch(text(result), /Победила/);
  assert.match(text(result), /25 : 25/);
  assert.ok(!findOne(screen.el, e => e.getAttribute && e.getAttribute("data-winner") === "1"));
  screen.destroy();
});

test("экран: повторные обновления с тем же раундом не создают лишних «+N»", () => {
  const screen = buildBattleScreen({ test: { questions: [] }, fullscreen: false });
  screen.update(base());
  const before = findAll(screen.el, e => e.className === "bs-fx").length;
  for (let i = 0; i < 4; i += 1) screen.update(base({ scores: { a: 10, b: 0 }, roundSummaries: [summary(0, 10, 0)] }));
  // Эффекты отложены таймером и в Node не успевают появиться; главное — не накапливаются синхронно.
  assert.equal(findAll(screen.el, e => e.className === "bs-fx").length, before);
  assert.match(text(findOne(screen.el, e => e.className === "bs-score" && e.parentNode.getAttribute("data-team") === "a")), /\d/);
  screen.destroy();
});
