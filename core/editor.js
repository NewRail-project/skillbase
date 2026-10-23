// core/editor.js — состояние и сохранение теста (Firestore modular SDK)
import { db, auth } from "../shared/firebase.js";
import { State } from "./auth.js";
import { parseQuiz } from "./import/parser.js";
import {
  doc, collection, getDoc, setDoc, updateDoc, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const emptyTest = () => ({
  id: null,
  title: "",
  questions: [],          // в памяти хранятся вместе с правильными ответами
  timePerQuestion: 10,
  attempts: 3,
  shuffleOptions: true,
  shuffleQuestions: true,
  status: "draft",
});

let currentTest = emptyTest();

const draftKey = (id) => `test_${id ?? "draft"}`;

function saveDraftLocally() {
  try { localStorage.setItem(draftKey(currentTest.id), JSON.stringify(currentTest)); } catch (_) {}
}

function readDraftLocally(id) {
  try {
    const raw = localStorage.getItem(draftKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

// Делит тест на публичную часть (без ответов) и ключи (только ответы).
export function splitForStorage(test) {
  const publicQuestions = [];
  const items = {};
  (test.questions || []).forEach((q, i) => {
    const type = q.type || "single";
    publicQuestions.push({
      type,
      text: q.text ?? "",
      options: type === "short" ? [] : (q.options || []).map((o) => ({ text: o.text ?? "" })),
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

// Возвращает правильные ответы в вопросы (для автора).
export function mergeKeys(publicTest, items) {
  const questions = (publicTest.questions || []).map((q, i) => {
    const k = items?.[String(i)];
    if (!k) return q;
    if (q.type === "short") return { ...q, answer: k.answer ?? "" };
    const set = new Set(k.correct || []);
    return { ...q, options: (q.options || []).map((o, j) => ({ ...o, correct: set.has(j) })) };
  });
  return { ...publicTest, questions };
}

function currentOrgId() {
  return State?.profile?.orgId ?? State?.user?.orgId ?? "default-org";
}

// Сохраняет тест: публичная часть в tests/{id}, ответы в testKeys/{id}.
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
      ...publicTest, id, authorId: uid, orgId, updatedAt: serverTimestamp(),
    }, { merge: true });

    await setDoc(doc(db, "testKeys", id), {
      authorId: uid, orgId, items: keys, updatedAt: serverTimestamp(),
    });

    saveDraftLocally();
    return id;
  } catch (error) {
    console.error("Ошибка сохранения теста:", error);
    saveDraftLocally();
    throw error;
  }
}

export async function parseQuizText(quizText) {
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

// Публикация: снимок публичной части в tests/{id}/versions, статус published.
export async function publishTest(testId) {
  try {
    if (!navigator.onLine) throw new Error("Нет подключения к интернету. Публикация невозможна.");
    const id = await saveTest(testId);
    const { publicTest } = splitForStorage(currentTest);

    const version = await addDoc(collection(db, "tests", id, "versions"), {
      ...publicTest, id, createdAt: serverTimestamp(), status: "published",
    });
    await updateDoc(doc(db, "tests", id), { status: "published", publishedAt: serverTimestamp() });
    currentTest.status = "published";
    return version.id;
  } catch (error) {
    console.error("Ошибка публикации теста:", error);
    throw error;
  }
}

// Загрузка: автор получает и ключи, остальные только публичную часть.
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
      // нет прав на ключи (не автор): остаётся публичная часть
    }

    currentTest = { ...emptyTest(), ...test };
    return getCurrentTest();
  } catch (error) {
    console.error("Ошибка загрузки теста:", error);
    throw error;
  }
}

// Ключи ответов теста (только для автора; остальным вернётся null)
export async function getTestKeys(testId) {
  try {
    const snap = await getDoc(doc(db, "testKeys", testId));
    return snap.exists() ? snap.data().items : null;
  } catch (_) {
    return null;
  }
}
