// core/journal-logic.js — чистая логика записей журнала (без Firebase).
// Проверка входа и детерминированный id записи: повторная запись той же
// оценки того же источника не создаёт дубль.

import { pairGradeValue } from "./pair-grade.js";

export const JOURNAL_SOURCES = Object.freeze(["test", "live", "manual"]);

function safeId(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
}

// Чистая проверка входа (тестируется без Firebase).
export function validateJournalEntry(entry = {}) {
  const grade = Number(entry.grade);
  if (typeof entry.studentId !== "string" || !entry.studentId) return "Не указан ученик.";
  if (!Number.isFinite(grade) || grade < 0 || grade > 100) return "Оценка — число от 0 до 100.";
  if (!JOURNAL_SOURCES.includes(entry.source)) return "Неизвестный источник оценки.";
  return null;
}

// Детерминированный id записи: ученик + источник + идентификатор источника
// (попытка, комната). Без sourceId дублей не предотвратить — запись
// получает уникальный id.
export function journalEntryId({ studentId, source, sourceId } = {}) {
  if (!sourceId) return null;
  return `${safeId(studentId)}_${safeId(source)}_${safeId(sourceId)}`;
}

// ---------- Статусы и справочники ----------

// Посещаемость: present/absent/late/excused.
export const ATTENDANCE_STATUS = Object.freeze({
  PRESENT: "present",
  ABSENT: "absent",
  LATE: "late",
  EXCUSED: "excused"
});

// Источники оценки в журнале.
export const GRADE_SOURCE = Object.freeze({
  TEST: "test",
  LIVE_TEST: "live_test",
  CONTROL_WORK: "control_work",
  PRACTICAL: "practical",
  EXTRA: "extra",
  MANUAL: "manual"
});

// Попытка считается результатом только в submitted/graded.
export function isGradedStatus(status) {
  return status === "submitted" || status === "graded";
}

// Число вопросов попытки: явное поле questions, иначе — attempt.total
// (старые попытки хранят только баллы).
function questionsOf(a) {
  const q = Number(a?.questions);
  if (Number.isFinite(q) && q > 0) return q;
  return Number(a?.total) || 0;
}

// Оценка темы: та же формула, что и в Live-журнале (pair-grade):
// 90 × earned/max + 10 × answered/total, где earned/max — баллы,
// answered/total — доля отвеченных вопросов.
// Число вопросов берём из attempt.questions; в старых попытках его нет —
// тогда участием считаем долю относительно attempt.total (баллы), это
// занижает вклад активности, но не ломает знание.
function topicGrade(earned, max, answered, total) {
  return pairGradeValue({ earned, max, answered, total });
}

// ---------- Агрегация по темам ----------

// computeTopicTotals({ attempts, topicsMap }) → { perTopic, perStudent }
//   perTopic: Map<topicId, { earned, max, answered, total, count, testGrade, needsAgreement }>
//   perStudent: Map<uid, Map<topicId, { topicTitle, subjectId, earned, max, answered, total, totalGrade }>>
export function computeTopicTotals({ attempts = [], topicsMap = new Map() } = {}) {
  const perTopic = new Map();
  const perStudent = new Map();

  for (const a of attempts) {
    if (!isGradedStatus(a?.status)) continue;
    const uid = a?.userId || a?.uid;
    const tid = a?.topicId;
    if (!uid || !tid) continue;
    const topicMeta = topicsMap.get(tid) || {};
    const subjectId = a?.subjectId || topicMeta.subjectId || null;

    const score = Number(a.score) || 0;
    const total = Number(a.total) || 0;
    const answered = Number(a.answered) || 0;
    const questions = questionsOf(a);

    const topic = perTopic.get(tid) || {
      topicId: tid, topicTitle: topicMeta.title || null, subjectId,
      earned: 0, max: 0, answered: 0, total: 0, count: 0,
      testGrade: null, needsAgreement: false
    };
    topic.earned += score;
    topic.max += total;
    topic.answered += answered;
    topic.total += questions;
    topic.count += 1;
    perTopic.set(tid, topic);

    const student = perStudent.get(uid) || new Map();
    const st = student.get(tid) || {
      topicId: tid, topicTitle: topicMeta.title || null, subjectId,
      earned: 0, max: 0, answered: 0, total: 0, count: 0, totalGrade: null
    };
    st.earned += score;
    st.max += total;
    st.answered += answered;
    st.total += questions;
    st.count += 1;
    st.totalGrade = topicGrade(st.earned, st.max, st.answered, st.total);
    student.set(tid, st);
    perStudent.set(uid, student);
  }

  for (const topic of perTopic.values()) {
    topic.testGrade = topic.max > 0 ? topicGrade(topic.earned, topic.max, topic.answered, topic.total) : null;
    topic.needsAgreement = false; // consensus-логика не входит в MVP
  }

  return { perTopic, perStudent };
}

// ---------- Агрегация по дисциплинам ----------

// computeDisciplineTotals({ attempts, subjectsMap, topicsMap })
// → [{ subjectId, title, topics: Map<topicId, topicData>, overallGrade, topicCount }]
export function computeDisciplineTotals({ attempts = [], subjectsMap = new Map(), topicsMap = new Map() } = {}) {
  const bySubject = new Map();

  const ensure = (subjectId, title) => {
    if (!bySubject.has(subjectId)) {
      bySubject.set(subjectId, {
        subjectId, title: title || subjectsMap.get(subjectId)?.title || `Предмет ${subjectId}`,
        topics: new Map(), overallGrade: null, topicCount: 0
      });
    }
    return bySubject.get(subjectId);
  };

  const relevant = attempts.filter(a => isGradedStatus(a?.status) && a?.topicId);
  for (const a of relevant) {
    const tid = a.topicId;
    const topicMeta = topicsMap.get(tid);
    const subjectId = a.subjectId || topicMeta?.subjectId || null;
    if (!subjectId) continue;
    const discipline = ensure(subjectId, subjectsMap.get(subjectId)?.title);
    const topic = discipline.topics.get(tid) || {
      topicId: tid, topicTitle: topicMeta?.title || `Тема ${tid}`,
      earned: 0, max: 0, answered: 0, total: 0, count: 0,
      testGrade: null, totalGrade: null, needsAgreement: false
    };
    topic.earned += Number(a.score) || 0;
    topic.max += Number(a.total) || 0;
    topic.answered += Number(a.answered) || 0;
    topic.total += questionsOf(a);
    topic.count += 1;
    discipline.topics.set(tid, topic);
  }

  for (const discipline of bySubject.values()) {
    let sum = 0;
    let graded = 0;
    for (const topic of discipline.topics.values()) {
      topic.testGrade = topic.max > 0 ? topicGrade(topic.earned, topic.max, topic.answered, topic.total) : null;
      topic.totalGrade = topic.testGrade;
      if (topic.testGrade !== null) { sum += topic.testGrade; graded++; }
    }
    discipline.topicCount = discipline.topics.size;
    discipline.overallGrade = graded > 0 ? Math.round(sum / graded) : null;
  }

  return [...bySubject.values()];
}

// ---------- Формирование строк журнала ----------

// formatJournalRows(baseGrades, { overrides, attendanceMap })
// Применяет ручные правки (последняя побеждает) и посещаемость.
export function formatJournalRows(baseGrades = [], { overrides = new Map(), attendanceMap = new Map() } = {}) {
  return (Array.isArray(baseGrades) ? baseGrades : []).map(row => {
    const override = overrides instanceof Map ? overrides.get(row.uid) : null;
    const attendance = attendanceMap instanceof Map ? attendanceMap.get(row.uid) : null;
    return {
      ...row,
      grade: override ? override.to : row.grade,
      attendanceStatus: attendance?.status ?? null,
      attendanceDiscipline: attendance?.discipline ?? null,
      attendanceReason: attendance?.reason ?? null
    };
  });
}

// ---------- Динамика прогресса ----------

// computeStudentProgressDynamics({ attempts, subjectId })
// → [{ discipline, entries: [{ grade, gradedAt, testTitle }] }] по возрастанию даты.
export function computeStudentProgressDynamics({ attempts = [], subjectId = null } = {}) {
  const byDiscipline = new Map();
  for (const a of attempts) {
    if (!isGradedStatus(a?.status)) continue;
    if (subjectId && a.subjectId !== subjectId) continue;
    const discipline = a.subjectId;
    if (!discipline) continue;
    const gradedAt = a.gradedAt || a.submittedAt || a.startedAt || null;
    const entry = {
      grade: a.score ?? a.grade ?? 0,
      gradedAt,
      testTitle: a.testTitle || null
    };
    if (!byDiscipline.has(discipline)) byDiscipline.set(discipline, { discipline, entries: [] });
    byDiscipline.get(discipline).entries.push(entry);
  }
  const result = [...byDiscipline.values()];
  for (const group of result) {
    group.entries.sort((x, y) => dateOf(x.gradedAt) - dateOf(y.gradedAt));
  }
  return result.sort((a, b) => a.discipline.localeCompare(b.discipline));
}

function dateOf(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return 0;
}

// ---------- Проверка доступа к журналу ----------

// checkJournalAccess(user, profile, subjectId) → { ok, restricted?, error? }
//   админ/учитель (с teacherGroups) — полный доступ; студент — только свой журнал.
export function checkJournalAccess(user, profile, subjectId = null) {
  if (!user || !profile) return { ok: false, error: "Нет активной сессии." };
  const role = profile.role;
  if (role === "admin") return { ok: true, restricted: false };
  if (role === "teacher") {
    const groups = Array.isArray(profile.teacherGroups) ? profile.teacherGroups : null;
    if (!groups || subjectId === null) return { ok: true, restricted: false };
    return groups.includes(subjectId)
      ? { ok: true, restricted: false }
      : { ok: false, error: "Нет доступа к этой дисциплине." };
  }
  if (role === "student") return { ok: true, restricted: true };
  return { ok: false, error: "Недостаточно прав." };
}
