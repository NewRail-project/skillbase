// core/timing.js — чистый расчёт дедлайна вопроса.
// Без DOM и Firebase, чтобы проверяться юнит-тестами в Node.

export function attemptDeadlineMs({ startedMs, limitSeconds, storedMs, assignedMs }) {
  const limits = [];
  const start = Number.isFinite(startedMs) ? startedMs : Date.now();
  const limit = Number(limitSeconds);
  if (Number.isFinite(limit) && limit > 0) {
    limits.push(start + limit * 1000);
  }
  const stored = Number(storedMs);
  if (Number.isFinite(stored) && stored > 0) {
    limits.push(stored);
  }
  const assigned = Number(assignedMs);
  if (Number.isFinite(assigned) && assigned > 0) {
    limits.push(assigned);
  }
  return limits.length ? Math.min(...limits) : null;
}

export function effectiveDeadline(qStartMs, attemptDeadlineMsParam, timePerQuestionSec) {
  if (!attemptDeadlineMsParam) return qStartMs + (timePerQuestionSec || 5) * 1000;
  if (!timePerQuestionSec) return attemptDeadlineMsParam;

  const qDeadline = qStartMs + timePerQuestionSec * 1000;
  return Math.min(qDeadline, attemptDeadlineMsParam);
}

// Проверяет срок в момент вызова, а не только при отрисовке страницы.
// Принимает Date, число или объект Firestore Timestamp.
export function isDeadlinePassed(value, now = Date.now()) {
  if (!value) return false;
  let time;
  if (value instanceof Date) time = value.getTime();
  else if (typeof value.toMillis === "function") time = value.toMillis();
  else if (typeof value.toDate === "function") time = value.toDate().getTime();
  else if (typeof value.seconds === "number") time = value.seconds * 1000;
  else time = new Date(value).getTime();

  return Number.isFinite(time) && time <= now;
}
