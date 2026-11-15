// tests/helpers/analytics-fixture.js — набор данных для тестов фильтров
// аналитики. Организация o1 — «своя», o2 — чужая (намеренно с той же
// группой "g1", чтобы совпадение имён не смешало данные).
//
// Расчётные эталоны (считаны вручную по этому набору, тесты сверяют с ними):
//   оценённые (graded): a1 90, a2 40, a3 50, a4 70, b1 80, b2 30, b3 55,
//   b4(гость) 100, L1(старая) 65 → 9 шт, среднее 64, лучший 100;
//   submitted: a6; expired: e1; in_progress: a5 (в «Попытки» не входит).
const DAY = 24 * 3600 * 1000;

export function makeFixture(now = Date.now()) {
  const ago = days => now - days * DAY;
  const base = { orgId: "o1", assignmentId: "", status: "graded", answers: {} };
  const at = (days, extra = {}) => ({ ...base, startedAt: ago(days), finishedAt: ago(days), ...extra });

  const subjects = [
    { id: "subjM", title: "Математика", orgId: "o1", status: "active" },
    { id: "subjP", title: "Физика", orgId: "o1", status: "active" },
    { id: "subjE", title: "Химия", orgId: "o1", status: "active" }
  ];
  const topics = [
    { id: "tM1", subjectId: "subjM", title: "Алгебра", orgId: "o1", status: "published", groupId: "" },
    { id: "tM2", subjectId: "subjM", title: "Геометрия", orgId: "o1", status: "published", groupId: "" },
    { id: "tP1", subjectId: "subjP", title: "Механика", orgId: "o1", status: "published", groupId: "" },
    { id: "tE1", subjectId: "subjE", title: "Органика", orgId: "o1", status: "published", groupId: "" }
  ];
  const users = [
    { uid: "u1", fullName: "Анна", groupId: "g1", role: "student", orgId: "o1" },
    { uid: "u2", fullName: "Борис", groupId: "g1", role: "student", orgId: "o1" },
    { uid: "u3", fullName: "Вера", groupId: "g2", role: "student", orgId: "o1" },
    { uid: "u4", fullName: "Глеб", groupId: "g2", role: "student", orgId: "o1" },
    { uid: "u5", fullName: "Дина", groupId: "g3", role: "student", orgId: "o1" },
    { uid: "t1", fullName: "Преподаватель", groupId: "", role: "teacher", orgId: "o1" },
    { uid: "x1", fullName: "Чужой", groupId: "g1", role: "student", orgId: "o2" }
  ];
  const assignments = [
    { id: "asM", testId: "tM", groupId: "g1", kind: "exam", orgId: "o1", status: "active", deadline: ago(10) },
    { id: "asP", testId: "tP", groupId: "g2", kind: "training", orgId: "o1", status: "active", deadline: ago(5) },
    { id: "asX", testId: "tX", groupId: "g1", kind: "exam", orgId: "o2", status: "active", deadline: ago(3) }
  ];
  const M = { subjectId: "subjM" };
  const P = { subjectId: "subjP" };
  const attempts = [
    // Математика
    at(2, { id: "a1", userId: "u1", groupId: "g1", testId: "tM", ...M, topicId: "tM1", assignmentId: "asM", percent: 90 }),
    at(3, { id: "a2", userId: "u1", groupId: "g1", testId: "tMf", ...M, topicId: "tM2", percent: 40 }),
    at(4, { id: "a3", userId: "u2", groupId: "g1", testId: "tM", ...M, topicId: "tM1", assignmentId: "asM", percent: 50 }),
    at(6, { id: "a4", userId: "u3", groupId: "g2", testId: "tMf", ...M, topicId: "tM1", percent: 70 }),
    at(1, { id: "a5", userId: "u2", groupId: "g1", testId: "tM", ...M, topicId: "tM1", assignmentId: "asM", status: "in_progress", finishedAt: null }),
    at(2, { id: "a6", userId: "u4", groupId: "g2", testId: "tMf", ...M, topicId: "tM2", status: "submitted" }),
    at(9, { id: "e1", userId: "u2", groupId: "g1", testId: "tMf", ...M, topicId: "tM1", status: "expired" }),
    // Физика (у Глеба — свободные попытки по тесту tPf, задание asP он не сдал)
    at(5, { id: "b1", userId: "u3", groupId: "g2", testId: "tP", ...P, topicId: "tP1", assignmentId: "asP", percent: 80 }),
    at(20, { id: "b2", userId: "u4", groupId: "g2", testId: "tPf", ...P, topicId: "tP1", percent: 30 }),
    at(40, { id: "b3", userId: "u4", groupId: "g2", testId: "tPf", ...P, topicId: "tP1", percent: 55 }),
    // Гость: без группы, не из ростера
    at(1, { id: "b4", userId: "guest1", userName: "Гость", guest: true, testId: "tPf", ...P, topicId: "tP1", percent: 100 }),
    // Старая попытка: нет subjectId/topicId/groupId/assignmentId, дата только в startedAt
    { id: "L1", userId: "u1", orgId: "o1", status: "graded", percent: 65, startedAt: ago(8), testId: "tOld" },
    // Чужая организация: большие оценки, чтобы любое смешение было заметно
    at(1, { id: "f1", orgId: "o2", userId: "x1", groupId: "g1", testId: "tX", ...M, percent: 100 }),
    at(1, { id: "f2", orgId: "o2", userId: "x1", groupId: "g1", testId: "tX", ...P, percent: 100 })
  ];
  return { now, subjects, topics, users, assignments, attempts };
}
