// core/timing.js — чистый расчёт дедлайна вопроса.
// Без DOM и Firebase, чтобы проверяться юнит-тестами в Node.

export function effectiveDeadline(qStartMs, attemptDeadlineMs, timePerQuestionSec) {
  if (!attemptDeadlineMs) return qStartMs + (timePerQuestionSec || 5) * 1000;
  if (!timePerQuestionSec) return attemptDeadlineMs;

  const qDeadline = qStartMs + timePerQuestionSec * 1000;
  return Math.min(qDeadline, attemptDeadlineMs);
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
