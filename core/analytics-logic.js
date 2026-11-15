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
// Аналитика ученика переиспользует существующие расчёты progress.js
// (этап 6 не заменяет их): средний балл, предметы, слабые темы, динамика.
import { computeStudentProgress } from "./progress.js";

export function analyticsAttempt(attempt) {
  return ANALYTICS_STATUSES.includes(attempt?.status);
}

export function aggregateStudentStats(attempts) {
  const completed = attempts.filter(a => a.status === "graded" && typeof a.percent === "number");
  if (completed.length === 0) return { bestScore: 0, averageScore: 0, attemptsCount: 0, lastScore: 0 };

  const scores = completed.map(a => a.percent);
  const bestScore = Math.max(...scores);
  const averageScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const lastScore = completed.sort((a, b) => (b.finishedAt?.toMillis() || 0) - (a.finishedAt?.toMillis() || 0))[0].percent;

  return { bestScore, averageScore, attemptsCount: completed.length, lastScore };
}

export function aggregateLeaderboard(attempts, { subjectId = null, topicId = null, groupId = null } = {}) {
  let filtered = attempts.filter(a => a.status === "graded" && typeof a.percent === "number");
  if (subjectId) filtered = filtered.filter(a => a.subjectId === subjectId);
  if (topicId) filtered = filtered.filter(a => a.topicId === topicId);
  if (groupId) filtered = filtered.filter(a => a.groupId === groupId);

  const studentMap = new Map();
  filtered.forEach(a => {
    if (!studentMap.has(a.userId)) studentMap.set(a.userId, { scoreSum: 0, count: 0, name: a.userName || "Участник" });
    const s = studentMap.get(a.userId);
    s.scoreSum += a.percent;
    s.count += 1;
  });

  return Array.from(studentMap.entries()).map(([userId, data]) => ({
    userId,
    name: data.name,
    average: Math.round(data.scoreSum / data.count),
    count: data.count
  })).sort((a, b) => b.average - a.average || a.name.localeCompare(b.name));
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
  // null/undefined/строки без даты → 0 (нет времени); старые записи
  // без полей дат не должны ломать аналитику (этап 6, сценарий
  // «старые записи без новых полей»).
  if (value == null) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value === "number") return value;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function isAnswerCorrect(key, answer) {
  if (!key || answer == null) return false;
  return isCorrect(key, answer);
}

// =====================================================================
// Этап 6: аналитика дисциплин, тем, групп и учеников.
// Существующие функции выше не тронуты (leaderboard и результаты
// полагаются на них); ниже — новые чистые расчёты поверх тех же данных.
// Все функции без Firebase: тестируются в Node
// (tests/analytics-ext.test.js). Пустые состояния — не выдуманные нули:
// где данных нет, возвращается null, чтобы страница показала «нет данных».
// =====================================================================

// Порог «освоено» для завершённой темы по тесту. Совпадает с порогом
// зачёта профиля (core/profile.js: passPercent = 60) — формулу оценки
// (scoreAttempt) этап 6 не меняет.
export const TOPIC_PASS_PERCENT = 60;

// Тип проверки попытки: по заданию (assignment) или свободное прохождение.
export function attemptKind(attempt) {
  return attempt?.assignmentId ? "assignment" : "free";
}

export const ATTEMPT_KINDS = ["assignment", "free"];

// ---------- Единый фильтр страницы аналитики ----------

// Периоды: дни назад от «сейчас»; null = всё время.
export const PERIODS = [
  { id: "all", days: null, label: "Всё время" },
  { id: "7", days: 7, label: "7 дней" },
  { id: "30", days: 30, label: "30 дней" },
  { id: "90", days: 90, label: "90 дней" }
];

// Привязка попытки ко времени: завершённые — по finishedAt, начатые —
// по startedAt; старые записи без дат (легаси) не отсекаются периодом.
export function attemptTimeValue(attempt) {
  const ms = toTimeMs(attempt?.finishedAt || attempt?.startedAt || attempt?.submittedAt || attempt?.createdAt);
  return ms > 0 ? ms : null;
}

// Единый фильтр всех аналитических страниц. Пустой параметр = не фильтрует.
// kind: null|"" — все, "assignment" — по заданию, "free" — свободные.
export function filterAttempts(attempts, {
  subjectId = null, topicId = null, groupId = null,
  userId = null, kind = null, fromMs = null, toMs = null
} = {}) {
  return (attempts || []).filter(a => {
    if (subjectId && a.subjectId !== subjectId) return false;
    if (topicId && a.topicId !== topicId) return false;
    if (groupId && a.groupId !== groupId) return false;
    if (userId && a.userId !== userId) return false;
    if (kind && attemptKind(a) !== kind) return false;
    const ms = attemptTimeValue(a);
    if (fromMs && ms !== null && ms < fromMs) return false;
    if (toMs && ms !== null && ms > toMs) return false;
    // Попытки без дат (старые записи) показываем при любом периоде:
    // терять историю хуже, чем показать вне периода.
    return true;
  });
}

// ---------- Общие расчёты ----------

// Распределение оценок (завершённые попытки с percent) по корзинам.
// Возвращает [{ label, from, to, count }]; sum(count) == попыток.
export function gradeDistribution(percents) {
  const buckets = [
    { label: "0–49", from: 0, to: 49 },
    { label: "50–69", from: 50, to: 69 },
    { label: "70–84", from: 70, to: 84 },
    { label: "85–100", from: 85, to: 100 }
  ].map(b => ({ ...b, count: 0 }));
  let total = 0;
  for (const value of percents || []) {
    if (value == null) continue; // null/undefined — не оценка
    const p = Number(value);
    if (!Number.isFinite(p) || p < 0 || p > 100) continue;
    const bucket = buckets.find(b => p >= b.from && p <= b.to);
    if (bucket) {
      bucket.count += 1;
      total += 1;
    }
  }
  return total ? { buckets, total } : null;
}

// Средний по массиву процентов; пусто/без чисел → null (не 0).
export function averagePercent(percents) {
  const values = (percents || []).filter(p => Number.isFinite(p));
  if (!values.length) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

// Динамика успеваемости: средний процент завершённых попыток по
// недельным корзинам (7 дней). Точки без попыток пропускаются —
// линейный график соединяет только реальные данные.
export function performanceDynamics(attempts, nowMs, { weeks = 8 } = {}) {
  const graded = (attempts || [])
    .filter(a => a.status === "graded" && Number.isFinite(a.percent))
    .map(a => ({ ms: attemptTimeValue(a), percent: a.percent }))
    .filter(p => p.ms !== null)
    .sort((a, b) => a.ms - b.ms);
  if (!graded.length) return null;
  const DAY = 24 * 3600 * 1000;
  const start = Math.max(
    graded[0].ms,
    nowMs - (weeks - 1) * 7 * DAY
  );
  const points = [];
  for (let i = 0; i < weeks; i++) {
    const from = start + i * 7 * DAY;
    const to = from + 7 * DAY;
    const inBucket = graded.filter(p => p.ms >= from && p.ms < to);
    // Пустые корзины в середине пропускаем: график по фактам.
    if (!inBucket.length) continue;
    points.push({
      ms: from,
      label: `до ${new Date(to).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}`,
      avgPercent: averagePercent(inBucket.map(p => p.percent)),
      count: inBucket.length
    });
  }
  return points.length >= 2 ? points : null; // одна точка — не динамика
}

// ---------- Дисциплина ----------

// Аналитика дисциплины. students — список студентов (roster организации,
// опционально суженный по группам преподавателя); topics — активные темы
// дисциплины; attempts — попытки дисциплины (subjectId == id);
// completedMaterialIds — id тем, где материал завершён хотя бы одним
// студентом (приходит со страницы — Firestore-слой).
export function disciplineAnalytics({
  attempts = [], topics = [], students = [],
  completedMaterialTopicIds = new Set(), nowMs = Date.now()
} = {}) {
  const graded = attempts.filter(a => a.status === "graded" && Number.isFinite(a.percent));
  const scores = graded.map(a => a.percent);
  const topicsCount = topics.length;
  const percentsByTopic = new Map();
  for (const a of graded) {
    if (!a.topicId) continue;
    if (!percentsByTopic.has(a.topicId)) percentsByTopic.set(a.topicId, []);
    percentsByTopic.get(a.topicId).push(a.percent);
  }
  // Тема завершена любым из признаков: средний балл по тестам темы ≥
  // порога (60%) или материал темы завершён хотя бы одним студентом.
  // Пересечение признаков считается один раз.
  const completedSet = new Set();
  for (const t of topics) {
    const avg = averagePercent(percentsByTopic.get(t.id) || []);
    if ((avg !== null && avg >= TOPIC_PASS_PERCENT) || completedMaterialTopicIds.has(t.id)) {
      completedSet.add(t.id);
    }
  }
  const activeStudentIds = new Set(
    attempts.filter(a => {
      const ms = attemptTimeValue(a);
      return ms !== null && nowMs - ms <= 30 * 24 * 3600 * 1000;
    }).map(a => a.userId)
  );
  const activeStudents = students.filter(s => activeStudentIds.has(s.uid)).length;

  return {
    studentsCount: students.length,
    topicsCount,
    // Освоение программы: доля завершённых тем от всех тем дисциплины.
    masteryPercent: topicsCount ? Math.round(completedSet.size / topicsCount * 100) : null,
    averageScore: averagePercent(scores),
    bestScore: scores.length ? Math.max(...scores) : null,
    completedTopics: completedSet.size,
    incompleteTopics: topicsCount - completedSet.size,
    // Активность: доля студентов с попыткой за 30 дней.
    activeStudents,
    activeStudentsPercent: students.length
      ? Math.round(activeStudentIds.size / students.length * 100)
      : null,
    attemptsCount: attempts.length,
    gradedCount: graded.length,
    inProgressCount: attempts.filter(a => a.status === "in_progress").length
  };
}

// ---------- Тема ----------

// Аналитика темы. assignedCount — назначенных студентов (со страницы:
// группы заданий × состав групп); progressRows — строки materialProgress
// по материалам темы [{ uid, completed }]; questionStats — результат
// buildAnalytics по тестам темы (частые ошибки/сложные вопросы).
export function topicAnalytics({
  attempts = [], assignedCount = 0,
  progressRows = [], questionStats = null, keys = null
} = {}) {
  const graded = attempts.filter(a => a.status === "graded" && Number.isFinite(a.percent));
  const scores = graded.map(a => a.percent);
  const startedUserIds = new Set(attempts.map(a => a.userId));
  const passedUserIds = new Set(graded.filter(a => a.percent >= TOPIC_PASS_PERCENT).map(a => a.userId));
  const materialUsers = new Map(); // uid → { started, completed }
  for (const row of progressRows) {
    if (!row?.uid) continue;
    const state = materialUsers.get(row.uid) || { started: false, completed: false };
    state.started = true;
    if (row.completed === true) state.completed = true;
    materialUsers.set(row.uid, state);
  }
  const finishedMaterial = [...materialUsers.values()].filter(s => s.completed).length;
  const startedMaterial = materialUsers.size;
  const repeatUserIds = new Set(
    graded.length
      ? [...graded.reduce((map, a) => {
        map.set(a.userId, (map.get(a.userId) || 0) + 1);
        return map;
      }, new Map())].filter(([, n]) => n > 1).map(([uid]) => uid)
      : []
  );

  return {
    // Назначенных знает страница (состав групп × задания); попытки — факт.
    assignedCount,
    startedCount: startedUserIds.size,
    startedMaterialCount: startedMaterial,
    finishedMaterialCount: finishedMaterial,
    passedCount: passedUserIds.size,
    notPassedCount: Math.max(assignedCount - passedUserIds.size, 0),
    averageScore: averagePercent(scores),
    bestScore: scores.length ? Math.max(...scores) : null,
    attemptsCount: attempts.length,
    gradedCount: graded.length,
    inProgressCount: attempts.filter(a => a.status === "in_progress").length,
    repeatStudentsCount: repeatUserIds.size,
    distribution: gradeDistribution(scores),
    // Частые ошибки и сложные вопросы — из buildAnalytics (те же ключи).
    questionStats: questionStats || (keys ? buildAnalytics(attempts, keys) : null)
  };
}

// ---------- Группа ----------

// Аналитика группы: рейтинг по УЧЕБНЫМ результатам (средний балл
// завершённых попыток) — не путать с Live-рейтингом комнат.
// lagging — отстающие: средний < TOPIC_PASS_PERCENT; inactive — без
// попыток за 30 дней.
export function groupAnalytics({
  attempts = [], students = [], topics = [], nowMs = Date.now()
} = {}) {
  const graded = attempts.filter(a => a.status === "graded" && Number.isFinite(a.percent));
  const byStudent = new Map();
  for (const a of graded) {
    if (!byStudent.has(a.userId)) byStudent.set(a.userId, []);
    byStudent.get(a.userId).push(a.percent);
  }
  const lastActivityMs = new Map();
  for (const a of attempts) {
    const ms = attemptTimeValue(a);
    if (ms === null) continue;
    const prev = lastActivityMs.get(a.userId) || 0;
    if (ms > prev) lastActivityMs.set(a.userId, ms);
  }
  const ranking = students.map(student => {
    const scores = byStudent.get(student.uid) || [];
    const ms = lastActivityMs.get(student.uid) || null;
    return {
      uid: student.uid,
      name: student.fullName || student.userName || "Ученик",
      attemptsCount: scores.length,
      averageScore: averagePercent(scores),
      bestScore: scores.length ? Math.max(...scores) : null,
      lastActivityMs: ms,
      inactive: ms === null || nowMs - ms > 30 * 24 * 3600 * 1000,
      lagging: scores.length > 0 && averagePercent(scores) < TOPIC_PASS_PERCENT
    };
  })
    .sort((a, b) => (b.averageScore ?? -1) - (a.averageScore ?? -1)
      || a.name.localeCompare(b.name, "ru", { sensitivity: "base" }));

  // Сравнение тем: средний балл по темам группы.
  const topicComparison = topics
    .map(topic => {
      const scores = graded.filter(a => a.topicId === topic.id).map(a => a.percent);
      return { topicId: topic.id, title: topic.title || topic.id, averageScore: averagePercent(scores), count: scores.length };
    })
    .filter(row => row.count > 0)
    .sort((a, b) => (b.averageScore ?? -1) - (a.averageScore ?? -1));

  return {
    studentsCount: students.length,
    attemptsCount: attempts.length,
    averageScore: averagePercent(graded.map(a => a.percent)),
    ranking,
    lagging: ranking.filter(r => r.lagging),
    inactive: ranking.filter(r => r.inactive),
    topicComparison,
    activeStudentsPercent: students.length
      ? Math.round(ranking.filter(r => !r.inactive).length / students.length * 100)
      : null
  };
}

// ---------- Задания ----------

// Доля выполненных заданий: у задания со сроком выполнено = есть graded
// попытка (percent >= TOPIC_PASS_PERCENT) студента группы задания до срока
// (или после — тоже считается выполнением, но помечается просрочкой).
// Возвращает { total, done, percent, overdueRows }.
export function assignmentCompletion({
  assignments = [], attempts = [], students = [], nowMs = Date.now()
} = {}) {
  const gradedByTestUser = new Set(
    attempts.filter(a => a.status === "graded" && Number.isFinite(a.percent))
      .map(a => `${a.testId}|${a.userId}`)
  );
  const studentsByGroup = new Map();
  for (const s of students) {
    const gid = s.groupId || "";
    if (!studentsByGroup.has(gid)) studentsByGroup.set(gid, []);
    studentsByGroup.get(gid).push(s);
  }
  let total = 0;
  let done = 0;
  const overdueRows = [];
  for (const assignment of assignments) {
    const groupStudents = studentsByGroup.get(assignment.groupId || "") || [];
    for (const student of groupStudents) {
      total += 1;
      if (gradedByTestUser.has(`${assignment.testId}|${student.uid}`)) {
        done += 1;
      } else {
        const deadlineMs = toTimeMs(assignment.deadline);
        if (deadlineMs && deadlineMs < nowMs) {
          overdueRows.push({
            assignmentId: assignment.id,
            testId: assignment.testId,
            testTitle: assignment.testTitle || assignment.testId,
            uid: student.uid,
            name: student.fullName || "Ученик",
            groupId: assignment.groupId || "",
            deadlineMs
          });
        }
      }
    }
  }
  return {
    total,
    done,
    percent: total ? Math.round(done / total * 100) : null,
    overdueRows
  };
}

// ---------- Ученик ----------

// Аналитика ученика: расширяет computeStudentProgress (core/progress.js —
// не заменяем) сильными темами, счётчиком тестов и просроченными
// заданиями. Формулы прежние: средний = среднее завершённых percent.
export function studentAnalytics({
  attempts = [], subjects = [], topics = [], assignments = [], nowMs = Date.now()
} = {}) {
  const base = computeStudentProgress(attempts, subjects, topics);
  const graded = attempts.filter(a => a.status === "graded" && Number.isFinite(a.percent));
  const scoresByTopic = new Map();
  for (const a of graded) {
    if (!a.topicId) continue;
    if (!scoresByTopic.has(a.topicId)) scoresByTopic.set(a.topicId, []);
    scoresByTopic.get(a.topicId).push(a.percent);
  }
  const topicsWithScores = topics
    .filter(t => scoresByTopic.has(t.id))
    .map(t => ({
      topicId: t.id,
      title: t.title || t.id,
      averageScore: averagePercent(scoresByTopic.get(t.id)),
      attemptsCount: scoresByTopic.get(t.id).length
    }));
  const strong = topicsWithScores
    .filter(t => t.averageScore >= TOPIC_PASS_PERCENT)
    .sort((a, b) => b.averageScore - a.averageScore);
  const weak = topicsWithScores
    .filter(t => t.averageScore < TOPIC_PASS_PERCENT)
    .sort((a, b) => a.averageScore - b.averageScore);
  // Слабые из computeStudentProgress основаны на том же пороге 60 —
  // используем их названия, если тема уже не в списке тем (легаси).
  for (const w of base.weakTopics) {
    if (!weak.some(x => x.topicId === w.topicId)) weak.push({ ...w, attemptsCount: null });
  }

  // Просроченные задания: срок прошёл, graded попытки нет.
  const gradedByTest = new Set(graded.map(a => a.testId));
  const overdue = (assignments || []).filter(a => {
    const deadlineMs = toTimeMs(a.deadline);
    return deadlineMs && deadlineMs < nowMs && !gradedByTest.has(a.testId);
  }).map(a => ({
    assignmentId: a.id,
    testId: a.testId,
    testTitle: a.testTitle || a.testId,
    deadlineMs: toTimeMs(a.deadline)
  }));

  return {
    ...base,
    testsCompleted: graded.length,
    strongTopics: strong,
    weakTopicsDetailed: weak,
    overdueAssignments: overdue
  };
}
