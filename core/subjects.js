// core/subjects.js — предметы и темы обучения в Firestore.
//
// Проверки входных данных — subjects-logic.js (чистые функции, тестируются
// в Node). Основная граница безопасности — firestore.rules: они дублируют
// те же ограничения и отклоняют некорректные записи независимо от клиента.
// Физическое удаление — deleteTopic/deleteSubject: каскад с отсоединением
// ссылок по плану (subjects-logic), попытки и оценки не затрагиваются.
import {
  collection, query, where, orderBy, getDocs,
  doc, setDoc, updateDoc, getDoc, serverTimestamp, writeBatch, db
} from "../shared/firebase.js";
import { State } from "./auth.js";
import {
  subjectReadAccessError, subjectWriteAccessError,
  validateSubjectData, validateTopicData,
  STUDENT_TOPIC_STATUSES, TOPIC_DATE_FIELDS,
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
//
// ЭТАП 4: правила дают студенту читать только опубликованные темы своей
// группы. Правила — не фильтры: если выборка содержит запрещённый документ,
// запрос падает целиком, поэтому запрос студента сам несёт те же
// ограничения (status in, groupId in) и опирается на составной индекс
// topics (firestore.indexes.json). У персонала — прежний запрос без
// ограничений: он видит черновики, архив и все группы.
export async function getTopics(subjectId) {
  const denied = subjectReadAccessError(State.user, State.profile);
  if (denied) throw new Error(denied);
  if (typeof subjectId !== "string" || !subjectId.trim()) {
    throw new Error("Укажите предмет (subjectId)");
  }
  const cacheKey = `topics:${State.profile.orgId}:${subjectId}`;
  const cached = refCache.get(cacheKey);
  if (cached) return cached;
  const base = [
    where("subjectId", "==", subjectId),
    where("orgId", "==", State.profile.orgId)
  ];
  let q;
  if (State.profile.role === "student") {
    // Группа «» = тема без ограничения по группе; своя группа — видна.
    // Старые темы без поля groupId запрос не находит: поле появится при
    // первом редактировании темы сотрудником (updateTopic проставляет "").
    const myGroup = typeof State.profile.groupId === "string" ? State.profile.groupId : "";
    const groups = [...new Set(["", myGroup])];
    q = query(collection(db, "topics"),
      ...base,
      where("status", "in", STUDENT_TOPIC_STATUSES),
      where("groupId", "in", groups),
      orderBy("order", "asc"));
  } else {
    q = query(collection(db, "topics"), ...base, orderBy("order", "asc"));
  }
  const snap = await getDocs(q);
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
  // Нормализация старых данных: при любом изменении темы поле groupId
  // получает явное значение («» = для всех групп). Это нужно и правилам
  // чтения для студентов, и запросу с groupId in (старые темы без поля
  // запрос не находил).
  if (!("groupId" in check.value) && snap.data().groupId === undefined) {
    await updateDoc(ref, { groupId: "", updatedAt: serverTimestamp() });
  }
  return { id, ...snap.data(), ...check.value };
}

// Копирование темы (этап 4). Безопасно: создаёт НОВЫЙ документ в той же
// организации; исходная тема не меняется, привязки материалов, тестов и
// история попыток остаются у оригинала. Копия создаётся черновиком
// («— копия»), даты и группа переносятся — их можно поправить в настройках.
// Перенос темы в другую дисциплину выполняется так же: копия в новую
// дисциплину + архивирование оригинала (subjectId менять запрещают
// правила, а удаления нет — история попыток сохраняется).
export async function copyTopic(id, { toSubjectId = null } = {}) {
  const denied = subjectWriteAccessError(State.user, State.profile);
  if (denied) throw new Error(denied);
  const source = await getTopic(id);
  if (!source) throw new Error("Тема не найдена.");

  const targetSubjectId = toSubjectId || source.subjectId;
  let subjectSnap;
  try {
    subjectSnap = await getDoc(doc(db, "subjects", targetSubjectId));
  } catch (e) {
    throw accessError(e, "Предмет не найден в вашей организации.");
  }
  if (!subjectSnap.exists() || subjectSnap.data().orgId !== State.profile.orgId) {
    throw new Error("Предмет не найден в вашей организации.");
  }

  const siblings = await getTopics(targetSubjectId);
  const order = siblings.reduce((max, t) => Math.max(max, Number(t.order) || 0), 0) + 1;

  const copy = {
    orgId: State.profile.orgId,
    subjectId: targetSubjectId,
    title: `${source.title} — копия`.slice(0, 120),
    description: source.description || "",
    order,
    status: "draft",
    groupId: typeof source.groupId === "string" ? source.groupId : "",
    createdBy: State.user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  for (const field of TOPIC_DATE_FIELDS) {
    if (source[field]) copy[field] = source[field];
  }
  const ref = doc(collection(db, "topics"));
  await setDoc(ref, copy);
  refCache.clear();
  return { id: ref.id, ...copy };
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

// ---------- Физическое удаление ----------

// Проверка владельца документа: читать чужой документ правила не дают,
// поэтому отказ с понятным текстом, как в updateSubject.
async function loadOwnDoc(col, id, what) {
  if (!id) throw new Error(`${what} не выбран${what === "Тема" ? "а" : ""}.`);
  let snap;
  try {
    snap = await getDoc(doc(db, col, id));
  } catch (e) {
    throw accessError(e, `Нет доступа: ${what.toLowerCase()} другой организации.`);
  }
  if (!snap.exists()) throw new Error(`${what} не найден${what === "Тема" ? "а" : ""}.`);
  if (snap.data().orgId !== State.profile?.orgId) {
    throw new Error(`Нет доступа: ${what.toLowerCase()} другой организации.`);
  }
  return snap;
}

// Отсоединение ссылок по плану: тесты (topicId → null) доступны автору
// или админу организации, материалы — только автору (правила материалов).
function detachLinks(batch, plan = {}) {
  const stamp = serverTimestamp();
  (plan.detachTestIds || []).forEach(id =>
    batch.update(doc(db, "tests", id), { topicId: null, updatedAt: stamp }));
  (plan.detachMaterialIds || []).forEach(id =>
    batch.update(doc(db, "materials", id), { topicId: null, updatedAt: stamp }));
}

/**
 * Физическое удаление темы: сам документ и отсоединение ссылок по плану.
 * Тесты, материалы, попытки и оценки не удаляются — только ссылки снимаются.
 */
export async function deleteTopic(id, plan = {}) {
  const denied = subjectWriteAccessError(State.user, State.profile);
  if (denied) throw new Error(denied);
  await loadOwnDoc("topics", id, "Тема");

  const batch = writeBatch(db);
  detachLinks(batch, plan);
  batch.delete(doc(db, "topics", id));
  await batch.commit();
  refCache.clear();
  return { deleted: id };
}

/**
 * Физическое удаление дисциплины: дисциплина и все её темы по плану,
 * ссылки тестов и материалов отсоединяются. Попытки и оценки сохраняются.
 */
export async function deleteSubject(id, plan = {}) {
  const denied = subjectWriteAccessError(State.user, State.profile);
  if (denied) throw new Error(denied);
  await loadOwnDoc("subjects", id, "Предмет");

  const batch = writeBatch(db);
  detachLinks(batch, plan);
  (plan.topicIds || []).forEach(topicId =>
    batch.delete(doc(db, "topics", topicId)));
  batch.delete(doc(db, "subjects", id));
  await batch.commit();
  refCache.clear();
  return { deleted: id, topics: (plan.topicIds || []).length };
}
