import test from "node:test";
import assert from "node:assert/strict";
import { pickAttemptPerStudent, attemptsToPlayers } from "../core/test-history-logic.js";

const A = (id, userId, status, percent, t) => ({ id, userId, testId: "T", status, percent, submittedAt: t, userName: userId, answers: { 0: 0 } });

test("не считаются незавершённые, отменённые и просроченные попытки", () => {
  const picked = pickAttemptPerStudent([
    A("1", "u1", "in_progress", 0, 1), A("2", "u2", "cancelled", 90, 2), A("3", "u3", "expired", 50, 3), A("4", "u4", "graded", 70, 4)
  ], { testId: "T" });
  assert.deepEqual(picked.map(a => a.userId), ["u4"]);
});

test("последняя и лучшая попытки", () => {
  const list = [A("1", "u1", "graded", 90, 1), A("2", "u1", "graded", 40, 2)];
  assert.equal(pickAttemptPerStudent(list, { mode: "last" })[0].id, "2");
  assert.equal(pickAttemptPerStudent(list, { mode: "best" })[0].id, "1");
});

test("попытки другого теста игнорируются; игроки получают ответы и имя", () => {
  const picked = pickAttemptPerStudent([A("1", "u1", "graded", 90, 1), { ...A("2", "u2", "graded", 10, 1), testId: "X" }], { testId: "T" });
  const players = attemptsToPlayers(picked);
  assert.equal(players.length, 1);
  assert.equal(players[0].name, "u1");
  assert.deepEqual(players[0].answers, { 0: 0 });
});
