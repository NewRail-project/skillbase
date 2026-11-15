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

// Реальные типы проверки попытки (схема проекта):
//   free       — assignmentId пустой: свободное прохождение теста;
//   exam       — попытка по заданию assignments.kind == "exam" (проверка);
//   training   — попытка по заданию assignments.kind == "training" (обучение);
//   assignment — любое задание (в фильтре — объединение exam и training,
//                а также заданий, чей kind неизвестен: удалены/не загружены).
// Live-проверки в коллекции attempts не хранятся (rooms/*/scores, roomHistory),
// поэтому искусственной категории «Live» здесь нет.
export const CHECK_KINDS = [
  { id: "assignment", label: "По заданию (любое)" },
  { id: "exam", label: "Контрольные (задание-проверка)" },
  { id: "training", label: "Обучающие (задание-тренировка)" },
  { id: "free", label: "Свободные прохождения" }
];

// assignmentKinds: Map|object assignmentId → "exam"|"training".
function assignmentKindOf(assignmentKinds, assignmentId) {
  if (!assignmentKinds || !assignmentId) return null;
  const kind = typeof assignmentKinds.get === "function"
    ? assignmentKinds.get(assignmentId)
    : assignmentKinds[assignmentId];
  return kind === "exam" || kind === "training" ? kind : null;
}

// Точный тип проверки попытки: free | exam | training | assignment
// (assignment — задание неизвестного типа).
export function attemptCheckType(attempt, assignmentKinds = null) {
  if (!attempt?.assignmentId) return "free";
  return assignmentKindOf(assignmentKinds, attempt.assignmentId) || "assignment";
}

export function matchesKind(attempt, kind, assignmentKinds = null) {
  if (!kind) return true;
  if (kind === "free") return !attempt?.assignmentId;
  if (kind === "assignment") return Boolean(attempt?.assignmentId);
  // exam/training: только если тип задания известен — не додумываем.
  return attemptCheckType(attempt, assignmentKinds) === kind;
}

// Единый фильтр всех аналитических страниц. Пустой параметр = не фильтрует.
// kind: null|"" — все; "free" — свободные; "assignment" — любое задание;
// "exam"/"training" — тип задания (нужна карта assignmentKinds).
// orgId: если передан, попытки других организаций (и без orgId) отсекаются.
export function filterAttempts(attempts, {
  subjectId = null, topicId = null, groupId = null,
  userId = null, kind = null, fromMs = null, toMs = null,
  orgId = null, assignmentKinds = null
} = {}) {
  return (attempts || []).filter(a => {
    if (orgId && a.orgId !== orgId) return false;
    if (subjectId && a.subjectId !== subjectId) return false;
    if (topicId && a.topicId !== topicId) return false;
    if (groupId && a.groupId !== groupId) return false;
    if (userId && a.userId !== userId) return false;
    if (kind && !matchesKind(a, kind, assignmentKinds)) return false;
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
  completedMaterialTopicIds = new Set(), nowMs = Date.now(),
  // Попытки для расчёта активности (30 дней). По умолчанию — те же, что и
  // для оценок; страница передаёт выборку без фильтра периода/типа, чтобы
  // «активность за 30 дней» не зависела от выбранного периода.
  activityAttempts = null
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
    (activityAttempts || attempts).filter(a => {
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
    // Доля считается по тем же ученикам, что и «активных» (раньше делилась
    // число активных вообще, включая чужих, на размер списка).
    activeStudentsPercent: students.length
      ? Math.round(activeStudents / students.length * 100)
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
  attempts = [], students = [], topics = [], nowMs = Date.now(),
  activityAttempts = null
} = {}) {
  const graded = attempts.filter(a => a.status === "graded" && Number.isFinite(a.percent));
  const byStudent = new Map();
  for (const a of graded) {
    if (!byStudent.has(a.userId)) byStudent.set(a.userId, []);
    byStudent.get(a.userId).push(a.percent);
  }
  const lastActivityMs = new Map();
  for (const a of (activityAttempts || attempts)) {
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

  const allScores = graded.map(a => a.percent);
  return {
    ...base,
    // computeStudentProgress отдаёт 0 при отсутствии оценок (его используют
    // другие страницы). В аналитике «нет оценок» — null, а не 0%.
    averageScore: averagePercent(allScores),
    bestScore: allScores.length ? Math.max(...allScores) : null,
    testsCompleted: graded.length,
    strongTopics: strong,
    weakTopicsDetailed: weak,
    overdueAssignments: overdue
  };
}

// =====================================================================
// Единая модель страницы аналитики (фильтры → зависимые списки → разделы).
//
// Причина прежних дефектов фильтров: страница держала шесть независимых
// селектов, а каждый раздел сам решал, какие данные брать (кто-то из
// отфильтрованных попыток, кто-то — из всего списка учеников/заданий).
// Теперь:
//   • normalizeFilters — зависимая цепочка дисциплина → тема, группа →
//     ученик: несовместимый выбор сбрасывается;
//   • filterOptions — списки опций строго по выбранным родителям;
//   • analyticsView — ВСЕ карточки, графики, таблицы и рейтинги считаются
//     из одной выборки, поэтому расходиться им не из чего.
// Чистые функции без Firebase/DOM: проверяются в Node.
// =====================================================================

const DAY_MS = 24 * 3600 * 1000;

export const EMPTY_FILTERS = Object.freeze({
  subjectId: "", topicId: "", groupId: "", userId: "", period: "all", kind: ""
});

const isGraded = a => a?.status === "graded" && Number.isFinite(a.percent);
const isFinished = a => ANALYTICS_STATUSES.includes(a?.status);
const sameOrg = (item, orgId) => !orgId || !item?.orgId || item.orgId === orgId;
const byRu = (a, b) => String(a).localeCompare(String(b), "ru", { sensitivity: "base" });

export function hasActiveFilters(filters = {}) {
  const f = { ...EMPTY_FILTERS, ...filters };
  return Boolean(f.subjectId || f.topicId || f.groupId || f.userId || f.kind
    || (f.period && f.period !== "all"));
}

// Подготовка входа: изоляция организаций, карты типов заданий и
// привязки тестов к дисциплине/теме.
function prepareData({
  attempts = [], students = [], subjects = [], topics = [],
  assignments = [], orgId = null
} = {}) {
  // Попытки: orgId обязателен и должен совпасть (граница арендатора).
  // Справочники: отсекаем только явно чужие записи — старые документы без
  // orgId не теряем.
  const orgAttempts = (attempts || []).filter(a => !orgId || a?.orgId === orgId);
  const orgAssignments = (assignments || []).filter(a => sameOrg(a, orgId));
  const kinds = new Map();
  for (const a of orgAssignments) {
    if (a?.id && (a.kind === "exam" || a.kind === "training")) kinds.set(a.id, a.kind);
  }
  // У задания нет предмета/темы — берём их у теста по его попыткам.
  // Задание теста без попыток к дисциплине не привязывается (не выдумываем).
  const meta = new Map();
  for (const a of orgAttempts) {
    if (!a.testId || meta.has(a.testId)) continue;
    if (a.subjectId || a.topicId) meta.set(a.testId, { subjectId: a.subjectId || null, topicId: a.topicId || null });
  }
  return {
    orgId,
    attempts: orgAttempts,
    students: (students || []).filter(s => sameOrg(s, orgId)),
    subjects: (subjects || []).filter(s => sameOrg(s, orgId)),
    topics: (topics || []).filter(t => sameOrg(t, orgId)),
    assignments: orgAssignments,
    kinds,
    meta
  };
}

function groupsFor(ctx, subjectId) {
  const set = new Set();
  for (const a of ctx.attempts) {
    if (a.groupId && (!subjectId || a.subjectId === subjectId)) set.add(a.groupId);
  }
  for (const a of ctx.assignments) {
    if (a.groupId && (!subjectId || ctx.meta.get(a.testId)?.subjectId === subjectId)) set.add(a.groupId);
  }
  // Без дисциплины доступны и группы ростера (даже без попыток).
  if (!subjectId) for (const s of ctx.students) if (s.groupId) set.add(s.groupId);
  return [...set].sort(byRu);
}

function studentsFor(ctx, { subjectId, groupId }) {
  let list = ctx.students;
  if (groupId) {
    // Ученики группы: по профилю и по снимку группы в попытках
    // (ученик мог перейти в другую группу — его прежние попытки остаются).
    const viaAttempts = new Set(ctx.attempts.filter(a => a.groupId === groupId).map(a => a.userId));
    list = list.filter(s => s.groupId === groupId || viaAttempts.has(s.uid));
  } else if (subjectId) {
    const withAttempts = new Set(ctx.attempts.filter(a => a.subjectId === subjectId).map(a => a.userId));
    const groups = new Set(groupsFor(ctx, subjectId));
    list = list.filter(s => withAttempts.has(s.uid) || (s.groupId && groups.has(s.groupId)));
  }
  const seen = new Set();
  return list
    .filter(s => s?.uid && !seen.has(s.uid) && seen.add(s.uid))
    .sort((a, b) => byRu(a.fullName || a.uid, b.fullName || b.uid));
}

function normalizeCtx(ctx, filters = {}) {
  const f = { ...EMPTY_FILTERS, ...filters };
  const out = { ...EMPTY_FILTERS };
  out.subjectId = ctx.subjects.some(s => s.id === f.subjectId) ? f.subjectId : "";
  const topic = ctx.topics.find(t => t.id === f.topicId);
  out.topicId = topic && (!out.subjectId || topic.subjectId === out.subjectId) ? f.topicId : "";
  out.groupId = f.groupId && groupsFor(ctx, out.subjectId).includes(f.groupId) ? f.groupId : "";
  out.userId = f.userId
    && studentsFor(ctx, out).some(s => s.uid === f.userId) ? f.userId : "";
  out.kind = CHECK_KINDS.some(k => k.id === f.kind) ? f.kind : "";
  out.period = PERIODS.some(p => p.id === f.period) ? f.period : "all";
  return out;
}

// Зависимая цепочка: дисциплина → тема/группа → ученик. Всё несовместимое
// с уже выбранным «родителем» сбрасывается; «чужой» id (из другой
// организации, удалённый) тоже сбрасывается.
export function normalizeFilters(data, filters = {}) {
  return normalizeCtx(prepareData(data), filters);
}

function optionsCtx(ctx, f) {
  return {
    subjects: ctx.subjects,
    topics: ctx.topics.filter(t => !f.subjectId || t.subjectId === f.subjectId),
    groups: groupsFor(ctx, f.subjectId),
    students: studentsFor(ctx, f),
    kinds: CHECK_KINDS,
    periods: PERIODS
  };
}

// Опции селектов для текущего (нормализованного) состояния фильтров.
export function filterOptions(data, filters = {}) {
  const ctx = prepareData(data);
  return optionsCtx(ctx, normalizeCtx(ctx, filters));
}

function topicsInScope(ctx, f) {
  return ctx.topics
    .filter(t => !t.status || t.status !== "archived")
    .filter(t => !f.subjectId || t.subjectId === f.subjectId)
    .filter(t => !f.topicId || t.id === f.topicId)
    .filter(t => !f.groupId || !t.groupId || t.groupId === f.groupId);
}

function assignmentsInScope(ctx, f, { groupId = f.groupId } = {}) {
  if (f.kind === "free") return []; // свободные прохождения — без заданий
  return ctx.assignments.filter(a => {
    if (groupId && a.groupId !== groupId) return false;
    if (f.subjectId && ctx.meta.get(a.testId)?.subjectId !== f.subjectId) return false;
    if (f.topicId && ctx.meta.get(a.testId)?.topicId !== f.topicId) return false;
    if ((f.kind === "exam" || f.kind === "training") && a.kind !== f.kind) return false;
    return true;
  });
}

// Полная модель страницы. data: { attempts, students, subjects, topics,
// assignments, orgId }. Возвращает нормализованные фильтры, опции и все
// разделы, посчитанные из ОДНОЙ выборки.
export function analyticsView(data, filters = {}, { nowMs = Date.now() } = {}) {
  const ctx = prepareData(data);
  const f = normalizeCtx(ctx, filters);
  const options = optionsCtx(ctx, f);
  const period = PERIODS.find(p => p.id === f.period) || PERIODS[0];
  const fromMs = period.days ? nowMs - period.days * DAY_MS : null;

  const common = {
    orgId: ctx.orgId, subjectId: f.subjectId || null, topicId: f.topicId || null,
    groupId: f.groupId || null, userId: f.userId || null, assignmentKinds: ctx.kinds
  };
  // Выборка для оценок/графиков/таблиц: все фильтры.
  const attempts = filterAttempts(ctx.attempts, { ...common, kind: f.kind || null, fromMs });
  // Выборка «состояния»: без периода и типа — для активности и выполнения
  // заданий (факт «задание сдано»/«ученик был активен» не зависит от того,
  // какой период смотрим).
  const stateAttempts = filterAttempts(ctx.attempts, common);

  const scopeStudents = f.userId
    ? options.students.filter(s => s.uid === f.userId)
    : options.students;
  const scopeTopics = topicsInScope(ctx, f);
  const graded = attempts.filter(isGraded);
  const finished = attempts.filter(isFinished);
  const finishedUsers = new Set(finished.map(a => a.userId));
  const count = status => attempts.filter(a => a.status === status).length;

  const overview = {
    studentsCount: scopeStudents.length,
    studentsWithAttempts: scopeStudents.filter(s => finishedUsers.has(s.uid)).length,
    topicsCount: scopeTopics.length,
    // «Попытки» — только завершённые (submitted/graded/expired); идущие —
    // отдельно, они не результат.
    attemptsCount: finished.length,
    gradedCount: graded.length,
    pendingCount: count("submitted"),
    expiredCount: count("expired"),
    inProgressCount: count("in_progress"),
    guestAttempts: finished.filter(a => a.guest === true).length,
    averageScore: averagePercent(graded.map(a => a.percent)),
    bestScore: graded.length ? Math.max(...graded.map(a => a.percent)) : null
  };

  const narrowing = Boolean(f.topicId || f.groupId || f.userId || f.kind || f.period !== "all");
  const disciplines = (f.subjectId ? ctx.subjects.filter(s => s.id === f.subjectId) : ctx.subjects)
    .map(subject => ({
      subject,
      data: disciplineAnalytics({
        attempts: attempts.filter(a => a.subjectId === subject.id),
        activityAttempts: stateAttempts.filter(a => a.subjectId === subject.id),
        topics: scopeTopics.filter(t => t.subjectId === subject.id),
        students: scopeStudents,
        nowMs
      })
    }))
    .filter(row => row.data.attemptsCount > 0 || (!narrowing && row.data.topicsCount > 0));

  // Рейтинг/таблица учеников — один расчёт для хаба группы и таблицы.
  const group = groupAnalytics({
    attempts, activityAttempts: stateAttempts,
    students: scopeStudents, topics: scopeTopics, nowMs
  });

  const byGroup = new Map();
  for (const a of graded) {
    const gid = a.groupId || "";
    if (!byGroup.has(gid)) byGroup.set(gid, []);
    byGroup.get(gid).push(a.percent);
  }
  const groupBars = [...byGroup.entries()]
    .map(([gid, scores]) => ({
      groupId: gid, label: gid || "Без группы", averageScore: averagePercent(scores), count: scores.length
    }))
    .sort((a, b) => b.averageScore - a.averageScore || byRu(a.label, b.label));

  // Задания: ученики и задания сужены теми же фильтрами; выполнение
  // считается по выборке «состояния» (без периода/типа).
  const assignmentList = assignmentsInScope(ctx, f);
  const completion = assignmentCompletion({
    assignments: assignmentList, attempts: stateAttempts, students: scopeStudents, nowMs
  });

  let student = null;
  if (f.userId && scopeStudents[0]) {
    const picked = scopeStudents[0];
    const own = assignmentCompletion({
      assignments: assignmentsInScope(ctx, f, { groupId: picked.groupId || "__none__" }),
      attempts: stateAttempts, students: [picked], nowMs
    });
    const detail = studentAnalytics({
      attempts,
      subjects: f.subjectId ? ctx.subjects.filter(s => s.id === f.subjectId) : ctx.subjects,
      topics: ctx.topics,
      assignments: [],
      nowMs
    });
    student = {
      uid: picked.uid,
      name: picked.fullName || picked.userName || picked.uid,
      averageScore: detail.averageScore,
      bestScore: detail.bestScore,
      testsCompleted: detail.testsCompleted,
      subjectsProgress: detail.subjectsProgress.filter(s => s.averageScore !== null),
      strongTopics: detail.strongTopics,
      weakTopics: detail.weakTopics,
      overdue: own.overdueRows.map(r => ({
        assignmentId: r.assignmentId, testTitle: r.testTitle, deadlineMs: r.deadlineMs
      })),
      assignments: { total: own.total, done: own.done, percent: own.percent }
    };
  }

  const topicTitle = id => ctx.topics.find(t => t.id === id)?.title || id;
  const byTopic = new Map();
  for (const a of graded) {
    if (!a.topicId) continue;
    if (!byTopic.has(a.topicId)) byTopic.set(a.topicId, []);
    byTopic.get(a.topicId).push(a.percent);
  }
  const weakTopics = [...byTopic.entries()]
    .map(([id, scores]) => ({ id, title: topicTitle(id), averageScore: averagePercent(scores), count: scores.length }))
    .sort((a, b) => a.averageScore - b.averageScore || byRu(a.title, b.title))
    .slice(0, 5);

  return {
    filters: f,
    options,
    attempts,
    isEmpty: attempts.length === 0,
    overview,
    dynamics: performanceDynamics(attempts, nowMs),
    distribution: gradeDistribution(graded.map(a => a.percent)),
    disciplines,
    groups: { bars: groupBars, selected: f.groupId ? { ...group, completion } : null },
    students: { rows: group.ranking, student },
    assignments: { ...completion, shown: assignmentList.length },
    weakTopics
  };
}
