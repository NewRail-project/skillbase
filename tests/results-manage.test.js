// tests/results-manage.test.js — управление результатами: права на удаление
// (зеркало firestore.rules), фильтры, описание последствий, подтверждение.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canDeleteAttempt, teacherSeesGroup, filterResultRows, filterOptions, planDeletion, describeImpact,
  impactLines, needsTypedConfirmation, phraseMatches, parseDay, chunk, DELETE_PHRASE
} from "../core/results-manage-logic.js";

const ORG = "org1";
const admin = { role: "admin", orgId: ORG };
const teacher = (groups) => ({ role: "teacher", orgId: ORG, ...(groups === undefined ? {} : { teacherGroups: groups }) });
const student = { role: "student", orgId: ORG };
const att = (o = {}) => ({ id: "a1", orgId: ORG, status: "graded", groupId: "g1", testId: "t1", ...o });

// ---------- права ----------

test("администратор удаляет завершённые попытки своей организации", () => {
  assert.equal(canDeleteAttempt(att({ status: "graded" }), admin).allowed, true);
  assert.equal(canDeleteAttempt(att({ status: "submitted" }), admin).allowed, true);
});

test("незавершённую попытку удалить нельзя никому", () => {
  const v = canDeleteAttempt(att({ status: "in_progress" }), admin);
  assert.equal(v.allowed, false);
  assert.match(v.reason, /не завершена/);
  assert.equal(canDeleteAttempt(att({ status: "weird" }), admin).allowed, false);
});

test("чужая организация, студент и гость: отказ", () => {
  assert.equal(canDeleteAttempt(att({ orgId: "other" }), admin).allowed, false);
  assert.equal(canDeleteAttempt(att(), student).allowed, false);
  assert.equal(canDeleteAttempt(att(), null).allowed, false);
  assert.equal(canDeleteAttempt(att(), { role: "admin" }).allowed, false, "нет orgId в профиле");
});

test("преподаватель: без ограничения групп — все, с ограничением — только свои (как в правилах)", () => {
  assert.equal(canDeleteAttempt(att(), teacher()).allowed, true, "нет поля teacherGroups");
  assert.equal(canDeleteAttempt(att(), teacher(null)).allowed, true);
  assert.equal(canDeleteAttempt(att(), teacher([])).allowed, true, "пустой список = без ограничения, как teacherCanSeeGroup");
  assert.equal(canDeleteAttempt(att({ groupId: "g1" }), teacher(["g1", "g2"])).allowed, true);
  assert.equal(canDeleteAttempt(att({ groupId: "g9" }), teacher(["g1"])).allowed, false);
  assert.equal(canDeleteAttempt(att({ groupId: undefined }), teacher(["g1"])).allowed, false, "без группы — недоступно ограниченному");
  assert.equal(canDeleteAttempt(att({ groupId: "" }), teacher(["g1"])).allowed, false);
  assert.equal(teacherSeesGroup({ teacherGroups: "g1" }, "g1"), false, "не список — отказ");
});

test("права в интерфейсе совпадают с правилом Firestore", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const del = rules.slice(rules.indexOf("allow delete: if signedIn()\n        && isStaffOf(resource.data.orgId)\n        && resource.data.status in"));
  assert.match(del.slice(0, 600), /resource\.data\.status in \["submitted", "graded"\]/);
  assert.match(del.slice(0, 600), /role\(\) == "admin"/);
  assert.match(del.slice(0, 600), /teacherCanSeeGroup/);
  // Чтение и изменение попыток этим правилом не расширены.
  assert.equal((rules.match(/match \/attempts\/\{id\}/g) || []).length, 1);
  assert.doesNotMatch(rules.slice(rules.indexOf("match /attempts/{id}"), rules.indexOf("// ---------- assignments")), /allow delete: if false/);
});

// ---------- фильтры ----------

const R = (o) => ({ id: "x", student: "Иванов", email: "i@mail.kz", test: "Охрана труда", testId: "t1", groupId: "g1", subjectId: "s1", status: "graded", ms: new Date(2026, 10, 10, 12).getTime(), ...o });
const rows = [
  R({ id: "1" }),
  R({ id: "2", student: "Петрова", email: "p@mail.kz", groupId: "g2", test: "Сигналы", testId: "t2", subjectId: "s2", ms: new Date(2026, 9, 1, 8).getTime() }),
  R({ id: "3", student: "Сидоров", status: "submitted", ms: new Date(2026, 10, 20, 23, 59).getTime() })
];
const ids = (list) => list.map((r) => r.id);

test("фильтры: студент, группа, тест, дисциплина, статус", () => {
  assert.deepEqual(ids(filterResultRows(rows, { query: "петр" })), ["2"]);
  assert.deepEqual(ids(filterResultRows(rows, { query: "P@MAIL" })), ["2"]);
  assert.deepEqual(ids(filterResultRows(rows, { groupId: "g2" })), ["2"]);
  assert.deepEqual(ids(filterResultRows(rows, { testId: "t1" })), ["1", "3"]);
  assert.deepEqual(ids(filterResultRows(rows, { subjectId: "s2" })), ["2"]);
  assert.deepEqual(ids(filterResultRows(rows, { status: "submitted" })), ["3"]);
  assert.deepEqual(ids(filterResultRows(rows, { groupId: "g1", status: "graded" })), ["1"], "фильтры складываются");
  assert.equal(filterResultRows(rows, {}).length, 3);
});

test("фильтр периода включает оба граничных дня целиком", () => {
  assert.deepEqual(ids(filterResultRows(rows, { from: "2026-11-10", to: "2026-11-20" })), ["1", "3"], "23:59 последнего дня входит");
  assert.deepEqual(ids(filterResultRows(rows, { from: "2026-11-11" })), ["3"]);
  assert.deepEqual(ids(filterResultRows(rows, { to: "2026-10-01" })), ["2"]);
  assert.equal(parseDay("не дата"), null);
  assert.equal(parseDay(""), null);
});

test("варианты фильтров строятся только из реальных данных", () => {
  const o = filterOptions(rows);
  assert.deepEqual(o.groups, ["g1", "g2"]);
  assert.deepEqual(o.subjects.sort(), ["s1", "s2"]);
  assert.deepEqual(o.tests.map((t) => t.id).sort(), ["t1", "t2"]);
  assert.deepEqual(filterOptions([]), { groups: [], subjects: [], tests: [] });
});

// ---------- план удаления ----------

test("план: удаляется только разрешённое, остальное объясняется", () => {
  const data = [
    R({ id: "ok", raw: att({ id: "ok" }) }),
    R({ id: "run", raw: att({ id: "run", status: "in_progress" }), status: "in_progress" }),
    R({ id: "foreign", raw: att({ id: "foreign", groupId: "gX" }) })
  ];
  const plan = planDeletion(data, ["ok", "run", "foreign", "missing"], teacher(["g1"]));
  assert.deepEqual(ids(plan.allowed), ["ok"]);
  assert.equal(plan.blocked.length, 2);
  assert.match(plan.blocked.map((b) => b.reason).join(" "), /не завершена/);
  assert.match(plan.blocked.map((b) => b.reason).join(" "), /не доступна/);
  assert.equal(plan.summary.count, 1);
});

test("последствия: числа и текст предупреждения", () => {
  const s = describeImpact([
    { userId: "u1", testId: "t1", status: "graded", assignmentId: "as1" },
    { userId: "u1", testId: "t2", status: "submitted" },
    { userId: "u2", testId: "t1", status: "graded" }
  ]);
  assert.deepEqual(s, { count: 3, graded: 2, pending: 1, withAssignment: 1, students: 2, tests: 2 });
  const text = impactLines(s).join("\n");
  assert.match(text, /Будет удалено попыток: 3/);
  assert.match(text, /проверенных: 2/);
  assert.match(text, /ожидающих проверки: 1/i);
  assert.match(text, /назначениям: 1/);
  assert.match(text, /журнала оценок остаются/);
  assert.match(text, /Восстановить удалённое нельзя/);
  assert.doesNotMatch(impactLines(describeImpact([{ userId: "u", testId: "t", status: "graded" }])).join(" "), /назначениям/);
});

test("защита от случайного массового удаления: с двух записей нужно ввести слово", () => {
  assert.equal(needsTypedConfirmation(1), false);
  assert.equal(needsTypedConfirmation(2), true);
  assert.equal(needsTypedConfirmation(500), true);
  assert.equal(phraseMatches("удалить"), true);
  assert.equal(phraseMatches("  УДАЛИТЬ "), true);
  assert.equal(phraseMatches("удалит"), false);
  assert.equal(phraseMatches(""), false);
  assert.equal(DELETE_PHRASE, "УДАЛИТЬ");
});

test("chunk: разбиение без потерь", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
});

// ---------- окно подтверждения ----------

test("подтверждение: без введённого слова кнопка «Удалить» недоступна", async () => {
  const { installFakeDom, findAll, findOne } = await import("./helpers/fake-dom.js");
  installFakeDom();
  const shown = [];
  globalThis.document.createElement("dialog");
  // modal() строит <dialog>; подменяем, чтобы получить содержимое.
  const { confirmAction } = await import("../ui/components/confirm.js");
  const promise = confirmAction({ title: "t", details: [], confirmLabel: "Удалить безвозвратно", tone: "danger", requirePhrase: "УДАЛИТЬ" });
  const dialog = globalThis.document.body.children.at(-1);
  const buttons = findAll(dialog, (e) => e.tag === "button");
  const confirmBtn = buttons.find((b) => b.textContent === "Удалить безвозвратно");
  const input = findOne(dialog, (e) => e.tag === "input");
  assert.ok(confirmBtn && input, "есть кнопка и поле ввода");
  assert.equal(confirmBtn.disabled, true);
  confirmBtn.click();
  input.value = "удал";
  input.dispatch("input");
  assert.equal(confirmBtn.disabled, true);
  input.value = "удалить";
  input.dispatch("input");
  assert.equal(confirmBtn.disabled, false);
  confirmBtn.click();
  assert.equal(await promise, true);
  shown.length = 0;
});
