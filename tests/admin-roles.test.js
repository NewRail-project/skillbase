import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_ROLE,
  normalizeEmail,
  isSameOrg,
  countAdmins,
  findUserByEmail,
  canAssignAdmin,
  canRevokeAdmin,
  roleAfterRevoke
} from "../core/admin-roles.js";

const admin = {
  uid: "admin-1",
  email: "admin@example.com",
  role: "admin",
  orgId: "default-org"
};

const student = {
  uid: "student-1",
  email: "student@example.com",
  role: "student",
  orgId: "default-org"
};

const secondAdmin = {
  uid: "admin-2",
  email: "second@example.com",
  role: "admin",
  orgId: "default-org"
};

test("email нормализуется без регистра и пробелов", () => {
  assert.equal(normalizeEmail("  Student@Example.COM "), "student@example.com");
  assert.equal(normalizeEmail(null), "");
});

test("поиск идёт по точному email без учёта регистра", () => {
  const users = [admin, student];
  assert.equal(findUserByEmail(users, " STUDENT@example.com "), student);
  assert.equal(findUserByEmail(users, "student@example"), null);
  assert.equal(findUserByEmail(users, ""), null);
});

test("организация сравнивается по orgId", () => {
  assert.equal(isSameOrg(admin, student), true);
  assert.equal(isSameOrg(admin, { ...student, orgId: "other-org" }), false);
  assert.equal(isSameOrg(admin, { uid: "x" }), false);
});

test("администраторы считаются в пределах организации", () => {
  const users = [admin, secondAdmin, student, { uid: "other", role: "admin", orgId: "other-org" }];
  assert.equal(countAdmins(users, "default-org"), 2);
  assert.equal(countAdmins(users), 3);
  assert.equal(countAdmins([], "default-org"), 0);
});

test("назначить администратора может только администратор", () => {
  const result = canAssignAdmin({ actor: { ...student, role: "teacher" }, target: student, users: [student] });
  assert.equal(result.ok, false);
  assert.equal(result.code, "not_admin");
});

test("нельзя назначить администратора из другой организации", () => {
  const result = canAssignAdmin({
    actor: admin,
    target: { ...student, orgId: "other-org" },
    users: [admin, student]
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "other_org");
});

test("повторное назначение администратора отклоняется", () => {
  const result = canAssignAdmin({ actor: admin, target: secondAdmin, users: [admin, secondAdmin] });
  assert.equal(result.ok, false);
  assert.equal(result.code, "already_admin");
});

test("администратор назначает студента своей организации", () => {
  const result = canAssignAdmin({ actor: admin, target: student, users: [admin, student] });
  assert.equal(result.ok, true);
  assert.equal(result.code, "ok");
});

test("снять роль можно только с администратора", () => {
  const result = canRevokeAdmin({ actor: admin, target: student, users: [admin, student] });
  assert.equal(result.ok, false);
  assert.equal(result.code, "not_admin_target");
});

test("нельзя снять административную роль с себя", () => {
  const result = canRevokeAdmin({ actor: admin, target: admin, users: [admin, secondAdmin] });
  assert.equal(result.ok, false);
  assert.equal(result.code, "self");
  assert.match(result.error, /последнего администратора/);
});

test("последний администратор защищён от снятия роли", () => {
  const result = canRevokeAdmin({
    actor: { ...admin, uid: "another-admin" },
    target: admin,
    users: [admin]
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "last_admin");
});

test("администратор снимает роль с коллеги, если остаётся сам", () => {
  const result = canRevokeAdmin({ actor: admin, target: secondAdmin, users: [admin, secondAdmin] });
  assert.equal(result.ok, true);
  assert.equal(result.code, "ok");
});

test("нельзя менять роли в чужой организации", () => {
  const result = canRevokeAdmin({
    actor: admin,
    target: { ...secondAdmin, orgId: "other-org" },
    users: [admin, secondAdmin]
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "other_org");
});

test("после снятия остаётся преподаватель или студент", () => {
  assert.equal(roleAfterRevoke("student"), "student");
  assert.equal(roleAfterRevoke("teacher"), "teacher");
  assert.equal(roleAfterRevoke("admin"), "teacher");
  assert.equal(roleAfterRevoke(undefined), "teacher");
  assert.equal(ADMIN_ROLE, "admin");
});
