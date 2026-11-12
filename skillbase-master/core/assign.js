import {
  db, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, serverTimestamp, orderBy, Timestamp
} from "../shared/firebase.js";
import { validateAssignmentDraft } from "./assignment-logic.js";

function toDeadline(value) {
  if (!value) return null;
  if (value instanceof Timestamp) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Некорректный срок выполнения.");
  return Timestamp.fromDate(date);
}

function toStartDate(value) {
  if (!value) return null;
  if (value instanceof Timestamp) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Некорректная дата открытия.");
  return Timestamp.fromDate(date);
}

// Назначение опубликованного теста группе:
// kind "exam" (проверка) или "training" (обучение со сроком и материалом).
export async function assignTest({
  test, teacherId, groupId, deadline = null, attemptsLimit = null,
  kind = "exam", note = "", materialText = "", materialUrl = "", startAt = null
}) {
  if (!test?.id) throw new Error("Тест не выбран.");
  if (!teacherId) throw new Error("Нужно войти в аккаунт.");

  const group = String(groupId || "").trim();
  if (group.length < 1 || group.length > 100) {
    throw new Error("Укажите группу (от 1 до 100 символов).");
  }

  const testSnap = await getDoc(doc(db, "tests", test.id));
  if (!testSnap.exists()) throw new Error("Тест не найден.");
  const testData = testSnap.data();
  if (testData.status !== "published") {
    throw new Error("Назначать можно только опубликованный тест.");
  }

  let limit = attemptsLimit == null || attemptsLimit === ""
    ? null
    : Number(attemptsLimit);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 50)) {
    throw new Error("Количество попыток должно быть целым числом от 1 до 50.");
  }
  // allowRetake=false → ровно одна попытка, что бы ни было в поле.
  if (testData.settings?.allowRetake === false) limit = 1;

  // Чистая валидация задания (kind/заметка/материалы/срок training).
  const check = validateAssignmentDraft({ kind, deadline, note, materialText, materialUrl });
  if (!check.ok) {
    const error = new Error(Object.values(check.errors)[0]);
    error.fields = check.errors;
    throw error;
  }

  const deadlineValue = toDeadline(deadline);
  if (deadlineValue && deadlineValue.toMillis() <= Date.now()) {
    throw new Error("Срок выполнения должен быть в будущем.");
  }
  const startAtValue = toStartDate(startAt);

  const ref = await addDoc(collection(db, "assignments"), {
    testId: test.id,
    testTitle: testData.title || "",
    teacherId,
    groupId: group,
    orgId: testData.orgId || "",
    kind: check.values.kind,
    note: check.values.note || "",
    materialText: check.values.materialText || "",
    materialUrl: check.values.materialUrl || "",
    deadline: deadlineValue,
    attemptsLimit: limit,
    startAt: startAtValue,
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return ref.id;
}

export async function getAssignment(assignmentId) {
  if (!assignmentId) return null;
  const snap = await getDoc(doc(db, "assignments", assignmentId));
  return snap.exists() ? { id: assignmentId, ...snap.data() } : null;
}

// Получение заданий для ученика (по его группе и организации).
export async function getStudentAssignments(groupId, orgId) {
  if (!groupId || !orgId) return [];
  const q = query(
    collection(db, "assignments"),
    where("groupId", "==", groupId),
    where("status", "==", "active"),
    where("orgId", "==", orgId)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
}

// Получение результатов теста для преподавателя с учетом ограничения по группам.
export async function getTeacherResults(testId, teacherGroups = null) {
  const q = query(
    collection(db, "attempts"),
    where("testId", "==", testId)
  );
  const snapshot = await getDocs(q);
  let attempts = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));

  if (teacherGroups && Array.isArray(teacherGroups)) {
    attempts = attempts.filter(a => teacherGroups.includes(a.groupId));
  }
  return attempts.sort((a, b) => (b.finishedAt?.seconds || 0) - (a.finishedAt?.seconds || 0));
}

export async function closeAssignment(assignmentId) {
  await updateDoc(doc(db, "assignments", assignmentId), {
    status: "closed",
    updatedAt: serverTimestamp()
  });
}

export async function removeAssignment(assignmentId) {
  await deleteDoc(doc(db, "assignments", assignmentId));
}
