// core/subjects.js — предметы и темы обучения в Firestore.
//
// Проверки входных данных — subjects-logic.js (чистые функции, тестируются
// в Node). Основная граница безопасности — firestore.rules: они дублируют
// те же ограничения и отклоняют некорректные записи независимо от клиента.
// Удаления нет: архивирование выполняется через update со status "archived".
import {
  collection, query, where, orderBy, getDocs,
  doc, setDoc, updateDoc, getDoc, serverTimestamp, db
} from "../shared/firebase.js";
import { State } from "./auth.js";
import {
  subjectReadAccessError, subjectWriteAccessError,
  validateSubjectData, validateTopicData
} from "./subjects-logic.js";

// Чтение существующего документа чужой организации правила запрещают
// (permission-denied). Переводим отказ в понятную ошибку, не скрывая
// причину: прочие ошибки пробрасываются как есть.
function accessError(e, message) {
  if (e?.code === "permission-denied") return new Error(message);
  return e;
}

// Предметы организации, упорядоченные по order.
export async function getSubjects() {
  const denied = subjectReadAccessError(State.user, State.profile);
  if (denied) throw new Error(denied);
  const snap = await getDocs(query(
    collection(db, "subjects"),
    where("orgId", "==", State.profile.orgId),
    orderBy("order", "asc")
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Темы предмета, упорядоченные по order. Темы чужой организации правила
// не отдают, поэтому чужой subjectId возвращает пустой список.
export async function getTopics(subjectId) {
  const denied = subjectReadAccessError(State.user, State.profile);
  if (denied) throw new Error(denied);
  if (typeof subjectId !== "string" || !subjectId.trim()) {
    throw new Error("Укажите предмет (subjectId)");
  }
  const snap = await getDocs(query(
    collection(db, "topics"),
    where("subjectId", "==", subjectId),
    where("orgId", "==", State.profile.orgId),
    orderBy("order", "asc")
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function createSubject(data = {}) {
  const denied = subjectWriteAccessError(State.user, State.profile);
  if (denied) throw new Error(denied);
  const check = validateSubjectData(data, true);
  if (!check.ok) throw new Error(check.error);

  const ref = doc(collection(db, "subjects"));
  const subject = {
    ...check.value,
    orgId: State.profile.orgId,
    createdBy: State.user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(ref, subject);
  return { id: ref.id, ...subject };
}

export async function updateSubject(id, patch = {}) {
  const denied = subjectWriteAccessError(State.user, State.profile);
  if (denied) throw new Error(denied);
  const check = validateSubjectData(patch, false);
  if (!check.ok) throw new Error(check.error);

  const ref = doc(db, "subjects", id);
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (e) {
    throw accessError(e, "Нет доступа: предмет другой организации.");
  }
  if (!snap.exists()) throw new Error("Предмет не найден.");
  if (snap.data().orgId !== State.profile.orgId) {
    throw new Error("Нет доступа: предмет другой организации.");
  }
  await updateDoc(ref, { ...check.value, updatedAt: serverTimestamp() });
  return { id, ...snap.data(), ...check.value };
}

export async function createTopic(data = {}) {
  const denied = subjectWriteAccessError(State.user, State.profile);
  if (denied) throw new Error(denied);
  const check = validateTopicData(data, true);
  if (!check.ok) throw new Error(check.error);

  // Предмет обязан существовать в организации автора (дублирует правила —
  // отказ до записи даёт понятную ошибку вместо permission-denied).
  let subjectSnap;
  try {
    subjectSnap = await getDoc(doc(db, "subjects", check.value.subjectId));
  } catch (e) {
    throw accessError(e, "Предмет не найден в вашей организации.");
  }
  if (!subjectSnap.exists() || subjectSnap.data().orgId !== State.profile.orgId) {
    throw new Error("Предмет не найден в вашей организации.");
  }

  const ref = doc(collection(db, "topics"));
  const topic = {
    ...check.value,
    orgId: State.profile.orgId,
    createdBy: State.user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(ref, topic);
  return { id: ref.id, ...topic };
}

export async function updateTopic(id, patch = {}) {
  const denied = subjectWriteAccessError(State.user, State.profile);
  if (denied) throw new Error(denied);
  const check = validateTopicData(patch, false);
  if (!check.ok) throw new Error(check.error);

  const ref = doc(db, "topics", id);
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (e) {
    throw accessError(e, "Нет доступа: тема другой организации.");
  }
  if (!snap.exists()) throw new Error("Тема не найдена.");
  if (snap.data().orgId !== State.profile.orgId) {
    throw new Error("Нет доступа: тема другой организации.");
  }
  await updateDoc(ref, { ...check.value, updatedAt: serverTimestamp() });
  return { id, ...snap.data(), ...check.value };
}
