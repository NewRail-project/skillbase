// core/subjects-logic.js — чистая логика предметов и тем (без Firebase).
//
// Зеркало ограничений firestore.rules для коллекций subjects и topics:
// правила остаются основной границей безопасности, а здесь те же проверки —
// ради понятных ошибок на клиенте ДО записи в Firestore. Модуль не
// импортирует Firebase, поэтому проверяется в Node (tests/subjects.test.js).
//
// Доступ повторяет модель проекта: isStaff() = teacher | admin (core/auth.js),
// организация — orgId профиля (myOrg() в правилах). Ограничение teacherGroups
// сюда не переносится: предметы и темы — общая структура организации без
// данных студентов (обоснование в firestore.rules).

export const STATUS_ACTIVE = "active";
export const STATUS_ARCHIVED = "archived";
export const SUBJECT_STATUSES = [STATUS_ACTIVE, STATUS_ARCHIVED];

// Лимиты согласованы с правилами: название ≤ 120 символов (как ФИО в
// core/registration.js), описание ≤ 600 (короткий текст для списка тем).
export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 600;

// Разрешённые к передаче поля. Системные поля (orgId, createdBy, createdAt,
// а у темы и subjectId) выставляет API, поэтому в данных от вызывающего
// они запрещены и при создании, и при изменении.
const SUBJECT_FIELDS = ["title", "description", "order", "status"];
const TOPIC_FIELDS = ["subjectId", "title", "description", "order", "status"];

const SUBJECT_SYSTEM_FIELDS = {
  orgId: "Нельзя изменять организацию (orgId)",
  createdBy: "Нельзя изменять автора (createdBy)",
  createdAt: "Нельзя изменять дату создания (createdAt)"
};
const TOPIC_SYSTEM_FIELDS = {
  ...SUBJECT_SYSTEM_FIELDS,
  subjectId: "Нельзя изменять предмет (subjectId)"
};

// Проверка доступа на запись — зеркало isStaff() + myOrg() из правил.
// Возвращает строку с понятной ошибкой или null, если писать можно.
export function subjectWriteAccessError(user, profile) {
  if (!user) return "Нужно войти в аккаунт.";
  if (!profile) return "Профиль не загружен.";
  if (!profile.orgId) return "Организация не указана.";
  if (profile.role !== "teacher" && profile.role !== "admin") {
    return "Недостаточно прав: доступно преподавателям и администраторам.";
  }
  return null;
}

// Проверка доступа на чтение: все члены организации, включая студентов
// (как чтение опубликованных тестов). Гостям без профиля читать нельзя.
export function subjectReadAccessError(user, profile) {
  if (!user) return "Нужно войти в аккаунт.";
  if (!profile) return "Профиль не загружен.";
  if (!profile.orgId) return "Организация не указана.";
  return null;
}

function systemFieldError(data, labels) {
  for (const key of Object.keys(labels)) {
    if (data[key] !== undefined) return labels[key];
  }
  return null;
}

function unknownFieldError(data, allowed) {
  for (const key of Object.keys(data)) {
    if (!allowed.includes(key)) return `Неизвестное поле: ${key}`;
  }
  return null;
}

// Общие проверки полей предмета/темы. Возвращает строку ошибки или null.
// Название требуется при создании и при передаче в patch; order — конечное
// неотрицательное целое (Number.isInteger отсекает NaN, Infinity и дроби);
// статус — active|archived, при создании строго active.
function commonFieldsError(data, isCreate) {
  const needTitle = isCreate || data.title !== undefined;
  if (needTitle) {
    if (typeof data.title !== "string" || !data.title.trim()) {
      return "Укажите название";
    }
    if (data.title.trim().length > TITLE_MAX) {
      return `Название слишком длинное (максимум ${TITLE_MAX} символов)`;
    }
  }
  if (data.description !== undefined) {
    if (typeof data.description !== "string") return "Некорректное описание";
    if (data.description.trim().length > DESCRIPTION_MAX) {
      return `Описание слишком длинное (максимум ${DESCRIPTION_MAX} символов)`;
    }
  }
  // order необязателен (по умолчанию 0); проверяется только переданное
  // значение: конечное неотрицательное целое. Number.isInteger отсекает
  // NaN, Infinity и дроби.
  if (data.order !== undefined) {
    if (
      typeof data.order !== "number"
      || !Number.isInteger(data.order)
      || data.order < 0
    ) {
      return "Порядок должен быть неотрицательным целым числом";
    }
  }
  if (data.status !== undefined) {
    const valid = isCreate
      ? data.status === STATUS_ACTIVE
      : SUBJECT_STATUSES.includes(data.status);
    if (!valid) return "Недопустимый статус";
  }
  return null;
}

// Очищенные значения полей: название и описание обрезаны, значения по
// умолчанию выставлены только при создании. Системные поля не включает.
function normalizeCommon(data, isCreate) {
  const value = {};
  if (isCreate || data.title !== undefined) value.title = data.title.trim();
  if (data.description !== undefined) value.description = data.description.trim();
  if (isCreate || data.order !== undefined) value.order = data.order;
  if (data.status !== undefined) value.status = data.status;
  if (isCreate) {
    if (value.description === undefined) value.description = "";
    if (value.order === undefined) value.order = 0;
    value.status = STATUS_ACTIVE;
  }
  return value;
}

function validSubjectId(src) {
  return typeof src.subjectId === "string" && Boolean(src.subjectId.trim());
}

// Валидация данных предмета. isCreate — создание (все обязательные поля,
// статус только «active»), иначе patch (передавать можно только разрешённые
// поля; системные отклоняются).
export function validateSubjectData(data, isCreate = false) {
  const src = data || {};
  const error = systemFieldError(src, SUBJECT_SYSTEM_FIELDS)
    || unknownFieldError(src, SUBJECT_FIELDS)
    || commonFieldsError(src, isCreate);
  if (error) return { ok: false, error };
  return { ok: true, value: normalizeCommon(src, isCreate) };
}

// Валидация данных темы: как у предмета + обязательный subjectId при
// создании; при изменении subjectId запрещён (перенос между предметами
// не поддерживается — см. правила).
export function validateTopicData(data, isCreate = false) {
  const src = data || {};
  const error = systemFieldError(src, isCreate ? SUBJECT_SYSTEM_FIELDS : TOPIC_SYSTEM_FIELDS)
    || unknownFieldError(src, TOPIC_FIELDS)
    || (isCreate && !validSubjectId(src) ? "Укажите предмет (subjectId)" : null)
    || commonFieldsError(src, isCreate);
  if (error) return { ok: false, error };
  const value = normalizeCommon(src, isCreate);
  if (isCreate) value.subjectId = src.subjectId.trim();
  return { ok: true, value };
}
