// tests/rating-and-delete.test.js — логика учебного рейтинга и удаления
// материала/теста (чистые функции + статические гарантии слоя Firestore).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rankedLeaderboard } from "../core/analytics-logic.js";
import { canDeleteMaterial, materialDeleteBlockers } from "../core/material-library-logic.js";
import { makeFixture } from "./helpers/analytics-fixture.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
const fx = makeFixture();
const names = new Map(fx.users.map(u => [u.uid, u.fullName]));

// ---------- Рейтинг ----------

test("рейтинг: средний балл оценённых попыток, организация и гости отсекаются", () => {
  const rows = rankedLeaderboard(fx.attempts, { orgId: "o1", names });
  assert.deepEqual(rows.map(r => [r.name, r.average, r.count, r.best, r.place]), [
    ["Вера", 75, 2, 80, 1],
    ["Анна", 65, 3, 90, 2],
    ["Борис", 50, 1, 50, 3],
    ["Глеб", 43, 2, 55, 4]
  ]);
  assert.ok(!rows.some(r => r.userId === "guest1" || r.userId === "x1"), "гость и чужая организация не в рейтинге");
  assert.deepEqual(rows.map(r => r.level), ["mid", "mid", "low", "low"]);
});

test("рейтинг: фильтры дисциплины и группы, незавершённые попытки не считаются", () => {
  const m = rankedLeaderboard(fx.attempts, { orgId: "o1", subjectId: "subjM", names });
  assert.deepEqual(m.map(r => [r.name, r.average]), [["Вера", 70], ["Анна", 65], ["Борис", 50]]);
  const g1 = rankedLeaderboard(fx.attempts, { orgId: "o1", subjectId: "subjM", groupId: "g1", names });
  assert.deepEqual(g1.map(r => r.name), ["Анна", "Борис"]);
  // Борис: in_progress (a5), expired (e1) и graded a3 — считается только оценённая.
  assert.equal(g1.find(r => r.name === "Борис").count, 1);
  assert.deepEqual(rankedLeaderboard(fx.attempts, { orgId: "o1", subjectId: "subjE", names }), []);
});

test("рейтинг: равный средний — одно место (1, 1, 3); имя берётся из ростера, затем из попытки", () => {
  const att = [
    { userId: "a", userName: "Из попытки", status: "graded", percent: 80, orgId: "o" },
    { userId: "b", status: "graded", percent: 80, orgId: "o" },
    { userId: "c", status: "graded", percent: 60, orgId: "o" }
  ];
  const rows = rankedLeaderboard(att, { orgId: "o", names: new Map([["b", "Из ростера"]]) });
  assert.deepEqual(rows.map(r => [r.place, r.name]), [[1, "Из попытки"], [1, "Из ростера"], [3, "Участник"]]);
  assert.deepEqual(rankedLeaderboard([], {}), []);
});

// ---------- Удаление материала ----------

test("удаление материала: только автор и администратор своей организации", () => {
  const mat = { id: "m1", orgId: "o1", authorId: "t1" };
  const as = (uid, role, orgId = "o1") => canDeleteMaterial(mat, { uid, role, orgId });
  assert.equal(as("t1", "teacher").allowed, true, "автор");
  assert.equal(as("a1", "admin").allowed, true, "администратор");
  assert.equal(as("t2", "teacher").allowed, false, "чужой преподаватель");
  assert.equal(as("s1", "student").allowed, false, "студент");
  assert.equal(as("a2", "admin", "o2").allowed, false, "администратор другой организации");
  assert.equal(canDeleteMaterial(mat, {}).allowed, false, "без входа");
  assert.equal(canDeleteMaterial(null, { uid: "a1", role: "admin", orgId: "o1" }).allowed, false);
  assert.ok(as("t2", "teacher").reason.length > 0);
});

test("удаление материала блокируется, пока к нему привязан тест (иначе студенты потеряют доступ)", () => {
  const tests = [
    { id: "t1", materialId: "m1", status: "published" },
    { id: "t2", materialId: "m1", status: "deleted" },
    { id: "t3", materialId: "m2", status: "published" },
    { id: "t4", status: "draft" }
  ];
  assert.deepEqual(materialDeleteBlockers("m1", tests).map(t => t.id), ["t1"]);
  assert.deepEqual(materialDeleteBlockers("m9", tests), []);
  assert.deepEqual(materialDeleteBlockers("", tests), []);
});

test("Firestore-слой: страницы и PDF стираются раньше документа; правило delete уже есть", () => {
  const src = read("core/material-library.js");
  const fn = src.slice(src.indexOf("export async function deleteLibraryMaterial"));
  assert.ok(fn.indexOf('["pages", "files"]') < fn.indexOf('deleteDoc(doc(db, "materials", id))'), "подколлекции — до родителя");
  assert.match(fn, /accessError\(e, "Недостаточно прав/);
  const rules = read("firestore.rules");
  assert.match(rules, /match \/materials\/\{testId\} \{[\s\S]*?allow delete: if isStaffOf\(resource\.data\.orgId\);/);
});

test("UI удаления: кнопки в материалах и на странице дисциплины, мягкое удаление теста", () => {
  const flows = read("ui/components/delete-flows.js");
  assert.match(flows, /materialDeleteBlockers\(material\.id, tests\)/);
  assert.match(flows, /tone: "danger"/);
  assert.match(flows, /await deleteTest\(test\.id, plan\)/);
  assert.match(flows, /await deleteLibraryMaterial\(material\.id\)/);
  const mats = read("ui/pages/materials.js");
  assert.match(mats, /deleteMaterialFlow\(material\)/);
  assert.match(mats, /canDeleteMaterial\(material,/);
  const disc = read("ui/pages/discipline-page.js");
  assert.match(disc, /onDelete: m => deleteMaterialFlow\(m\)/);
  assert.match(disc, /onDelete: t => deleteTestFlow\(t\)/);
  assert.match(disc, /staff && canDelete/);
  // Каталог тестов по-прежнему имеет свою кнопку удаления.
  assert.match(read("ui/pages/tests.js"), /danger-text[^\n]*"Удалить"/);
});
