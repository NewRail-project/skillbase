// core/test-history-logic.js — история обычного теста: из попыток учеников
// собираем тот же вход, что и для отчёта Live (участник → ответы).
// Незавершённые, отменённые и просроченные попытки полноценным результатом
// не считаются. Модуль без Firebase и DOM.

export const COUNTED_STATUSES = ["submitted", "graded"];

const toMs = (value) => {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
};

export const attemptTime = (a) => toMs(a.submittedAt) || toMs(a.finishedAt) || toMs(a.startedAt);

// mode: "last" — последняя завершённая попытка; "best" — лучшая по проценту.
export function pickAttemptPerStudent(attempts, { testId = null, mode = "last" } = {}) {
  const byUser = new Map();
  for (const a of attempts || []) {
    if (testId && a.testId !== testId) continue;
    if (!COUNTED_STATUSES.includes(a.status)) continue;
    const uid = a.userId || a.id;
    const prev = byUser.get(uid);
    if (!prev) { byUser.set(uid, a); continue; }
    const better = mode === "best"
      ? (Number(a.percent) || 0) > (Number(prev.percent) || 0)
        || ((Number(a.percent) || 0) === (Number(prev.percent) || 0) && attemptTime(a) > attemptTime(prev))
      : attemptTime(a) > attemptTime(prev);
    if (better) byUser.set(uid, a);
  }
  return [...byUser.values()];
}

// Попытки → «игроки» для buildLiveReport / gradeRoster.
export function attemptsToPlayers(attempts) {
  return (attempts || []).map(a => ({
    uid: a.userId || a.id,
    name: a.userName || (a.userEmail ? String(a.userEmail).split("@")[0] : "Участник"),
    answers: a.answers && typeof a.answers === "object" ? a.answers : {},
    attemptId: a.id,
    testVersion: a.testVersion || null
  }));
}
