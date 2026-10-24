import { test } from "node:test";
import assert from "node:assert/strict";
import { teacherCanSeeAttempt } from "../core/access.js";

const attempt = { groupId: "group1" };

test("администратор видит попытки любой группы", () => {
  assert.equal(teacherCanSeeAttempt(attempt, { role: "admin" }), true);
  assert.equal(teacherCanSeeAttempt({ groupId: "x" }, { role: "admin", teacherGroups: ["y"] }), true);
});

test("преподаватель без teacherGroups видит все группы", () => {
  assert.equal(teacherCanSeeAttempt(attempt, { role: "teacher" }), true);
  assert.equal(teacherCanSeeAttempt(attempt, { role: "teacher", teacherGroups: null }), true);
});

test("преподаватель с teacherGroups видит только свои группы", () => {
  const teacher = { role: "teacher", teacherGroups: ["group1", "group2"] };
  assert.equal(teacherCanSeeAttempt(attempt, teacher), true);
  assert.equal(teacherCanSeeAttempt({ groupId: "group3" }, teacher), false);
});

test("студент и пустой профиль не видят чужие попытки", () => {
  assert.equal(teacherCanSeeAttempt(attempt, { role: "student" }), false);
  assert.equal(teacherCanSeeAttempt(attempt, null), false);
});

test("автор теста видит попытки по своему тесту вне своих групп", () => {
  const teacher = { role: "teacher", teacherGroups: ["group2"] };
  assert.equal(teacherCanSeeAttempt({ groupId: "group9", testAuthorId: "t1" }, teacher, "t1"), true);
  assert.equal(teacherCanSeeAttempt({ groupId: "group9", testAuthorId: "t2" }, teacher, "t1"), false);
});
