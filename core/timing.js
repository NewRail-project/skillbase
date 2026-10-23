// core/timing.js — чистый расчёт дедлайна вопроса.
// Без DOM и Firebase, чтобы проверяться юнит-тестами в Node.

export function effectiveDeadline(qStartMs, attemptDeadlineMs, timePerQuestionSec) {
  if (!attemptDeadlineMs) return qStartMs + (timePerQuestionSec || 5) * 1000;
  if (!timePerQuestionSec) return attemptDeadlineMs;

  const qDeadline = qStartMs + timePerQuestionSec * 1000;
  return Math.min(qDeadline, attemptDeadlineMs);
}
