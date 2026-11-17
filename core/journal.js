// core/journal.js — запись оценок в журнал (journalEntries) и история правок.
//
// Правила Firestore допускают только создание записей (update/delete
// запрещены): история изменений оценок сохраняется сама — каждая запись
// неизменна. Дубли исключены детерминированным id: повторная запись той
// же оценки того же источника не создаёт вторую строку.
// Отдельной страницы журнала нет: журнал пары строится по итогам Live
// (core/pair-grade.js), а попытки обычных тестов попадают сюда автоматически.
import {
  collection, query, where, getDocs, getDoc, doc, setDoc, serverTimestamp, db
} from "../shared/firebase.js";
import { State } from "./auth.js";
import {
  JOURNAL_SOURCES, validateJournalEntry, journalEntryId,
  computeTopicTotals, computeDisciplineTotals
} from "./journal-logic.js";
import { pairGradeValue } from "./pair-grade.js";

export {
  JOURNAL_SOURCES, validateJournalEntry, journalEntryId,
  computeTopicTotals, computeDisciplineTotals
};
export { pairGradeValue };

export async function saveJournalEntry({ studentId, subjectId = null, topicId = null, grade, source = "test", sourceId = null, reason = "" } = {}) {
  const problem = validateJournalEntry({ studentId, grade, source });
  if (problem) throw new Error(problem);
  const profile = State.profile;
  if (!profile?.orgId) throw new Error("Профиль организации не загружен.");
  const data = {
    studentId, orgId: profile.orgId,
    subjectId: subjectId || null, topicId: topicId || null,
    grade: Math.round(Number(grade)), source,
    sourceId: sourceId || null,
    reason: String(reason || "").slice(0, 300),
    authorUid: State.user?.uid || null,
    createdAt: serverTimestamp()
  };
  const id = journalEntryId({ studentId, source, sourceId });
  if (!id) {
    const ref = doc(collection(db, "journalEntries"));
    await setDoc(ref, data);
    return { id: ref.id, created: true };
  }
  const ref = doc(db, "journalEntries", id);
  const existing = await getDoc(ref).catch(() => null);
  if (existing?.exists()) return { id, created: false };
  await setDoc(ref, data);
  return { id, created: true };
}

// Записи журнала: ученик видит свои, персонал — организации.
export async function listJournalEntries({ studentId = null } = {}) {
  const profile = State.profile;
  const constraints = studentId
    ? [where("studentId", "==", studentId)]
    : [where("orgId", "==", profile?.orgId || "")];
  const snap = await getDocs(query(collection(db, "journalEntries"), ...constraints));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

// Ручная правка оценки преподавателем: отдельная неизменяемая запись
// (кто, когда, было → стало, причина). Проверка — buildGradeOverride.
export async function saveGradeOverride(override, { subjectId = null, topicId = null } = {}) {
  const profile = State.profile;
  if (!profile?.orgId) throw new Error("Профиль организации не загружен.");
  const ref = doc(collection(db, "gradeOverrides"));
  await setDoc(ref, {
    studentId: override.uid, orgId: profile.orgId,
    subjectId, topicId,
    from: override.from ?? null, to: override.to,
    reason: override.reason, authorUid: override.authorUid,
    createdAt: serverTimestamp()
  });
  return { id: ref.id };
}

// Отметка посещаемости (present/absent/late/excused): только создание,
// история сохраняется сама — записи неизменяемы (см. rules attendance).
export async function saveAttendance({ studentId, disciplineId = null, status = "present", reason = null } = {}) {
  const profile = State.profile;
  if (!profile?.orgId) throw new Error("Профиль организации не загружен.");
  if (typeof studentId !== "string" || !studentId) throw new Error("Не указан ученик.");
  const ref = doc(collection(db, "attendance"));
  await setDoc(ref, {
    studentId, orgId: profile.orgId,
    disciplineId: disciplineId || null,
    status: String(status),
    reason: reason ? String(reason).slice(0, 300) : null,
    authorUid: State.user?.uid || null,
    createdAt: serverTimestamp()
  });
  return { id: ref.id };
}

// ---------- Расчёт данных журнала ----------

// computeJournalData({ attempts, subjectsMap, topicsMap }) — агрегирует
// попытки по темам, дисциплинам и ученикам для страницы журнала.
export async function computeJournalData({ attempts = [], subjectsMap = new Map(), topicsMap = new Map() } = {}) {
  const { perTopic, perStudent } = computeTopicTotals({ attempts, topicsMap });
  const disciplines = computeDisciplineTotals({ attempts, subjectsMap, topicsMap });
  let needsAgreement = false;
  for (const topic of perTopic.values()) {
    if (topic.needsAgreement) { needsAgreement = true; break; }
  }
  return { perTopic, perStudent, disciplines, needsAgreement };
}

// generateJournalUiRows(journalData, { view }) — плоские строки таблицы
// для выбранного вида журнала.
export function generateJournalUiRows(journalData, { view = "disciplines" } = {}) {
  const { perTopic, perStudent, disciplines } = journalData || {};
  const rows = [];
  if (view === "topics") {
    for (const [tid, topicData] of perTopic || new Map()) {
      rows.push({ topicId: tid, topicTitle: topicData.topicTitle, grade: topicData.testGrade });
    }
  } else if (view === "students") {
    for (const [uid, topicMap] of perStudent || new Map()) {
      const grades = [...topicMap.values()].filter(t => typeof t.totalGrade === "number");
      rows.push({ uid, grade: grades.length ? Math.round(grades.reduce((s, t) => s + t.totalGrade, 0) / grades.length) : null });
    }
  } else {
    for (const discipline of disciplines || []) {
      for (const [tid, topicData] of discipline.topics) {
        rows.push({ uid: null, discipline: discipline.title, topicId: tid, topicTitle: topicData.topicTitle, grade: topicData.totalGrade });
      }
    }
  }
  return rows;
}

// verifyOperation(operation) — клиентская проверка прав перед ручными
// действиями (правка оценки, посещаемость). Граница — правила Firestore.
export function verifyOperation(operation) {
  const profile = State.profile;
  const user = State.user;
  if (!user) return { ok: false, error: "Нет активной сессии." };
  if (!profile?.orgId) return { ok: false, error: "Профиль организации не загружен." };
  if (!["admin", "teacher"].includes(profile.role)) {
    return { ok: false, error: "Недостаточно прав." };
  }
  return { ok: true };
}
