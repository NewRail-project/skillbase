import test from "node:test";
import assert from "node:assert";
import { computeStudentProgress } from "../core/progress.js";

test("computeStudentProgress: исключает незавершённые попытки и считает статистику", () => {
  const attempts = [
    { status: "in_progress", percent: null },
    { status: "graded", percent: 80, subjectId: "s1", topicId: "t1", testTitle: "Тест 1" },
    { status: "graded", percent: 60, subjectId: "s1", topicId: "t2", testTitle: "Тест 2" }
  ];
  const subjects = [{ id: "s1", title: "Математика" }];
  const topics = [{ id: "t1", subjectId: "s1" }, { id: "t2", subjectId: "s1" }];

  const res = computeStudentProgress(attempts, subjects, topics, new Map());
  assert.equal(res.gradedAttempts, 2);
  assert.equal(res.bestScore, 80);
  assert.equal(res.averageScore, 70);
  assert.equal(res.achievements.length, 1); // первый шаг
});

test("computeStudentProgress: слабые темы и достижения (серия, материалы)", () => {
  const attempts = [
    { status: "graded", percent: 50, topicId: "t1", testTitle: "Сложная тема" },
    { status: "graded", percent: 80, topicId: "t2", testTitle: "Хорошая тема" },
    { status: "graded", percent: 90, topicId: "t2", testTitle: "Хорошая тема 2" },
    { status: "graded", percent: 85, topicId: "t2", testTitle: "Хорошая тема 3" }
  ];
  const materialMap = new Map([["m1", { completed: true }]]);

  const res = computeStudentProgress(attempts, [], [], materialMap);
  assert.equal(res.weakTopics.length, 1);
  assert.equal(res.weakTopics[0].topicId, "t1");
  assert.ok(res.achievements.some(a => a.id === "first_material"));
  assert.ok(res.achievements.some(a => a.id === "success_streak"));
});
