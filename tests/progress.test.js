import test from "node:test";
import assert from "node:assert";
import { computeStudentProgress, resultDynamics } from "../core/progress.js";

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

test("resultDynamics: ряд по хронологии, сдвиг последнего относительно предыдущего", () => {
  const attempts = [
    { status: "graded", percent: 60, finishedAt: { toMillis: () => 3000 } },
    { status: "in_progress", percent: null, finishedAt: { toMillis: () => 4000 } },
    { status: "graded", percent: 90, finishedAt: { toMillis: () => 1000 } },
    { status: "graded", percent: 75, finishedAt: { toMillis: () => 2000 } }
  ];
  const d = resultDynamics(attempts);
  assert.deepEqual(d.series, [90, 75, 60]);
  assert.equal(d.delta, -15);
  assert.equal(d.direction, "down");
});

test("resultDynamics: пустые данные, одна попытка, рост и без изменений", () => {
  assert.deepEqual(resultDynamics([]).direction, "none");
  assert.deepEqual(resultDynamics([{ status: "in_progress", percent: null }]).direction, "none");
  const single = resultDynamics([{ status: "graded", percent: 70 }]);
  assert.equal(single.direction, "single");
  assert.deepEqual(single.series, [70]);
  assert.equal(single.delta, null);
  assert.equal(
    resultDynamics([
      { status: "graded", percent: 50, finishedAt: { toMillis: () => 1 } },
      { status: "graded", percent: 80, finishedAt: { toMillis: () => 2 } }
    ]).direction, "up");
  assert.equal(
    resultDynamics([
      { status: "graded", percent: 70, finishedAt: { toMillis: () => 1 } },
      { status: "graded", percent: 70, finishedAt: { toMillis: () => 2 } }
    ]).direction, "flat");
});

test("computeStudentProgress: полный прогресс по темам, слабые — подмножество", () => {
  const topics = [{ id: "t1", subjectId: "s1", title: "Дроби" }, { id: "t2", subjectId: "s1", title: "Уравнения" }];
  const attempts = [
    { status: "graded", percent: 50, topicId: "t1", testTitle: "Старое название" },
    { status: "graded", percent: 90, topicId: "t2" }
  ];
  const res = computeStudentProgress(attempts, [{ id: "s1", title: "Математика" }], topics, new Map());
  assert.equal(res.topicsProgress.length, 2);
  // Название берётся из справочника тем, а не из последнего теста.
  assert.equal(res.topicsProgress.find(t => t.topicId === "t1").title, "Дроби");
  assert.equal(res.topicsProgress[0].topicId, "t1"); // сортировка: слабые выше
  assert.equal(res.topicsProgress.find(t => t.topicId === "t2").attemptsCount, 1);
  // weakTopics — прежний контракт: только ниже 60.
  assert.deepEqual(res.weakTopics.map(t => t.topicId), ["t1"]);
});

test("computeStudentProgress: старые попытки без subjectId/topicId", () => {
  // Старые попытки (до этапа предметов/тем) считаются в общих числах,
  // но не приписываются предметам и темам — двойного учёта нет.
  const attempts = [
    { status: "graded", percent: 80 },                      // без привязки
    { status: "graded", percent: 60, subjectId: "s1", topicId: "t1" },
    { status: "expired", percent: null }                    // незавершённая
  ];
  const res = computeStudentProgress(
    attempts,
    [{ id: "s1", title: "Математика" }],
    [{ id: "t1", subjectId: "s1" }],
    new Map()
  );
  assert.equal(res.gradedAttempts, 2);
  assert.equal(res.bestScore, 80);
  assert.equal(res.averageScore, 70);
  assert.equal(res.subjectsProgress[0].attemptsCount, 1);
  assert.equal(res.subjectsProgress[0].averageScore, 60);
  assert.equal(res.topicsProgress.length, 1);
  assert.equal(res.dynamics.series.length, 2);
});

test("computeStudentProgress: пустые данные не падают", () => {
  const res = computeStudentProgress([], [], [], new Map());
  assert.equal(res.gradedAttempts, 0);
  assert.equal(res.bestScore, 0);
  assert.equal(res.averageScore, 0);
  assert.deepEqual(res.topicsProgress, []);
  assert.deepEqual(res.weakTopics, []);
  assert.equal(res.dynamics.direction, "none");
});
