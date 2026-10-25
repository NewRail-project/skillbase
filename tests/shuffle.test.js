import { test } from "node:test";
import assert from "node:assert/strict";
import { seededOrder, identityOrder, buildAttemptOrder } from "../core/shuffle.js";

const sorted = (a) => [...a].sort((x, y) => x - y);

test("перестановка содержит каждый индекс ровно один раз", () => {
  const order = seededOrder(20, "attempt-1");
  assert.deepEqual(sorted(order), identityOrder(20));
});

test("один seed — один порядок, другой seed — другой", () => {
  assert.deepEqual(seededOrder(15, "a"), seededOrder(15, "a"));
  assert.notDeepEqual(seededOrder(15, "a"), seededOrder(15, "b"));
});

test("пустой и единичный списки не ломаются", () => {
  assert.deepEqual(seededOrder(0, "x"), []);
  assert.deepEqual(seededOrder(1, "x"), [0]);
});

test("настройки выключены или студент — порядок исходный", () => {
  const questions = [{ type: "single", options: [{}, {}, {}] }, { type: "short" }];
  const off = buildAttemptOrder(questions, { shuffleQuestions: false, shuffleOptions: false }, "s");
  assert.deepEqual(off.questions, [0, 1]);
  assert.deepEqual(off.options[0], [0, 1, 2]);
  const staff = buildAttemptOrder(questions, { shuffleQuestions: true, shuffleOptions: true }, "s", false);
  assert.deepEqual(staff.questions, [0, 1]);
  assert.deepEqual(staff.options[0], [0, 1, 2]);
});

test("короткие ответы не перемешиваются, варианты — перестановка", () => {
  const questions = [
    { type: "multiple", options: Array.from({ length: 8 }, () => ({})) },
    { type: "short" }
  ];
  const order = buildAttemptOrder(questions, { shuffleQuestions: true, shuffleOptions: true }, "seed");
  assert.deepEqual(sorted(order.questions), [0, 1]);
  assert.deepEqual(sorted(order.options[0]), identityOrder(8));
  assert.deepEqual(order.options[1], []);
});
