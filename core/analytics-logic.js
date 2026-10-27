// core/analytics-logic.js — чистая аналитика по попыткам: проценты верных
// по вопросам, средний балл по группам, вопросы с низким процентом.
// Никакого Firestore и DOM — проверяется юнит-тестами в Node.

// Только финализированные попытки: submitted (обычная), graded
// (проверенная вручную), expired (время вышло — ответы тоже показывают
// уровень). in_progress в аналитику не попадает.
export const ANALYTICS_STATUSES = ["submitted", "graded", "expired"];

// Аналитика считается по последним N попыткам ( ограничения Firestore и
// памяти мобильного устройства).
export const ANALYTICS_LIMIT = 500;

export const LOW_PERCENT_THRESHOLD = 40;

// Проверку ответов берём у scoring.js — та же логика, что при проверке
// попытки студенту и в live-комнатах.
import { isCorrect } from "./scoring.js";

export function analyticsAttempt(attempt) {
  return ANALYTICS_STATUSES.includes(attempt?.status);
}

// Нормализованные ключи вопросов уже на входе: keys от testKeys
// ({ "0": { points, correct|answer, ... }, ... }).
export function buildAnalytics(attempts, keys, { limit = ANALYTICS_LIMIT } = {}) {
  const usable = (attempts || [])
    .filter(analyticsAttempt)
    .sort((a, b) => (toTimeMs(b.finishedAt || b.createdAt) - toTimeMs(a.finishedAt || a.createdAt)))
    .slice(0, limit);

  const questionIds = Object.keys(keys || {}).sort((a, b) => Number(a) - Number(b));
  const perQuestion = questionIds.map(qid => {
    let correct = 0;
    let answered = 0;
    let total = 0;
    for (const attempt of usable) {
      total += 1;
      const answer = attempt.answers?.[qid];
      if (answer != null && answer !== "") answered += 1;
      if (isAnswerCorrect(keys[qid], answer)) correct += 1;
    }
    // Процент верных: верный ответ / все попытки (пропуск считаем неверным).
    const percent = total ? Math.round(correct / total * 100) : null;
    return {
      qid,
      attempts: total,
      answered,
      correct,
      percent,
      low: percent != null && percent < LOW_PERCENT_THRESHOLD
    };
  });

  // Группы: средний процент попытки (score/total) по groupId.
  const byGroup = new Map();
  for (const attempt of usable) {
    const gid = attempt.groupId || "Без группы";
    if (!byGroup.has(gid)) byGroup.set(gid, []);
    byGroup.get(gid).push(attemptPercent(attempt));
  }
  const groups = [...byGroup.entries()].map(([gid, percents]) => ({
    groupId: gid,
    attempts: percents.length,
    avgPercent: Math.round(percents.reduce((sum, v) => sum + v, 0) / percents.length),
    minPercent: Math.min(...percents),
    maxPercent: Math.max(...percents)
  })).sort((a, b) => b.avgPercent - a.avgPercent);

  return {
    attemptsCount: usable.length,
    limit,
    perQuestion,
    groups,
    lowQuestions: perQuestion.filter(q => q.low)
  };
}

function attemptPercent(attempt) {
  if (Number.isFinite(attempt.percent)) return attempt.percent;
  const score = Number(attempt.score || 0);
  const total = Number(attempt.total || 0);
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round(score / total * 100)));
}

function toTimeMs(value) {
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value === "number") return value;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function isAnswerCorrect(key, answer) {
  if (!key || answer == null) return false;
  return isCorrect(key, answer);
}
