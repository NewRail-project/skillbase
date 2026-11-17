// core/schedule-logic.js — расписание темы: даты, окно доступа, статусы.
// Чистые функции без Firebase и DOM (тестируются в Node).
//
// Правила Firestore даты открытия/закрытия НЕ проверяют (правила — не
// фильтры), поэтому окно доступа применяется здесь, во всех местах чтения.

import {
  TOPIC_STATUS_DRAFT, TOPIC_STATUS_PLANNED, TOPIC_STATUS_PUBLISHED, TOPIC_STATUS_ARCHIVED
} from "./subjects-logic.js";

const STATUS_LABELS = Object.freeze({
  [TOPIC_STATUS_DRAFT]: "Черновик",
  [TOPIC_STATUS_PLANNED]: "Запланирована",
  [TOPIC_STATUS_PUBLISHED]: "Опубликована",
  active: "Опубликована",
  [TOPIC_STATUS_ARCHIVED]: "Архивирована"
});

export function topicStatusLabel(status) {
  return STATUS_LABELS[status] || "Опубликована";
}

// Firestore Timestamp | Date | число → миллисекунды или null.
// Строки не допускаются: правила Firestore требуют timestamp, а даты без
// времени разбирает isoDateToMs только для input type=date.
export function dateMs(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && typeof value.toMillis === "function") {
    const ms = Number(value.toMillis());
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "object" && typeof value.seconds === "number") return value.seconds * 1000;
  return null;
}

// "YYYY-MM-DD" (input type=date) → миллисекунды локальной полуночи; "" → null.
export function isoDateToMs(iso) {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (date.getFullYear() !== Number(m[1]) || date.getMonth() !== Number(m[2]) - 1 || date.getDate() !== Number(m[3])) return null;
  return date.getTime();
}

// Миллисекунды → "YYYY-MM-DD" в локальном времени.
export function msToISODate(ms) {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Дата для показа: «15.11.2026»; нет даты — «не задана».
export function formatTopicDate(value) {
  const ms = dateMs(value);
  if (ms === null) return "не задана";
  return new Date(ms).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const DAY_MS = 24 * 3600 * 1000;

// Окно доступа: открытие включительно; закрытие — до конца указанного дня.
export function topicOpenNow(topic, nowMs = Date.now()) {
  const open = dateMs(topic?.openDate);
  const close = dateMs(topic?.closeDate);
  if (open !== null && nowMs < open) return false;
  if (close !== null && nowMs >= close + DAY_MS) return false;
  return true;
}

// Состояние темы глазами студента.
// options.hasAttempts — есть ли у ученика попытки по теме (прогресс).
// state: "upcoming" (ещё не открыта) | "closed" | "overdue" (срок сдачи
// прошёл, попыток нет) | "studying" (открыта, есть попытки) |
// "completed" (срок прошёл, но попытки есть) | "available".
// Черновики, запланированные и архивные темы состояния не выдают (null):
// статус темы хранится отдельно и показывается через topicStatusLabel.
export function studentTopicState(topic, nowMs = Date.now(), { hasAttempts = false } = {}) {
  const status = topic?.status;
  if (status === TOPIC_STATUS_DRAFT || status === TOPIC_STATUS_PLANNED ||
    status === TOPIC_STATUS_ARCHIVED) {
    return null;
  }
  const open = dateMs(topic?.openDate);
  const close = dateMs(topic?.closeDate);
  const due = dateMs(topic?.dueDate);
  // Закрытие доступа важнее прогресса: закрытая тема закрыта для всех.
  if (close !== null && nowMs >= close + DAY_MS) {
    return { state: "closed", label: "Закрыта" };
  }
  if (open !== null && nowMs < open) {
    return { state: "upcoming", label: "Откроется" };
  }
  if (due !== null && nowMs >= due + DAY_MS) {
    return hasAttempts
      ? { state: "completed", label: "Завершена" }
      : { state: "overdue", label: "Просрочена" };
  }
  if (hasAttempts) return { state: "studying", label: "Изучается" };
  return { state: "available", label: "Доступна" };
}

// ---------- План учёбы ----------

// studyPlan(topics, nowMs, { completedTopicIds }) → { current, next }:
//   current — первая открытая незавершённая тема, next — первая тема
//   с датой открытия в будущем. Черновики/архив не участвуют.
export function studyPlan(topics = [], nowMs = Date.now(), { completedTopicIds = new Set() } = {}) {
  const list = (Array.isArray(topics) ? topics : []).filter(t =>
    t && ![TOPIC_STATUS_DRAFT, TOPIC_STATUS_PLANNED, TOPIC_STATUS_ARCHIVED].includes(t.status));
  const done = (t) => completedTopicIds instanceof Set
    ? completedTopicIds.has(t.id)
    : false;
  const current = list.find(t => topicOpenNow(t, nowMs) && !done(t)) || null;
  const next = list.find(t => {
    if (done(t)) return false;
    const open = dateMs(t.openDate);
    return open !== null && open > nowMs;
  }) || null;
  return { current, next };
}

// ---------- События расписания ----------

// Поля дат темы → вид события в расписании.
const TOPIC_DATE_KINDS = [
  ["lessonDate", "lesson"],
  ["openDate", "open"],
  ["closeDate", "close"],
  ["dueDate", "due"]
];

// buildScheduleEvents({ topics, assignments, nowMs }) → события по
// возрастанию времени: занятия/открытия/закрытия/сроки тем и сроки
// заданий. Архивные темы и записи без дат событий не дают.
// При равном времени срок задания идёт раньше занятия (kind как ключ).
export function buildScheduleEvents({ topics = [], assignments = [] } = {}) {
  const events = [];
  for (const topic of topics || []) {
    if (!topic || topic.status === TOPIC_STATUS_ARCHIVED) continue;
    for (const [field, kind] of TOPIC_DATE_KINDS) {
      const ms = dateMs(topic[field]);
      if (ms === null) continue;
      events.push({
        dateMs: ms, kind,
        title: topic.title || `Тема ${topic.id}`,
        topicId: topic.id,
        subjectId: topic.subjectId || null,
        groupId: topic.groupId || null
      });
    }
  }
  for (const a of assignments || []) {
    const ms = dateMs(a?.deadline);
    if (ms === null) continue; // задание без срока — не событие
    events.push({
      dateMs: ms, kind: "assignment",
      title: a.testTitle || "Задание",
      testId: a.testId || null,
      subjectId: a.subjectId || null,
      groupId: a.groupId || null
    });
  }
  return events.sort((x, y) =>
    x.dateMs - y.dateMs ||
    String(x.kind).localeCompare(String(y.kind)) ||
    String(x.title).localeCompare(String(y.title), "ru"));
}

// Просроченные: сроки сдачи тем и заданий, время которых уже прошло.
export function overdueEvents(events = [], nowMs = Date.now()) {
  return (Array.isArray(events) ? events : []).filter(e =>
    (e.kind === "due" || e.kind === "assignment" || e.kind === "close") &&
    e.dateMs < nowMs);
}

// Уникальные группы событий (для селекта фильтра), по алфавиту.
export function scheduleGroups(events = []) {
  const groups = new Set();
  for (const e of Array.isArray(events) ? events : []) {
    if (e?.groupId) groups.add(e.groupId);
  }
  return [...groups].sort((a, b) => String(a).localeCompare(String(b), "ru"));
}

// Фильтр событий: по дисциплине (задания остаются — у них нет дисциплины)
// и по группе. Пустые фильтры не режут список.
export function filterScheduleEvents(events = [], { subjectId = null, groupId = null } = {}) {
  return (Array.isArray(events) ? events : []).filter(e => {
    if (subjectId && e.kind !== "assignment" && e.subjectId !== subjectId) return false;
    if (groupId && e.groupId !== groupId) return false;
    return true;
  });
}
