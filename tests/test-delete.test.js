// tests/test-delete.test.js — чистая логика удаления теста.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DELETED_STATUS,
  canDeleteTest,
  deletionPlan,
  sanitizedSettingsAfterDelete,
  explainDeleteError
} from "../core/test-delete-logic.js";

const ORG = "default-org";
const author = { uid: "t-author", role: "teacher", orgId: ORG };
const otherTeacher = { uid: "t-other", role: "teacher", orgId: ORG };
const orgAdmin = { uid: "t-admin", role: "admin", orgId: ORG };
const foreignAdmin = { uid: "t-foreign", role: "admin", orgId: "other-org" };
const student = { uid: "t-student", role: "student", orgId: ORG };

const ownTest = { id: "test-1", authorId: "t-author", orgId: ORG, status: "published" };

test("Автор удаляет собственный тест", () => {
  assert.equal(canDeleteTest(ownTest, author).allowed, true);
});

test("Чужой преподаватель не может удалить тест", () => {
  const check = canDeleteTest(ownTest, otherTeacher);
  assert.equal(check.allowed, false);
  assert.ok(check.reason);
});

test("Студент не может удалить тест", () => {
  assert.equal(canDeleteTest(ownTest, student).allowed, false);
});

test("Администратор организации может удалить тест автора", () => {
  assert.equal(canDeleteTest(ownTest, orgAdmin).allowed, true);
});

test("Администратор чужой организации не может удалить тест", () => {
  assert.equal(canDeleteTest(ownTest, foreignAdmin).allowed, false);
});

test("Без аккаунта удалить нельзя", () => {
  assert.equal(canDeleteTest(ownTest, { role: "teacher" }).allowed, false);
  assert.equal(canDeleteTest(ownTest, null).allowed, false);
});

test("Автор из другой организации — отказ", () => {
  const moved = { ...ownTest, orgId: "other-org" };
  assert.equal(canDeleteTest(moved, author).allowed, false);
});

test("deletionPlan: закрывает свои активные задания", () => {
  const plan = deletionPlan({
    test: ownTest,
    session: author,
    assignments: [
      { id: "a1", testId: "test-1", teacherId: "t-author", status: "active" },
      { id: "a2", testId: "test-1", teacherId: "t-other", status: "active" },
      { id: "a3", testId: "test-1", teacherId: "t-author", status: "closed" },
      { id: "a4", testId: "test-2", teacherId: "t-author", status: "active" }
    ],
    rooms: []
  });
  assert.deepEqual(plan.closeAssignmentIds, ["a1"]);
  // Задание другого преподавателя попадает в отчёт, а не удаляется молча.
  assert.deepEqual(plan.foreignAssignmentIds, ["a2"]);
});

test("deletionPlan: администратор закрывает задания всей организации", () => {
  const plan = deletionPlan({
    test: ownTest,
    session: orgAdmin,
    assignments: [
      { id: "a1", testId: "test-1", teacherId: "t-author", status: "active" },
      { id: "a2", testId: "test-1", teacherId: "t-other", status: "active" }
    ],
    rooms: []
  });
  assert.deepEqual(plan.closeAssignmentIds.sort(), ["a1", "a2"]);
  assert.deepEqual(plan.foreignAssignmentIds, []);
});

test("deletionPlan: закрывает только свои Live-комнаты", () => {
  const plan = deletionPlan({
    test: ownTest,
    session: author,
    assignments: [],
    rooms: [
      { code: "AB12", testId: "test-1", hostId: "t-author", status: "active" },
      { code: "CD34", testId: "test-1", hostId: "t-other", status: "active" },
      { code: "EF56", testId: "test-1", hostId: "t-author", status: "closed" },
      { code: "GH78", testId: "test-2", hostId: "t-author", status: "active" }
    ]
  });
  assert.deepEqual(plan.closeRoomCodes, ["AB12"]);
  assert.deepEqual(plan.foreignRooms, [{ code: "CD34", hostName: "" }]);
});

test("deletionPlan: имя ведущего чужой комнаты попадает в отчёт", () => {
  const plan = deletionPlan({
    test: ownTest,
    session: author,
    assignments: [],
    rooms: [
      { code: "CD34", testId: "test-1", hostId: "t-other", hostName: "Мария", status: "active" }
    ]
  });
  assert.deepEqual(plan.foreignRooms, [{ code: "CD34", hostName: "Мария" }]);
});

test("deletionPlan: повторное удаление ничего лишнего не планирует", () => {
  // Идемпотентность: задания уже закрыты, комнаты закрыты — план пуст.
  const plan = deletionPlan({
    test: { ...ownTest, status: DELETED_STATUS },
    session: author,
    assignments: [
      { id: "a1", testId: "test-1", teacherId: "t-author", status: "closed" }
    ],
    rooms: [
      { code: "AB12", testId: "test-1", hostId: "t-author", status: "closed" }
    ]
  });
  assert.deepEqual(plan.closeAssignmentIds, []);
  assert.deepEqual(plan.closeRoomCodes, []);
  assert.deepEqual(plan.foreignAssignmentIds, []);
  assert.deepEqual(plan.foreignRooms, []);
});

test("sanitizedSettingsAfterDelete: закрывает доступ к ключам, остальное сохраняет", () => {
  const clean = sanitizedSettingsAfterDelete({
    showCorrectAfterQuestion: true,
    allowRetake: false,
    timePerQuestion: 30
  });
  assert.equal(clean.showCorrectAfterQuestion, false);
  assert.equal(clean.allowRetake, false);
  assert.equal(clean.timePerQuestion, 30);
});

test("sanitizedSettingsAfterDelete: работает без настроек", () => {
  assert.deepEqual(sanitizedSettingsAfterDelete(null), { showCorrectAfterQuestion: false });
});

test("explainDeleteError: понятные причины, без скрытия", () => {
  assert.match(
    explainDeleteError({ code: "permission-denied" }),
    /автор или администратор/);
  assert.match(
    explainDeleteError({ code: "unavailable" }),
    /не удалён/);
  assert.match(
    explainDeleteError(new Error("_firestore/FAILED_PRECONDITION")),
    /Firestore/);
});
