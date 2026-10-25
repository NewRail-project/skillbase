// core/editor.js — создание, публикация и чтение тестов.
// ES-модуль: раньше файл был на CommonJS (require/module.exports) и не мог
// исполняться в браузере — страницы тестов падали на импорте.

import {
  auth, db, doc, collection, getDoc, getDocs, setDoc, updateDoc, addDoc,
  query, where, serverTimestamp
} from "../shared/firebase.js";
import { State } from "./auth.js";
import { parseQuiz } from "./import/parser.js";
import { emptyTest, validateTest } from "./test-schema.js";

export { effectiveDeadline } from "./timing.js";

const draftKey = (id) => {
  const uid = auth.currentUser?.uid || State?.user?.uid || "guest";
  return `sb:draft:${uid}:${id ?? "new"}`;
};

let currentTest = emptyTest();

function saveDraftLocally() {
  try { localStorage.setItem(draftKey(currentTest.id), JSON.stringify(currentTest)); } catch (_) {}
}

function readDraftLocally(id) {
  try {
    const raw = localStorage.getItem(draftKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function currentOrgId() {
  return State?.profile?.orgId ?? "default-org";
}

const byUpdatedDesc = (a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0);

// Делит тест на публичную часть и ключи.
export function splitForStorage(test) {
  const publicQuestions = [];
  const items = {};
  (test.questions || []).forEach((q, i) => {
    const type = q.type || "single";
    publicQuestions.push({
      type,
      text: q.text ?? "",
      options: type === "short" ? [] : (q.options || []).map((o) => ({ text: o.text ?? "" })),
      points: q.points || 1,
      required: q.required || false,
      image: q.image
    });
    if (type === "short") {
      items[String(i)] = { type, answer: String(q.answer ?? "") };
    } else {
      const correct = [];
      (q.options || []).forEach((o, j) => { if (o.correct) correct.push(j); });
      items[String(i)] = { type, correct };
    }
  });
  const { questions, ...rest } = test;
  return { publicTest: { ...rest, questions: publicQuestions }, keys: items };
}

// Возвращает правильные ответы в вопросы (для автора теста).
export function mergeKeys(publicTest, items) {
  const questions = (publicTest.questions || []).map((q, i) => {
    const k = items?.[String(i)];
    if (!k) return q;
    if (q.type === "short") return { ...q, answer: k.answer ?? "" };
    const set = new Set(k.correct || []);
    return {
      ...q,
      options: (q.options || []).map((o, j) => ({ ...o, correct: set.has(j) }))
    };
  });
  return { ...publicTest, questions };
}

// Сохраняет тест: публичная часть — в tests, ответы — в testKeys.
export async function saveTest(testId) {
  try {
    if (!navigator.onLine) throw new Error("Нет подключения к интернету. Черновик сохранён локально.");
    const uid = auth.currentUser?.uid || State?.user?.uid;
    if (!uid) throw new Error("Нужно войти в аккаунт.");

    const id = testId || currentTest.id || doc(collection(db, "tests")).id;
    currentTest.id = id;

    const { publicTest, keys } = splitForStorage(currentTest);
    const orgId = currentOrgId();

    await setDoc(doc(db, "tests", id), {
      ...publicTest, id, authorId: uid, orgId, updatedAt: serverTimestamp(), version: 1
    }, { merge: true });

    await setDoc(doc(db, "testKeys", id), {
      authorId: uid, orgId, items: keys, updatedAt: serverTimestamp(), version: 1
    });

    saveDraftLocally();
    return id;
  } catch (error) {
    console.error("Ошибка сохранения теста:", error);
    saveDraftLocally();
    throw error;
  }
}

export function parseQuizText(quizText) {
  try {
    return parseQuiz(quizText);
  } catch (error) {
    console.error("Ошибка разбора теста:", error);
    throw new Error("Ошибка разбора теста. Пожалуйста, попробуйте снова.");
  }
}

export function getCurrentTest() {
  return JSON.parse(JSON.stringify(currentTest));
}

export function updateTest(updates) {
  Object.assign(currentTest, updates);
  saveDraftLocally();
}

export function resetTest(test) {
  currentTest = { ...emptyTest(), ...(test || {}) };
  return getCurrentTest();
}

// Публикация теста.
export async function publishTest(testId) {
  try {
    if (!navigator.onLine) throw new Error("Нет подключения к интернету. Публикация невозможна.");
    const id = await saveTest(testId);
    const { publicTest } = splitForStorage(currentTest);

    const version = await addDoc(collection(db, "tests", id, "versions"), {
      ...publicTest, id, createdAt: serverTimestamp(), status: "published",
      version: (currentTest.version || 1) + 1
    });
    await updateDoc(doc(db, "tests", id), {
      status: "published",
      publishedAt: serverTimestamp(),
      version: (currentTest.version || 1) + 1
    });
    currentTest.status = "published";
    return version.id;
  } catch (error) {
    console.error("Ошибка публикации теста:", error);
    throw error;
  }
}

export async function loadTest(testId) {
  try {
    if (!navigator.onLine) {
      const local = readDraftLocally(testId);
      if (local) { currentTest = local; return getCurrentTest(); }
      throw new Error("Нет подключения к интернету. Данные недоступны.");
    }

    const snap = await getDoc(doc(db, "tests", testId));
    if (!snap.exists()) return null;
    let test = { ...snap.data(), id: testId };

    try {
      const keysSnap = await getDoc(doc(db, "testKeys", testId));
      if (keysSnap.exists()) test = mergeKeys(test, keysSnap.data().items);
    } catch (_) {
      // Нет прав на ключи (не автор): остаётся публичная часть.
    }

    currentTest = { ...emptyTest(), ...test };
    return getCurrentTest();
  } catch (error) {
    console.error("Ошибка загрузки теста:", error);
    throw error;
  }
}

// Ключи ответов теста. Доступны только автору/администратору по правилам.
export async function getTestKeys(testId) {
  try {
    const snap = await getDoc(doc(db, "testKeys", testId));
    return snap.exists() ? snap.data().items : null;
  } catch (_) {
    return null;
  }
}

export function loadDraft(testId) {
  try {
    const local = readDraftLocally(testId);
    if (local) {
      currentTest = local;
      return local;
    }
    return null;
  } catch (error) {
    console.error("Ошибка загрузки черновика:", error);
    return null;
  }
}

export function validateTestDraft(test) {
  const { errors, warnings } = validateTest(test, { publishing: false });
  return { errors, warnings };
}

// ---------- Списки тестов ----------

// Тесты, созданные преподавателем.
export async function listMyTests(uid) {
  const snap = await getDocs(query(collection(db, "tests"), where("authorId", "==", uid)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(byUpdatedDesc);
}

// Опубликованные тесты организации (для студентов).
// Запрос требует составного индекса orgId + status — см. firestore.indexes.json.
export async function listPublishedTests(orgId) {
  const snap = await getDocs(query(
    collection(db, "tests"),
    where("orgId", "==", orgId),
    where("status", "==", "published")
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(byUpdatedDesc);
}

export async function setTestStatus(testId, status) {
  await updateDoc(doc(db, "tests", testId), {
    status,
    updatedAt: serverTimestamp()
  });
}
