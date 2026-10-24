import {
  db, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, serverTimestamp, orderBy, Timestamp
} from "../shared/firebase.js";

function toDeadline(value) {
  if (!value) return null;
  if (value instanceof Timestamp) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Некорректный срок выполнения.");
  return Timestamp.fromDate(date);
}

// Назначение опубликованного теста группе.
export async function assignTest({ test, teacherId, groupId, deadline = null, attemptsLimit = null }) {
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

  const limit = attemptsLimit == null || attemptsLimit === ""
    ? null
    : Number(attemptsLimit);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 50)) {
    throw new Error("Количество попыток должно быть целым числом от 1 до 50.");
  }

  const deadlineValue = toDeadline(deadline);
  if (deadlineValue && deadlineValue.toMillis() <= Date.now()) {
    throw new Error("Срок выполнения должен быть в будущем.");
  }

  const ref = await addDoc(collection(db, "assignments"), {
    testId: test.id,
    testTitle: testData.title || "",
    teacherId,
    groupId: group,
    orgId: testData.orgId || "",
    deadline: deadlineValue,
    attemptsLimit: limit,
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

// Получение результатов теста для преподавателя.
export async function getTeacherResults(testId) {
  const q = query(
    collection(db, "attempts"),
    where("testId", "==", testId),
    orderBy("finishedAt", "desc")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
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
