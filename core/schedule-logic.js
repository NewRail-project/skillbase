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

// Firestore Timestamp | Date | число | ISO-строка → миллисекунды или null.
export function dateMs(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && typeof value.toMillis === "function") {
    const ms = Number(value.toMillis());
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "object" && typeof value.seconds === "number") return value.seconds * 1000;
  if (typeof value === "string") {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
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
// state: "upcoming" (ещё не открыта) | "closed" | "overdue" (срок сдачи
// прошёл, тема ещё открыта) | "open".
export function studentTopicState(topic, nowMs = Date.now()) {
  const open = dateMs(topic?.openDate);
  const close = dateMs(topic?.closeDate);
  const due = dateMs(topic?.dueDate);
  if (open !== null && nowMs < open) {
    return { state: "upcoming", label: `Откроется ${formatTopicDate(open)}` };
  }
  if (close !== null && nowMs >= close + DAY_MS) {
    return { state: "closed", label: "Тема закрыта" };
  }
  if (due !== null && nowMs >= due + DAY_MS) {
    return { state: "overdue", label: `Срок сдачи прошёл (${formatTopicDate(due)})` };
  }
  if (due !== null) return { state: "available", label: `Сдать до ${formatTopicDate(due)}` };
  return { state: "available", label: "Открыта" };
}
