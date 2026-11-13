// core/subjects.js — предметы и темы обучения в Firestore.
//
// Проверки входных данных — subjects-logic.js (чистые функции, тестируются
// в Node). Основная граница безопасности — firestore.rules: они дублируют
// те же ограничения и отклоняют некорректные записи независимо от клиента.
// Удаления нет: архивирование выполняется через update со status "archived".
import {
  collection, query, where, orderBy, getDocs,
  doc, setDoc, updateDoc, getDoc, serverTimestamp, writeBatch, db
} from "../shared/firebase.js";
import { State } from "./auth.js";
import {
  subjectReadAccessError, subjectWriteAccessError,
  validateSubjectData, validateTopicData,
  createReferenceCache
} from "./subjects-logic.js";

// Кэш справочников: страницы перечитывают предметы и темы при каждом
// входе. TTL 60 секунд + сброс при любой записи (create/update/move).
const refCache = createReferenceCache();

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
  const cacheKey = `subjects:${State.profile.orgId}`;
  const cached = refCache.get(cacheKey);
  if (cached) return cached;
  const snap = await getDocs(query(
    collection(db, "subjects"),
    where("orgId", "==", State.profile.orgId),
    orderBy("order", "asc")
  ));
  const subjects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  refCache.set(cacheKey, subjects);
  return subjects;
}

// Темы предмета, упорядоченные по order. Темы чужой организации правила
// не отдают, поэтому чужой subjectId возвращает пустой список.
export async function getTopics(subjectId) {
  const denied = subjectReadAccessError(State.user, State.profile);
  if (denied) throw new Error(denied);
  if (typeof subjectId !== "string" || !subjectId.trim()) {
    throw new Error("Укажите предмет (subjectId)");
  }
  const cacheKey = `topics:${State.profile.orgId}:${subjectId}`;
  const cached = refCache.get(cacheKey);
  if (cached) return cached;
  const snap = await getDocs(query(
    collection(db, "topics"),
    where("subjectId", "==", subjectId),
    where("orgId", "==", State.profile.orgId),
    orderBy("order", "asc")
  ));
  const topics = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  refCache.set(cacheKey, topics);
  return topics;
}

// Один предмет по id. null — предмета нет; чужая организация — понятная
// ошибка (правила всё равно не отдают документ, отказ переводится в текст).
export async function getSubject(id) {
  const denied = subjectReadAccessError(State.user, State.profile);
  if (denied) throw new Error(denied);
  if (typeof id !== "string" || !id.trim()) {
    throw new Error("Укажите предмет (id)");
  }
  let snap;
  try {
    snap = await getDoc(doc(db, "subjects", id));
  } catch (e) {
    throw accessError(e, "Нет доступа: предмет другой организации.");
  }
  if (!snap.exists()) return null;
  const data = snap.data();
  if (data.orgId !== State.profile.orgId) {
    throw new Error("Нет доступа: предмет другой организации.");
  }
  return { id: snap.id, ...data };
}

// Одна тема по id (для отдельной страницы темы).
export async function getTopic(id) {
  const denied = subjectReadAccessError(State.user, State.profile);
  if (denied) throw new Error(denied);
  if (typeof id !== "string" || !id.trim()) {
    throw new Error("Укажите тему (id)");
  }
  let snap;
  try {
    snap = await getDoc(doc(db, "topics", id));
  } catch (e) {
    throw accessError(e, "Нет доступа: тема другой организации.");
  }
  if (!snap.exists()) return null;
  const data = snap.data();
  if (data.orgId !== State.profile.orgId) {
    throw new Error("Нет доступа: тема другой организации.");
  }
  return { id: snap.id, ...data };
}

export async function createSubject(data = {}) {
  const denied = subjectWriteAccessError(State.user, State.profile);
  if (denied) throw new Error(denied);
  const check = validateSubjectData(data, true);
  if (!check.ok) throw new Error(check.error);

  // Понятный порядок: если вызывающий не передал order — ставим в конец
  // списка предметов организации (max + 1).
  if (data.order === undefined) {
    const snap = await getDocs(query(
      collection(db, "subjects"),
      where("orgId", "==", State.profile.orgId)
    ));
    check.value.order = snap.docs.reduce(
      (max, d) => Math.max(max, Number(d.data().order) || 0), 0
    ) + 1;
  }

  const ref = doc(collection(db, "subjects"));
  const subject = {
    ...check.value,
    orgId: State.profile.orgId,
    createdBy: State.user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(ref, subject);
  refCache.clear(); // новая запись — кэш списков больше не актуален
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
  refCache.clear();
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

  // Понятный порядок: тема без order ставится в конец списка тем предмета.
  if (data.order === undefined) {
    const siblings = await getDocs(query(
      collection(db, "topics"),
      where("subjectId", "==", check.value.subjectId),
      where("orgId", "==", State.profile.orgId)
    ));
    check.value.order = siblings.docs.reduce(
      (max, d) => Math.max(max, Number(d.data().order) || 0), 0
    ) + 1;
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
  refCache.clear();
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

// Смена порядка темы на одну позицию (delta = -1 выше, +1 ниже).
// Порядок реализован обменом значений order с соседней темой того же
// предмета; удалений и переносов между предметами нет. Архивные темы
// участвуют в списке: их порядок тоже сохраняется корректным.
export async function moveTopic(id, delta) {
  const denied = subjectWriteAccessError(State.user, State.profile);
  if (denied) throw new Error(denied);
  if (delta !== -1 && delta !== 1) {
    throw new Error("Смещение порядка: только -1 (выше) или 1 (ниже)");
  }

  const topic = await getTopic(id);
  if (!topic) throw new Error("Тема не найдена.");

  const siblings = await getTopics(topic.subjectId);
  const index = siblings.findIndex(t => t.id === id);
  if (index === -1) throw new Error("Тема не найдена в списке предмета.");
  const neighbor = siblings[index + delta];
  if (!neighbor) {
    throw new Error(delta < 0 ? "Тема уже первая." : "Тема уже последняя.");
  }

  // Порядок хранится как неотрицательное целое (проверяют и правила).
  // Обе записи идут одним батчем: одна сетевая операция вместо двух
  // последовательных updateDoc. Правила оценивают каждую запись батча
  // так же, как отдельный update — ограничений это не меняет.
  const own = Math.max(0, Number(topic.order) || 0);
  const other = Math.max(0, Number(neighbor.order) || 0);
  const batch = writeBatch(db);
  const stamp = serverTimestamp();
  if (own === other) {
    // Равные order (старые данные): обмен ничего бы не изменил, поэтому
    // соседу назначается новый порядок вручную.
    batch.set(doc(db, "topics", neighbor.id), { order: Math.max(0, own + delta), updatedAt: stamp }, { merge: true });
  } else {
    batch.set(doc(db, "topics", id), { order: other, updatedAt: stamp }, { merge: true });
    batch.set(doc(db, "topics", neighbor.id), { order: own, updatedAt: stamp }, { merge: true });
  }
  await batch.commit();
  refCache.clear();
  return { moved: id, neighbor: neighbor.id };
}
