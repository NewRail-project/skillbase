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

// ---------- Статусы тем ----------
//
// Хранимые статусы темы. «active» — легаси (темы до этапа 4); он равнозначен
// «published». Состояния выполнения конкретным учеником (изучается,
// завершена, просрочена) в теме НЕ хранятся — они вычисляются по попыткам
// и датам в core/schedule-logic.js, чтобы не смешивать статус темы и
// прогресс ученика.
export const TOPIC_STATUS_DRAFT = "draft";
export const TOPIC_STATUS_PLANNED = "planned";
export const TOPIC_STATUS_PUBLISHED = "published";
export const TOPIC_STATUS_ARCHIVED = STATUS_ARCHIVED;
export const TOPIC_STATUSES = [
  TOPIC_STATUS_DRAFT,
  TOPIC_STATUS_PLANNED,
  TOPIC_STATUS_PUBLISHED,
  STATUS_ACTIVE, // легаси: темы до этапа 4
  TOPIC_STATUS_ARCHIVED
];
// Студенты читают только опубликованные темы (правила Firestore; «active» —
// легаси «опубликована»). Черновики и запланированные видит только персонал.
export const STUDENT_TOPIC_STATUSES = [TOPIC_STATUS_PUBLISHED, STATUS_ACTIVE];
// При создании темы можно выбрать начальный статус (по умолчанию — draft).
export const TOPIC_CREATE_STATUSES = [
  TOPIC_STATUS_DRAFT, TOPIC_STATUS_PLANNED, TOPIC_STATUS_PUBLISHED, STATUS_ACTIVE
];

// ---------- Даты темы (расписание) ----------
// Ключи полей дат в документе. Значения — Firestore Timestamp или null
// (правила проверяют is timestamp / is null); строки не допускаются,
// поэтому страницы конвертируют input type=date в Timestamp.
export const TOPIC_DATE_FIELDS = [
  "lessonDate",  // дата проведения занятия
  "openDate",    // дата открытия (доступа для студентов)
  "closeDate",   // дата закрытия (после неё студентам недоступна)
  "publishDate", // планируемая дата публикации (информационная)
  "dueDate"      // срок сдачи
];

// Лимиты согласованы с правилами: название ≤ 120 символов (как ФИО в
// core/registration.js), описание ≤ 600 (короткий текст для списка тем).
export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 600;

// Кэш справочников (subjects/topics) на время сессии: на мобильном интернете
// каждая перерисовка страницы перечитывала маленькие коллекции заново.
// TTL защищает от устаревания: через ttlMs значение считается протухшим.
// Запись (create/update/move) сбрасывает весь кэш. Чистая функция —
// тестируется в Node.
export function createReferenceCache(ttlMs = 60000) {
  const entries = new Map(); // key -> { value, at }
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (Date.now() - entry.at >= ttlMs) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      entries.set(key, { value, at: Date.now() });
    },
    clear() {
      entries.clear();
    }
  };
}

// Разрешённые к передаче поля. Системные поля (orgId, createdBy, createdAt,
// а у темы и subjectId) выставляет API, поэтому в данных от вызывающего
// они запрещены и при создании, и при изменении.
const SUBJECT_FIELDS = ["title", "description", "order", "status"];
// Поля темы: расписание этапа 4 + учебная группа. Правила Firestore
// разрешают ровно этот список (см. match /topics).
const TOPIC_FIELDS = [
  "subjectId", "title", "description", "order", "status",
  "groupId",
  "lessonDate", "openDate", "closeDate", "publishDate", "dueDate"
];

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

// ---------- Физическое удаление ----------
//
// Тема удаляется вместе с собой (расписание, публикация — поля документа),
// но ссылки на тесты и материалы ОТсоединяются (topicId → null), а сами
// тесты и материалы остаются: тест — в каталоге, материал — в библиотеке.
// Так защищаются «общие» объекты (тест может использоваться в заданиях и
// Live-комнатам, материал — другими тестами), а попытки, оценки, журнал
// и прогресс чтения сохраняются. Осиротевших ссылок не остаётся.
//
// Кто может отсоединить: правила разрешают update теста автору или админу
// организации; материал — только автору (authorId, даже админ не может).
export function topicDeletionPlan({ topic, session = {}, tests = [], materials = [] }) {
  const uid = session?.uid || "";
  const isAdmin = session?.role === "admin";
  const orgId = session?.orgId || "";
  const topicId = topic?.id || "";
  const linkedTests = (tests || []).filter(t => t && t.topicId === topicId);
  const linkedMaterials = (materials || []).filter(m => m && m.topicId === topicId);

  return {
    topicId,
    // Свои тесты (или все — админу своей организации): topicId → null.
    detachTestIds: linkedTests
      .filter(t => t.authorId === uid || (isAdmin && t.orgId === orgId))
      .map(t => t.id),
    // Тесты других авторов: останутся с несуществующей темой —
    // сотруднику показывается предупреждение, молча не трогаем.
    foreignTestIds: linkedTests
      .filter(t => !(t.authorId === uid || (isAdmin && t.orgId === orgId)))
      .map(t => t.id),
    // Материалы отсоединяет только автор (ограничение правил материалов).
    detachMaterialIds: linkedMaterials
      .filter(m => m.authorId === uid)
      .map(m => m.id),
    foreignMaterialIds: linkedMaterials
      .filter(m => m.authorId !== uid)
      .map(m => m.id)
  };
}

// План удаления дисциплины: сама дисциплина и все её темы, ссылки тестов
// и материалов тем отсоединяются тем же способом.
export function subjectDeletionPlan({ subject, session = {}, topics = [], tests = [], materials = [] }) {
  const subjectId = subject?.id || "";
  const ownTopics = (topics || []).filter(t => t && t.subjectId === subjectId);
  const topicIds = ownTopics.map(t => t.id);
  const uid = session?.uid || "";
  const isAdmin = session?.role === "admin";
  const orgId = session?.orgId || "";

  const linkedTests = (tests || []).filter(t => t && topicIds.includes(t.topicId));
  const linkedMaterials = (materials || []).filter(m => m && topicIds.includes(m.topicId));

  return {
    subjectId,
    topicIds,
    detachTestIds: linkedTests
      .filter(t => t.authorId === uid || (isAdmin && t.orgId === orgId))
      .map(t => t.id),
    foreignTestIds: linkedTests
      .filter(t => !(t.authorId === uid || (isAdmin && t.orgId === orgId)))
      .map(t => t.id),
    detachMaterialIds: linkedMaterials
      .filter(m => m.authorId === uid)
      .map(m => m.id),
    foreignMaterialIds: linkedMaterials
      .filter(m => m.authorId !== uid)
      .map(m => m.id)
  };
}

// Сводка зависимостей для окна подтверждения: человекочитаемые счётчики
// и предупреждения о том, что нельзя отсоединить молча.
export function deletionPlanSummary(plan) {
  const notes = [];
  const ownTopics = plan.topicIds?.length || 0;
  if (ownTopics) notes.push(`Будет удалено тем: ${ownTopics}`);
  if (plan.detachTestIds?.length) notes.push(`Тесты останутся, ссылка на тему будет снята: ${plan.detachTestIds.length}`);
  if (plan.detachMaterialIds?.length) notes.push(`Материалы останутся в библиотеке, ссылка на тему будет снята: ${plan.detachMaterialIds.length}`);
  if (plan.foreignTestIds?.length) {
    notes.push(`Тесты других преподавателей останутся со ссылкой на удалённую тему: ${plan.foreignTestIds.length}`);
  }
  if (plan.foreignMaterialIds?.length) {
    notes.push(`Материалы других авторов останутся со ссылкой на удалённую тему: ${plan.foreignMaterialIds.length}`);
  }
  notes.push("Попытки, оценки и журнал сохранятся.");
  return notes;
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
// статус — из набора модуля (у тем шире, у предметов как раньше).
// opts: { statuses, createStatuses, defaultStatus } — для тем.
function commonFieldsError(data, isCreate, opts = {}) {
  const statuses = opts.statuses || SUBJECT_STATUSES;
  const createStatuses = opts.createStatuses || [STATUS_ACTIVE];
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
      ? createStatuses.includes(data.status)
      : statuses.includes(data.status);
    if (!valid) return "Недопустимый статус";
  }
  return null;
}

// Очищенные значения полей: название и описание обрезаны, значения по
// умолчанию выставлены только при создании. Системные поля не включает.
// opts — те же наборы статусов, что и в commonFieldsError.
function normalizeCommon(data, isCreate, opts = {}) {
  const defaultStatus = opts.defaultStatus || STATUS_ACTIVE;
  const value = {};
  if (isCreate || data.title !== undefined) value.title = data.title.trim();
  if (data.description !== undefined) value.description = data.description.trim();
  if (isCreate || data.order !== undefined) value.order = data.order;
  if (data.status !== undefined) value.status = data.status;
  if (isCreate) {
    if (value.description === undefined) value.description = "";
    if (value.order === undefined) value.order = 0;
    if (value.status === undefined) value.status = defaultStatus;
  }
  return value;
}

function validSubjectId(src) {
  return typeof src.subjectId === "string" && Boolean(src.subjectId.trim());
}

// ---------- Расчёты каталога дисциплин ----------
//
// Чистые функции для карточек дисциплин и страницы дисциплины. Читают
// только уже загруженные данные; Firestore не трогают, поэтому тестируются
// в Node. Совместимость со старыми данными: поля teacher и startDate в
// правилах записи запрещены (hasOnly), поэтому считаются необязательными —
// старые дисциплины без них отображаются без ошибок.

// Активные темы (без архивных). Массив не мутируется.
export function activeTopics(topics) {
  return (Array.isArray(topics) ? topics : []).filter(t => t?.status !== STATUS_ARCHIVED);
}

// Прогресс изучения дисциплины: доля активных тем от общего числа, в
// процентах. 0 тем — 0%. Округление до целого — для карточки.
export function disciplineProgress(topics) {
  const list = Array.isArray(topics) ? topics : [];
  if (!list.length) return 0;
  const active = activeTopics(list).length;
  return Math.round(active / list.length * 100);
}

// Ближайшая запланированная тема: первая активная тема с датой начала
// (startDate). Старые темы без startDate не участвуют — поле в правилах
// записи запрещено, поэтому ожидать его можно только в старых данных.
// Возвращает тему или null.
export function nextScheduledTopic(topics) {
  const scheduled = activeTopics(topics)
    .filter(t => t.startDate)
    .sort((a, b) => {
      const da = new Date(a.startDate).getTime() || Infinity;
      const db = new Date(b.startDate).getTime() || Infinity;
      return da - db;
    });
  return scheduled[0] || null;
}

// Краткое описание для карточки: обрезка по границе слова до limit символов.
// Строковые описания только: числа и прочее (старые данные) → "".
export function shortDescription(text, limit = 140) {
  if (typeof text !== "string") return "";
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  const cut = trimmed.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return (space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd() + "…";
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

// ---------- Поля расписания темы: группа и даты ----------

// Учебная группа темы: пустая строка = для всех групп (старые данные и
// темы без ограничения). Строка до 100 символов — как groupId задания
// (core/assign.js).
function topicGroupError(data) {
  if (data.groupId === undefined) return null;
  if (typeof data.groupId !== "string") return "Некорректная учебная группа";
  if (data.groupId.trim().length > 100) return "Название группы слишком длинное (максимум 100 символов)";
  return null;
}

// Дата темы: null (не задана) или объект с toMillis() (Firestore Timestamp
// в приложении; в тестах — мок той же формы). Строки и числа отклоняются:
// вызывающий код обязан конвертировать input type=date в Timestamp,
// иначе правила Firestore отклонят запись.
export function topicDateMs(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : undefined;
  }
  if (typeof value === "object" && typeof value.toMillis === "function") {
    const ms = Number(value.toMillis());
    return Number.isFinite(ms) ? ms : undefined;
  }
  return undefined; // некорректный тип
}

function topicDatesError(data) {
  const ms = {};
  for (const field of TOPIC_DATE_FIELDS) {
    if (data[field] === undefined) continue;
    const value = topicDateMs(data[field]);
    if (value === undefined) {
      return `Некорректная дата: ${field}`;
    }
    ms[field] = value;
  }
  // Окно доступа: дата закрытия не может быть раньше даты открытия.
  if (ms.openDate != null && ms.closeDate != null && ms.closeDate < ms.openDate) {
    return "Дата закрытия не может быть раньше даты открытия";
  }
  return null;
}

// Валидация данных темы: как у предмета + обязательный subjectId при
// создании; при изменении subjectId запрещён (перенос между предметами
// не поддерживается — см. правила). Статусы темы шире: черновик,
// запланирована, опубликована, архив. Дополнительно проверяются поля
// расписания: groupId и даты (lessonDate/openDate/closeDate/publishDate/dueDate).
export function validateTopicData(data, isCreate = false) {
  const src = data || {};
  const topicOpts = {
    statuses: TOPIC_STATUSES,
    createStatuses: TOPIC_CREATE_STATUSES,
    defaultStatus: TOPIC_STATUS_DRAFT
  };
  const error = systemFieldError(src, isCreate ? SUBJECT_SYSTEM_FIELDS : TOPIC_SYSTEM_FIELDS)
    || unknownFieldError(src, TOPIC_FIELDS)
    || (isCreate && !validSubjectId(src) ? "Укажите предмет (subjectId)" : null)
    || commonFieldsError(src, isCreate, topicOpts)
    || topicGroupError(src)
    || topicDatesError(src);
  if (error) return { ok: false, error };
  const value = normalizeCommon(src, isCreate, topicOpts);
  if (isCreate) value.subjectId = src.subjectId.trim();
  if (isCreate && value.groupId === undefined) value.groupId = "";
  if (src.groupId !== undefined) value.groupId = src.groupId.trim();
  // Даты проходят как есть (Timestamp|null) — конвертация на вызывающей
  // стороне, правила Firestore проверяют тип.
  for (const field of TOPIC_DATE_FIELDS) {
    if (src[field] !== undefined) value[field] = src[field];
  }
  return { ok: true, value };
}
