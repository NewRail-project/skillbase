// tests/topic-delete.test.js — физическое удаление тем, дисциплин и тестов:
// планы зависимостей (subjects-logic), роли и orgId, сохранение истории,
// защита общих материалов и тестов, лобби-кнопка «Прочитать материал».
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  topicDeletionPlan,
  subjectDeletionPlan,
  deletionPlanSummary,
  subjectWriteAccessError
} from "../core/subjects-logic.js";
import { deletionPlan } from "../core/test-delete-logic.js";
import { roomMaterialTargets } from "../core/rooms-logic.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");

const ORG = "default-org";
const teacher = { uid: "t1", role: "teacher", orgId: ORG };
const admin = { uid: "a1", role: "admin", orgId: ORG };
const student = { uid: "s1", role: "student", orgId: ORG };
const topic = { id: "topic-1", subjectId: "s1", title: "Тема" };
const subject = { id: "s1", title: "Дисциплина" };

// ---------- роли и orgId ----------

test("удаление темы: студенту запрещено, преподавателю и админу разрешено", () => {
  assert.match(subjectWriteAccessError({ uid: "s1" }, student), /преподавател|администратор/i);
  assert.equal(subjectWriteAccessError({ uid: "t1" }, teacher), null);
  assert.equal(subjectWriteAccessError({ uid: "a1" }, admin), null);
});

test("удаление темы: без входа или без организации — отказ", () => {
  assert.ok(subjectWriteAccessError(null, teacher));
  assert.ok(subjectWriteAccessError({ uid: "t1" }, { role: "teacher" }));
});

// ---------- план удаления темы: зависимые данные ----------

test("план темы: свои тесты и материалы отсоединяются (topicId → null), не удаляются", () => {
  const plan = topicDeletionPlan({
    topic,
    session: teacher,
    tests: [
      { id: "test-a", topicId: "topic-1", authorId: "t1", orgId: ORG },
      { id: "test-b", topicId: "topic-2", authorId: "t1", orgId: ORG }
    ],
    materials: [
      { id: "mat-a", topicId: "topic-1", authorId: "t1", orgId: ORG }
    ]
  });
  assert.deepEqual(plan.detachTestIds, ["test-a"]);
  assert.deepEqual(plan.detachMaterialIds, ["mat-a"]);
  assert.deepEqual(plan.foreignTestIds, []);
  assert.deepEqual(plan.foreignMaterialIds, []);
});

test("план темы: чужие тесты и материалы попадают в предупреждения, а не удаляются", () => {
  const plan = topicDeletionPlan({
    topic,
    session: teacher,
    tests: [{ id: "test-x", topicId: "topic-1", authorId: "other", orgId: ORG }],
    materials: [{ id: "mat-x", topicId: "topic-1", authorId: "other", orgId: ORG }]
  });
  assert.deepEqual(plan.detachTestIds, []);
  assert.deepEqual(plan.detachMaterialIds, []);
  assert.deepEqual(plan.foreignTestIds, ["test-x"]);
  assert.deepEqual(plan.foreignMaterialIds, ["mat-x"]);
});

test("план темы: админ отсоединяет тесты всей организации, но не чужие материалы", () => {
  const plan = topicDeletionPlan({
    topic,
    session: admin,
    tests: [
      { id: "test-a", topicId: "topic-1", authorId: "t1", orgId: ORG },
      { id: "test-foreign-org", topicId: "topic-1", authorId: "t1", orgId: "other-org" }
    ],
    materials: [
      { id: "mat-a", topicId: "topic-1", authorId: "t1", orgId: ORG },
      { id: "mat-other", topicId: "topic-1", authorId: "other", orgId: ORG }
    ]
  });
  assert.deepEqual(plan.detachTestIds, ["test-a"]);
  assert.deepEqual(plan.foreignTestIds, ["test-foreign-org"], "тест чужой организации не отсоединяется");
  assert.deepEqual(plan.detachMaterialIds, [], "материал чужого автора не отсоединяется даже админом");
  assert.deepEqual(plan.foreignMaterialIds, ["mat-a", "mat-other"], "чужие материалы остаются с предупреждением");
});

test("план темы: в план не входит удаление самих тестов, материалов или попыток", () => {
  const plan = topicDeletionPlan({ topic, session: teacher, tests: [], materials: [] });
  const keys = Object.keys(plan);
  assert.ok(!keys.some(k => /delete/i.test(k)), `в плане не должно быть удалений: ${keys.join(", ")}`);
});

// ---------- план удаления дисциплины ----------

test("план дисциплины: собирает все свои темы и их зависимости", () => {
  const plan = subjectDeletionPlan({
    subject,
    session: teacher,
    topics: [
      { id: "topic-1", subjectId: "s1" },
      { id: "topic-2", subjectId: "s1" },
      { id: "topic-other", subjectId: "s2" }
    ],
    tests: [
      { id: "test-a", topicId: "topic-1", authorId: "t1", orgId: ORG },
      { id: "test-b", topicId: "topic-2", authorId: "other", orgId: ORG }
    ],
    materials: [
      { id: "mat-a", topicId: "topic-2", authorId: "t1", orgId: ORG }
    ]
  });
  assert.deepEqual(plan.topicIds.sort(), ["topic-1", "topic-2"]);
  assert.deepEqual(plan.detachTestIds, ["test-a"]);
  assert.deepEqual(plan.foreignTestIds, ["test-b"]);
  assert.deepEqual(plan.detachMaterialIds, ["mat-a"]);
});

test("план дисциплины: без тем — удаляется только сама дисциплина", () => {
  const plan = subjectDeletionPlan({ subject, session: teacher, topics: [], tests: [], materials: [] });
  assert.deepEqual(plan.topicIds, []);
  assert.deepEqual(plan.detachTestIds, []);
  assert.deepEqual(plan.foreignTestIds, []);
});

// ---------- сохранение истории и предупреждения ----------

test("сводка плана: пользователь видит последствия и сохранение попыток", () => {
  const notes = deletionPlanSummary({
    topicIds: ["topic-1", "topic-2"],
    detachTestIds: ["test-a"],
    detachMaterialIds: ["mat-a"],
    foreignTestIds: ["test-b"],
    foreignMaterialIds: ["mat-x"]
  });
  assert.ok(notes.some(n => n.includes("Будет удалено тем: 2")));
  assert.ok(notes.some(n => n.includes("Тесты останутся")));
  assert.ok(notes.some(n => n.includes("Материалы останутся")));
  assert.ok(notes.some(n => n.includes("других преподавателей")));
  assert.ok(notes.some(n => n.includes("Попытки, оценки и журнал сохранятся")));
});

test("план теста: задания удаляются физически, история попыток не затрагивается", () => {
  const plan = deletionPlan({
    test: { id: "test-1", authorId: "t1", orgId: ORG },
    session: teacher,
    assignments: [{ id: "a1", testId: "test-1", teacherId: "t1", status: "active" }],
    rooms: []
  });
  assert.deepEqual(plan.deleteAssignmentIds, ["a1"]);
});

test("физическое удаление теста: стираются документ, ключи, версии и материал", () => {
  const src = read("core/editor.js");
  const fn = src.slice(
    src.indexOf("export async function deleteTest"),
    src.indexOf("export ", src.indexOf("export async function deleteTest") + 10)
  );
  assert.match(fn, /deletes\.push\(doc\(db, "tests", testId\), doc\(db, "testKeys", testId\)\)/);
  assert.match(fn, /versions/);
  assert.match(fn, /materials/, "прикреплённый материал теста стирается вместе с ним");
  assert.match(fn, /closeRoomCodes/, "открытые комнаты закрываются по плану");
  assert.ok(!/status: "deleted"/.test(fn), "удаление больше не пишёт мягкий статус");
  // Попытки и журнал в удалении теста не участвуют.
  assert.ok(!/attempts/.test(fn));
  assert.ok(!/journal/.test(fn));
});

test("физическое удаление темы и дисциплины: клиент каскадно стирает документы", () => {
  const src = read("core/subjects.js");
  assert.match(src, /export async function deleteTopic/);
  assert.match(src, /export async function deleteSubject/);
  const topicFn = src.slice(src.indexOf("export async function deleteTopic"));
  assert.match(topicFn, /batch\.delete\(doc\(db, "topics", id\)\)/);
  const subjectFn = src.slice(src.indexOf("export async function deleteSubject"));
  assert.match(subjectFn, /batch\.delete\(doc\(db, "subjects", id\)\)/);
  assert.match(subjectFn, /plan\.topicIds/, "дисциплина удаляет свои темы");
});

test("правила: физическое удаление разрешено только сотрудникам организации", () => {
  const rules = read("firestore.rules");
  for (const col of ["subjects", "topics", "tests", "testKeys"]) {
    const section = rules.slice(rules.indexOf(`match /${col}/`));
    assert.match(
      section,
      /allow delete: if isStaffOf\(resource\.data\.orgId\)/,
      `${col}: удаление только сотрудникам организации`);
  }
  // Студентам и гостям никаких новых delete-правил не добавлено: во всех
  // секциях delete-правил нет упоминаний role() == "student" или гостя.
  assert.ok(!/allow delete[^\n]*isGuest/.test(rules));
});

// ---------- подтверждение удаления ----------

test("потоки удаления: подтверждение с перечнем последствий и защита от повтора", () => {
  const src = read("ui/components/delete-flows.js");
  assert.match(src, /confirmAction\(\{[\s\S]*?confirmLabel: "Удалить", tone: "danger"/);
  assert.match(src, /subjectDeleteBusy/, "повторное нажатие игнорируется, пока идёт удаление");
  assert.match(src, /deleteTopicFlow/);
  assert.match(src, /deleteSubjectFlow/);
});

test("интерфейс: удаление тем и дисциплин доступно сотрудникам (в меню «Ещё»)", () => {
  const page = read("ui/pages/discipline-page.js");
  assert.match(page, /deleteTopicFlow\(topic\)/);
  const catalog = read("ui/pages/discipline-catalog.js");
  assert.match(catalog, /deleteSubjectFlow\(subject\)/);
  // Кнопка появляется только у staff: рендер внутри staff-ветки.
  // (действия карточки теперь в .card-actions: «Изменить» + меню «Ещё» с пунктом «Удалить»).
  assert.match(catalog, /staff \? h\("div", \{ class: "card-actions" \}, cardButtons\(subject\)\) : null/);
  assert.match(catalog, /label: "Удалить", tone: "danger"/);
});

// ---------- лобби: кнопка «Прочитать материал» ----------

test("лобби: без материалов кнопка не показывается", () => {
  assert.deepEqual(roomMaterialTargets({ hasMaterial: false, testId: "test-1", topicMaterials: [] }), []);
  assert.deepEqual(roomMaterialTargets({}), []);
});

test("лобби: один материал — одна кнопка, несколько — список", () => {
  const single = roomMaterialTargets({
    hasMaterial: true, testId: "test-1", topicMaterials: []
  });
  assert.equal(single.length, 1);
  assert.equal(single[0].id, "test-1");
  assert.equal(single[0].main, true);

  const many = roomMaterialTargets({
    hasMaterial: true,
    testId: "test-1",
    topicMaterials: [
      { id: "mat-1", title: "Книга темы" },
      { id: "mat-2", title: "PDF темы" }
    ]
  });
  assert.equal(many.length, 3);
  assert.deepEqual(many.map(t => t.id), ["test-1", "mat-1", "mat-2"]);
  assert.deepEqual(many.filter(t => !t.main).map(t => t.title), ["Книга темы", "PDF темы"]);
});

test("лобби: материал темы совпадающий с материалом теста не дублируется", () => {
  const targets = roomMaterialTargets({
    hasMaterial: true,
    testId: "mat-1",
    topicMaterials: [{ id: "mat-1", title: "Тот же материал" }]
  });
  assert.equal(targets.length, 1);
});

test("лобби: возврат из читалки — в комнату, маршрут #material/<id>/free/<код>", () => {
  const src = read("ui/pages/room.js");
  assert.match(src, /roomMaterialTargets\(/);
  const btnFn = src.slice(src.indexOf("function materialButton()"), src.indexOf("function waitPanel"));
  assert.match(btnFn, /\/free\//, "free-режим возвращает в лобби комнаты");
  assert.ok(!/local\.hasMaterial \|\|/.test(btnFn.match(/if \(!targets\.length\) return null;/)?.input || ""),
    "кнопка строится по списку целей, а не только по материалу теста");
  // Материалы темы загружаются в комнате по topicId теста.
  assert.match(src, /where\("topicId", "==", testDoc\.topicId\)/);
  // Черновики и архив не попадают в список (книги без status считаются опубликованными).
  assert.match(src, /\(m\.status \?\? "published"\) === "published"/);
});

test("лобби: читалка для материалов темы возвращает в комнату (back-mode room)", () => {
  const rules = read("core/material-library-logic.js");
  // Третий сегмент маршрута #material/<id>/free/<код> — код комнаты.
  assert.match(rules, /mode: "room", hash: `#room\/\$\{third\}`/);
});
