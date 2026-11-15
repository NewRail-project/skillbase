// tests/journal-logic.test.js — тесты чистой логики электронного журнала.
// Проверяют: подсчет тем, дисциплин, динамику, формирование строк,
// применимость правок, проверку прав, CSV-экспорт.

import test from "node:test";
import assert from "node:assert/strict";
import { computeTopicTotals, computeDisciplineTotals, formatJournalRows,
  computeStudentProgressDynamics, checkJournalAccess, GRADE_SOURCE, ATTENDANCE_STATUS,
  isGradedStatus } from "../core/journal-logic.js";

// ---------- Базовые данные для тестов ----------

const keys = Array.from({ length: 5 }, () => ({ type: "single", points: 1, correct: [0] }));

const answersOf = (right, total = 5, answeredAll = true) => {
  const out = {};
  for (let i = 0; i < total; i++) {
    if (i < right) out[i] = 0;            // правильный ответ
    else if (answeredAll) out[i] = 1;     // неправильный ответ
    // иначе — пропуск (не будет в out, длина breakdown посчитает как skipped)
  }
  return out;
};

// Студенты с разным набором ответов
const studentA = { uid: "a", name: "Андрей" };
const studentB = { uid: "b", name: "Борис" };
const studentC = { uid: "c", name: "Елена" };

test("isGradedStatus: true for submitted/graded, false for others", () => {
  assert.strictEqual(isGradedStatus("submitted"), true);
  assert.strictEqual(isGradedStatus("graded"), true);
  assert.strictEqual(isGradedStatus("in_progress"), false);
  assert.strictEqual(isGradedStatus("cancelled"), false);
  assert.strictEqual(isGradedStatus("expired"), false);
});

test("GRADE_SOURCE enum values", () => {
  assert.strictEqual(GRADE_SOURCE.TEST, "test");
  assert.strictEqual(GRADE_SOURCE.LIVE_TEST, "live_test");
  assert.strictEqual(GRADE_SOURCE.CONTROL_WORK, "control_work");
  assert.strictEqual(GRADE_SOURCE.PRACTICAL, "practical");
  assert.strictEqual(GRADE_SOURCE.EXTRA, "extra");
  assert.strictEqual(GRADE_SOURCE.MANUAL, "manual");
});

test("ATTENDANCE_STATUS enum values", () => {
  assert.strictEqual(ATTENDANCE_STATUS.PRESENT, "present");
  assert.strictEqual(ATTENDANCE_STATUS.ABSENT, "absent");
  assert.strictEqual(ATTENDANCE_STATUS.LATE, "late");
  assert.strictEqual(ATTENDANCE_STATUS.EXCUSED, "excused");
});

test("computeTopicTotals: базовая агрегация по попыткам", () => {
  const attempts = [
    // Студент a: 5 верных из 5 по теме t1
    { userId: "a", subjectId: "math", topicId: "t1", status: "graded", score: 45, total: 50, answered: 5, gradedAt: Date.now() },
    { userId: "a", subjectId: "math", topicId: "t1", status: "graded", score: 40, total: 50, answered: 5, gradedAt: Date.now() },
    // Студент b: 3 верных из 5 по теме t1
    { userId: "b", subjectId: "math", topicId: "t1", status: "graded", score: 27, total: 50, answered: 3, gradedAt: Date.now() },
    // Студент a: 2 верных из 5 по теме t2
    { userId: "a", subjectId: "math", topicId: "t2", status: "graded", score: 18, total: 50, answered: 2, gradedAt: Date.now() },
  ];

  const topicsMap = new Map();
  topicsMap.set("t1", { title: "Числа", subjectId: "math" });
  topicsMap.set("t2", { title: "Степени", subjectId: "math" });

  const result = computeTopicTotals({ attempts, topicsMap });

  // По теме t1: earned=45+40=85, max=50+50=100, answered=5+5=10, total=10
  // knowledge = 85/100 = 0.85, participation = 10/10 = 1.0
  // grade = round(90*0.85 + 10*1.0) = round(76.5+10) = 86
  const t1 = result.perTopic.get("t1");
  assert.strictEqual(t1.testGrade, 86, "t1 testGrade should be 86 (90*0.85+10*1.0 rounded)");
  assert.strictEqual(t1.needsAgreement, false);

  // По теме t2: earned=18, max=50, answered=2, total=5
  // knowledge = 18/50 = 0.36, participation = 2/5 = 0.4
  // grade = round(90*0.36 + 10*0.4) = round(32.4+4) = 36
  const t2 = result.perTopic.get("t2");
  assert.strictEqual(t2.testGrade, 36, "t2 testGrade should be 36");
  assert.strictEqual(t2.needsAgreement, false);

  // perStudent: a имеет 2 темы, b — 1
  const aData = result.perStudent.get("a");
  assert.ok(aData, "Student a should have topic data");
  assert.ok(aData.has("t1"), "Student a should have topic t1");
  assert.ok(aData.has("t2"), "Student a should have topic t2");

  const bData = result.perStudent.get("b");
  assert.ok(bData, "Student b should have topic data");
  assert.ok(bData.has("t1"), "Student b should have topic t1");
  assert.ok(!bData.has("t2"), "Student b should not have topic t2");
});

test("computeDisciplineTotals: сбор по предметам", () => {
  const attempts = [
    { userId: "a", subjectId: "math", topicId: "t1", status: "graded", score: 45, total: 50, answered: 5 },
    { userId: "a", subjectId: "math", topicId: "t2", status: "graded", score: 30, total: 50, answered: 5 },
    { userId: "b", subjectId: "physics", topicId: "t3", status: "graded", score: 40, total: 50, answered: 4 },
  ];

  const subjectsMap = new Map();
  subjectsMap.set("math", { title: "Математика" });
  subjectsMap.set("physics", { title: "Физика" });

  const topicsMap = new Map();
  topicsMap.set("t1", { title: "Алгебра", subjectId: "math" });
  topicsMap.set("t2", { title: "Геометрия", subjectId: "math" });
  topicsMap.set("t3", { title: "Механика", subjectId: "physics" });

  const result = computeDisciplineTotals({ attempts, subjectsMap, topicsMap });

  // Дисциплина math: 2 темы, overallGrade — среднее по totalGrade
  const math = result.find(d => d.subjectId === "math");
  assert.ok(math, "Math discipline should exist");
  assert.strictEqual(math.title, "Математика", "Math title should be correct");
  assert.ok(math.overallGrade !== null, "Math should have overallGrade");

  // Дисциплина physics: 1 тема
  const physics = result.find(d => d.subjectId === "physics");
  assert.ok(physics, "Physics discipline should exist");
  assert.strictEqual(physics.title, "Физика", "Physics title should be correct");
});

test("formatJournalRows: форматирование строк с overrides и attendance", () => {
  const baseGrades = [
    { uid: "a", name: "Андрей", status: "graded", grade: 86, correctCount: 5, wrong: 0, skipped: 0, total: 5, label: "86" },
  ];

  const overrides = new Map();
  overrides.set("a", { uid: "a", from: 86, to: 92, reason: "Ручная корректировка", authorUid: "teacher-1", at: Date.now() });

  const attendanceMap = new Map();
  attendanceMap.set("a", { status: "present", date: null, discipline: "math", reason: "" });

  const result = formatJournalRows(baseGrades, { overrides, attendanceMap });

  assert.strictEqual(result.length, 1);
  const row = result[0];
  // grade должен быть применён override (92)
  assert.strictEqual(row.grade, 92, "Grade after override should be 92");
  // attendanceStatus должен быть добавлен
  assert.strictEqual(row.attendanceStatus, "present", "Attendance status should be present");
  assert.strictEqual(row.attendanceDiscipline, "math", "Discipline should be math");
});

test("computeStudentProgressDynamics: динамика оценок", () => {
  const attempts = [
    {
      userId: "a", subjectId: "math", topicId: "t1",
      status: "graded", score: 50, grade: 50,
      gradedAt: new Date("2024-01-01"), testTitle: "Тест 1"
    },
    {
      userId: "a", subjectId: "math", topicId: "t1",
      status: "graded", score: 70, grade: 70,
      gradedAt: new Date("2024-02-01"), testTitle: "Тест 2"
    },
    {
      userId: "a", subjectId: "physics", topicId: "t2",
      status: "graded", score: 60, grade: 60,
      gradedAt: new Date("2024-03-01"), testTitle: "Тест 3"
    },
  ];

  const dynamics = computeStudentProgressDynamics({ attempts, subjectId: "math" });

  assert.strictEqual(dynamics.length, 1, "Should have 1 group (math)");
  const mathGroup = dynamics[0];
  assert.strictEqual(mathGroup.discipline, "math");
  assert.strictEqual(mathGroup.entries.length, 2, "Should have 2 entries for math");
  assert.strictEqual(mathGroup.entries[0].grade, 50, "First entry grade should be 50");
  assert.strictEqual(mathGroup.entries[1].grade, 70, "Second entry grade should be 70");
});

test("checkJournalAccess: роль администратора", () => {
  assert.strictEqual(checkJournalAccess({ uid: "u" }, { role: "admin" }, "math").ok, true);
});

test("checkJournalAccess: роль учителя с доступом", () => {
  assert.strictEqual(checkJournalAccess({ uid: "u" }, { role: "teacher", teacherGroups: ["math"] }, "math").ok, true);
});

test("checkJournalAccess: роль учителя без доступа", () => {
  assert.strictEqual(checkJournalAccess({ uid: "u" }, { role: "teacher", teacherGroups: ["physics"] }, "math").ok, false);
});

test("checkJournalAccess: роль студента", () => {
  // Студент видит только свой журнал (restricted: true)
  const res = checkJournalAccess({ uid: "student-uid" }, { role: "student", uid: "student-uid", orgId: "org-123" }, null);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.restricted, true);
});

test("checkJournalAccess: неавторизованный", () => {
  assert.strictEqual(checkJournalAccess(null, null, null).ok, false);
});

// ---------- 부가тельные тесты для applyOverrides ----------

import { applyOverrides } from "../core/pair-grade.js";

test("applyOverrides: últimas запись побеждает", () => {
  const grades = [
    { uid: "a", name: "Андрей", grade: 80, status: "graded" },
    { uid: "b", name: "Борис", grade: 70, status: "graded" },
  ];

  const overrides = [
    { uid: "a", from: 80, to: 85, reason: "Первая правка", authorUid: "t1", at: 1000 },
    { uid: "a", from: 85, to: 90, reason: "Вторая правка", authorUid: "t2", at: 2000 }, // newer
  ];

  const result = applyOverrides(grades, overrides);
  assert.strictEqual(result[0].grade, 90, "Последняя правка (at=2000) должна победить, grade=90");
});

test("applyOverrides: без правок возвращает исходную", () => {
  const grades = [
    { uid: "a", name: "Андрей", grade: 80, status: "graded" },
  ];

  const result = applyOverrides(grades, []);
  assert.strictEqual(result[0].grade, 80, "Без правок grade не меняется");
});