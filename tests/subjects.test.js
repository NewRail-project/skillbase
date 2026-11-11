// tests/subjects.test.js — чистая логика предметов и тем.
//
// core/subjects.js напрямую в Node не импортируется: он тянет Firebase SDK
// по HTTPS (shared/firebase.js) и падает с ERR_UNSUPPORTED_ESM_URL_SCHEME.
// Поэтому проверяются чистые функции core/subjects-logic.js — те же
// ограничения, что и в firestore.rules. Сами правила проверяются отдельно
// через npm run test:rules (tools/rules-test.mjs, Rules API).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateSubjectData,
  validateTopicData,
  subjectWriteAccessError,
  subjectReadAccessError,
  TITLE_MAX,
  DESCRIPTION_MAX
} from "../core/subjects-logic.js";

// ---------- Предметы: создание ----------

test("предмет: корректное создание проходит и нормализуется", () => {
  const check = validateSubjectData(
    { title: "  Электрические машины  ", order: 2, description: " Описание " },
    true
  );
  assert.equal(check.ok, true);
  assert.deepEqual(check.value, {
    title: "Электрические машины",
    description: "Описание",
    order: 2,
    status: "active"
  });
});

test("предмет: значения по умолчанию при создании", () => {
  const check = validateSubjectData({ title: "Устройство локомотивов" }, true);
  assert.equal(check.ok, true);
  assert.deepEqual(check.value, {
    title: "Устройство локомотивов",
    description: "",
    order: 0,
    status: "active"
  });
});

test("предмет: пустое название отклоняется", () => {
  assert.equal(validateSubjectData({}, true).error, "Укажите название");
  assert.equal(validateSubjectData({ title: "" }, true).error, "Укажите название");
  assert.equal(validateSubjectData({ title: "   " }, true).error, "Укажите название");
  assert.equal(validateSubjectData({ title: 123 }, true).error, "Укажите название");
});

test("предмет: граница длины названия", () => {
  assert.equal(validateSubjectData({ title: "Б".repeat(TITLE_MAX) }, true).ok, true);
  assert.equal(
    validateSubjectData({ title: "Б".repeat(TITLE_MAX + 1) }, true).error,
    `Название слишком длинное (максимум ${TITLE_MAX} символов)`
  );
});

test("предмет: описание — длина и тип", () => {
  assert.equal(validateSubjectData({ title: "Т", description: "д" }, true).ok, true);
  assert.equal(
    validateSubjectData({ title: "Т", description: "д".repeat(DESCRIPTION_MAX) }, true).ok,
    true
  );
  assert.equal(
    validateSubjectData({ title: "Т", description: "д".repeat(DESCRIPTION_MAX + 1) }, true).error,
    `Описание слишком длинное (максимум ${DESCRIPTION_MAX} символов)`
  );
  assert.equal(
    validateSubjectData({ title: "Т", description: 5 }, true).error,
    "Некорректное описание"
  );
});

test("предмет: некорректный order — отрицательный, дробный, NaN, Infinity, строка", () => {
  const error = "Порядок должен быть неотрицательным целым числом";
  assert.equal(validateSubjectData({ title: "Т", order: -1 }, true).error, error);
  assert.equal(validateSubjectData({ title: "Т", order: 1.5 }, true).error, error);
  assert.equal(validateSubjectData({ title: "Т", order: NaN }, true).error, error);
  assert.equal(validateSubjectData({ title: "Т", order: Infinity }, true).error, error);
  assert.equal(validateSubjectData({ title: "Т", order: "5" }, true).error, error);
  assert.equal(validateSubjectData({ title: "Т", order: 0 }, true).ok, true);
});

test("предмет: статус при создании — только active", () => {
  assert.equal(
    validateSubjectData({ title: "Т", status: "archived" }, true).error,
    "Недопустимый статус"
  );
  assert.equal(
    validateSubjectData({ title: "Т", status: "published" }, true).error,
    "Недопустимый статус"
  );
  assert.equal(validateSubjectData({ title: "Т", status: "active" }, true).ok, true);
});

test("предмет: системные поля нельзя передать при создании", () => {
  assert.equal(
    validateSubjectData({ title: "Т", orgId: "default-org" }, true).error,
    "Нельзя изменять организацию (orgId)"
  );
  assert.equal(
    validateSubjectData({ title: "Т", createdBy: "hacker" }, true).error,
    "Нельзя изменять автора (createdBy)"
  );
  assert.equal(
    validateSubjectData({ title: "Т", createdAt: "2026-01-01" }, true).error,
    "Нельзя изменять дату создания (createdAt)"
  );
});

test("предмет: неизвестные поля отклоняются", () => {
  assert.equal(
    validateSubjectData({ title: "Т", hack: 1 }, true).error,
    "Неизвестное поле: hack"
  );
  assert.equal(
    validateSubjectData({ subjectId: "s1" }, false).error,
    "Неизвестное поле: subjectId"
  );
});

// ---------- Предметы: изменение ----------

test("предмет: пустой patch валиден и ничего не пишет кроме updatedAt", () => {
  const check = validateSubjectData({}, false);
  assert.equal(check.ok, true);
  assert.deepEqual(check.value, {});
});

test("предмет: архивирование разрешено, чужой статус — нет", () => {
  assert.equal(validateSubjectData({ status: "archived" }, false).ok, true);
  assert.equal(validateSubjectData({ status: "active" }, false).ok, true);
  assert.equal(validateSubjectData({ status: "published" }, false).error, "Недопустимый статус");
});

test("предмет: patch не меняет системные поля", () => {
  assert.equal(validateSubjectData({ orgId: "other-org" }, false).error, "Нельзя изменять организацию (orgId)");
  assert.equal(validateSubjectData({ createdBy: "hacker" }, false).error, "Нельзя изменять автора (createdBy)");
  assert.equal(validateSubjectData({ createdAt: "2026-01-01" }, false).error, "Нельзя изменять дату создания (createdAt)");
});

test("предмет: patch с мусорным order отклоняется", () => {
  const error = "Порядок должен быть неотрицательным целым числом";
  assert.equal(validateSubjectData({ order: -3 }, false).error, error);
  assert.equal(validateSubjectData({ order: NaN }, false).error, error);
  assert.equal(validateSubjectData({ order: Infinity }, false).error, error);
  assert.equal(validateSubjectData({ title: "" }, false).error, "Укажите название");
});

// ---------- Темы: создание ----------

test("тема: корректное создание проходит", () => {
  const check = validateTopicData(
    { subjectId: " s1 ", title: "Тяговые двигатели", order: 1 },
    true
  );
  assert.equal(check.ok, true);
  assert.deepEqual(check.value, {
    subjectId: "s1",
    title: "Тяговые двигатели",
    description: "",
    order: 1,
    status: "active"
  });
});

test("тема: без предмета создание отклоняется", () => {
  assert.equal(validateTopicData({ title: "Т" }, true).error, "Укажите предмет (subjectId)");
  assert.equal(validateTopicData({ subjectId: "" }, true).error, "Укажите предмет (subjectId)");
  assert.equal(validateTopicData({ subjectId: "   " }, true).error, "Укажите предмет (subjectId)");
  assert.equal(validateTopicData({ subjectId: 5 }, true).error, "Укажите предмет (subjectId)");
});

test("тема: системные поля нельзя передать при создании (subjectId разрешён)", () => {
  assert.equal(
    validateTopicData({ subjectId: "s1", title: "Т", orgId: "default-org" }, true).error,
    "Нельзя изменять организацию (orgId)"
  );
  assert.equal(
    validateTopicData({ subjectId: "s1", title: "Т", createdBy: "hacker" }, true).error,
    "Нельзя изменять автора (createdBy)"
  );
  assert.equal(
    validateTopicData({ subjectId: "s1", title: "Т", createdAt: "x" }, true).error,
    "Нельзя изменять дату создания (createdAt)"
  );
});

test("тема: некорректные поля при создании отклоняются", () => {
  assert.equal(validateTopicData({ subjectId: "s1" }, true).error, "Укажите название");
  assert.equal(
    validateTopicData({ subjectId: "s1", title: "Т", order: -1 }, true).error,
    "Порядок должен быть неотрицательным целым числом"
  );
  assert.equal(
    validateTopicData({ subjectId: "s1", title: "Т", order: 0.5 }, true).error,
    "Порядок должен быть неотрицательным целым числом"
  );
  assert.equal(
    validateTopicData({ subjectId: "s1", title: "Т", order: NaN }, true).error,
    "Порядок должен быть неотрицательным целым числом"
  );
  assert.equal(
    validateTopicData({ subjectId: "s1", title: "Т", status: "archived" }, true).error,
    "Недопустимый статус"
  );
  assert.equal(
    validateTopicData({ subjectId: "s1", title: "Т", foo: 1 }, true).error,
    "Неизвестное поле: foo"
  );
});

// ---------- Темы: изменение ----------

test("тема: нельзя сменить предмет при изменении", () => {
  assert.equal(
    validateTopicData({ subjectId: "s2" }, false).error,
    "Нельзя изменять предмет (subjectId)"
  );
});

test("тема: архивирование и допустимые patch", () => {
  assert.equal(validateTopicData({ status: "archived" }, false).ok, true);
  assert.equal(validateTopicData({ title: "Новое название", order: 3 }, false).ok, true);
  assert.equal(validateTopicData({ status: "draft" }, false).error, "Недопустимый статус");
  assert.equal(
    validateTopicData({ orgId: "other-org" }, false).error,
    "Нельзя изменять организацию (orgId)"
  );
  assert.equal(
    validateTopicData({ createdBy: "hacker" }, false).error,
    "Нельзя изменять автора (createdBy)"
  );
  assert.equal(
    validateTopicData({ createdAt: "x" }, false).error,
    "Нельзя изменять дату создания (createdAt)"
  );
});

// ---------- Доступ ----------

test("доступ на запись: нет пользователя, профиля и orgId", () => {
  assert.equal(subjectWriteAccessError(null, null), "Нужно войти в аккаунт.");
  assert.equal(
    subjectWriteAccessError({ uid: "u1" }, null),
    "Профиль не загружен."
  );
  assert.equal(
    subjectWriteAccessError({ uid: "u1" }, { role: "teacher" }),
    "Организация не указана."
  );
});

test("доступ на запись: студенту нельзя, преподавателю и админу можно", () => {
  const student = { orgId: "default-org", role: "student" };
  const teacher = { orgId: "default-org", role: "teacher" };
  const admin = { orgId: "default-org", role: "admin" };
  const stranger = { orgId: "default-org", role: "moderator" };

  assert.match(
    subjectWriteAccessError({ uid: "u1" }, student),
    /Недостаточно прав/
  );
  assert.match(
    subjectWriteAccessError({ uid: "u1" }, stranger),
    /Недостаточно прав/
  );
  assert.equal(subjectWriteAccessError({ uid: "u1" }, teacher), null);
  assert.equal(subjectWriteAccessError({ uid: "u1" }, admin), null);
});

test("доступ на чтение: студентам можно, гостям и без orgId нельзя", () => {
  assert.equal(subjectReadAccessError(null, null), "Нужно войти в аккаунт.");
  assert.equal(subjectReadAccessError({ uid: "u1" }, null), "Профиль не загружен.");
  assert.equal(
    subjectReadAccessError({ uid: "u1" }, { role: "teacher" }),
    "Организация не указана."
  );
  assert.equal(
    subjectReadAccessError({ uid: "u1" }, { orgId: "default-org", role: "student" }),
    null
  );
});
