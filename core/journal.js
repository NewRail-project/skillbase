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
import { JOURNAL_SOURCES, validateJournalEntry, journalEntryId } from "./journal-logic.js";

export { JOURNAL_SOURCES, validateJournalEntry, journalEntryId };

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
