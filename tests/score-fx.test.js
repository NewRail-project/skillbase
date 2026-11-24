// tests/score-fx.test.js — эффекты начисления очков Battle: без дублей и повторов.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createScoreFxTracker, runningScores, roundKey, limitEffects } from "../core/score-fx.js";

const sum = (index, a, b, kind = "main") => ({
  index, kind, teams: { a: { points: { total: a } }, b: { points: { total: b } } }
});
const battle = (summaries, total = 4) => ({
  questions: Array.from({ length: total }, (_, i) => ({ id: `q${i}` })),
  roundSummaries: summaries
});

test("первый снимок (открытие/переподключение) эффектов не создаёт", () => {
  const t = createScoreFxTracker();
  assert.deepEqual(t.consume(battle([sum(0, 10, 0), sum(1, 0, 8)])), []);
  assert.equal(t.seenCount(), 2);
});

test("новый раунд даёт +N для команды, получившей очки; ноль — без эффекта", () => {
  const t = createScoreFxTracker();
  t.consume(battle([]));
  const fx = t.consume(battle([sum(0, 12.5, 0)]));
  assert.deepEqual(fx.map(e => [e.team, e.points]), [["a", 12.5]]);
  const both = t.consume(battle([sum(0, 12.5, 0), sum(1, 5, 7)]));
  assert.deepEqual(both.map(e => [e.team, e.points]), [["a", 5], ["b", 7]]);
});

test("повторный снимок с теми же раундами не дублирует эффект", () => {
  const t = createScoreFxTracker();
  t.consume(battle([]));
  assert.equal(t.consume(battle([sum(0, 10, 0)])).length, 1);
  for (let i = 0; i < 5; i += 1) assert.deepEqual(t.consume(battle([sum(0, 10, 0)])), []);
});

test("быстрая пачка раундов обрабатывается по порядку и по разу", () => {
  const t = createScoreFxTracker();
  t.consume(battle([]));
  const fx = t.consume(battle([sum(0, 10, 0), sum(1, 0, 10), sum(2, 10, 0)]));
  assert.deepEqual(fx.map(e => `${e.key}:${e.team}`), ["main:0:a", "main:1:b", "main:2:a"]);
  assert.deepEqual(t.consume(battle([sum(0, 10, 0), sum(1, 0, 10), sum(2, 10, 0), sum(3, 5, 0)])).map(e => e.key), ["main:3"]);
});

test("решающее начисление: последний вопрос, смена лидера, решающий раунд", () => {
  const t = createScoreFxTracker();
  t.consume(battle([], 3));
  const r1 = t.consume(battle([sum(0, 10, 0)], 3));
  assert.equal(r1[0].decisive, false, "первое начисление — обычное");
  const flip = t.consume(battle([sum(0, 10, 0), sum(1, 0, 15)], 3));
  assert.equal(flip[0].decisive, true, "лидер сменился: 10:0 → 10:15");
  const last = t.consume(battle([sum(0, 10, 0), sum(1, 0, 15), sum(2, 6, 0)], 3));
  assert.equal(last[0].decisive, true, "последний основной вопрос");
  const sd = t.consume(battle([sum(0, 10, 0), sum(1, 0, 15), sum(2, 6, 0), sum(0, 1, 0, "extra")], 3));
  assert.equal(sd[0].decisive, true, "решающий раунд капитанов");
  assert.equal(sd[0].kind, "extra");
});

test("runningScores считает нарастающий итог без накопления ошибки", () => {
  const r = runningScores([sum(0, 0.1, 0), sum(1, 0.2, 0)]);
  assert.equal(r[1].a, 0.3);
  assert.equal(roundKey({ index: 2 }), "main:2");
});

test("limitEffects не заваливает экран, решающие эффекты сохраняются", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ key: `main:${i}`, team: "a", points: 1, decisive: i === 3 }));
  const out = limitEffects(many, 4);
  assert.equal(out.length, 4);
  assert.ok(out.some(e => e.key === "main:3"), "решающий не потерян");
  assert.deepEqual(limitEffects([], 4), []);
  assert.equal(limitEffects(many.slice(0, 3), 4).length, 3);
});
