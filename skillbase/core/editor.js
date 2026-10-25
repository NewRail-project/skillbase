const { doc, collection, getDoc, setDoc, updateDoc, addDoc, serverTimestamp, deleteDoc, onSnapshot, runTransaction, writeBatch, limit, startAfter, Timestamp, increment, arrayUnion, arrayRemove, documentId } = require('../shared/firebase.js');
const { State } = require('./auth.js');
const { parseQuiz } = require('./import/parser.js');
const { emptyTest, validateTest } = require('./test-schema.js');

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

// Делит тест на публичную часть и ключи
module.exports.splitForStorage = function splitForStorage(test) {
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
      image: q.image,
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

// Возвращает правильные ответы в вопросы
module.exports.mergeKeys = function mergeKeys(publicTest, items) {
  const questions = (publicTest.questions || []).map((q, i) => {
    const k = items?.[String(i)];
    if (!k) return q;
    if (q.type === "short") return { ...q, answer: k.answer ?? "" };
    const set = new Set(k.correct || []);
    return {
      ...q,
      options: (q.options || []).map((o, j) => {
        const option = { ...o, correct: set.has(j) };
        return option;
      })
    };
  });
  return { ...publicTest, questions };
}

function currentOrgId() {
  return State?.profile?.orgId ?? State?.user?.orgId ?? "default-org";
}

// Сохраняет тест
module.exports.saveTest = async function saveTest(testId) {
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
      version: 1
    }, { merge: true });

    await setDoc(doc(db, "testKeys", id), {
      authorId: uid, orgId, items: keys, updatedAt: serverTimestamp(),
      version: 1
    });

    saveDraftLocally();
    return id;
  } catch (error) {
    console.error("Ошибка сохранения теста:", error);
    saveDraftLocally();
    throw error;
  }
}

module.exports.parseQuizText = function parseQuizText(quizText) {
  try {
    return parseQuiz(quizText);
  } catch (error) {
    console.error("Ошибка разбора теста:", error);
    throw new Error("Ошибка разбора теста. Пожалуйста, попробуйте снова.");
  }
}

module.exports.getCurrentTest = function getCurrentTest() {
  return JSON.parse(JSON.stringify(currentTest));
}

module.exports.updateTest = function updateTest(updates) {
  Object.assign(currentTest, updates);
  saveDraftLocally();
}

// Публикация теста
module.exports.publishTest = async function publishTest(testId) {
  try {
    if (!navigator.onLine) throw new Error("Нет подключения к интернету. Публикация невозможна.");
    const id = await saveTest(testId);
    const { publicTest } = splitForStorage(currentTest);

    const version = await addDoc(collection(db, "tests", id, "versions"), {
      ...publicTest, id, createdAt: serverTimestamp(), status: "published",
      version: currentTest.version + 1
    });
    await updateDoc(doc(db, "tests", id), {
      status: "published",
      publishedAt: serverTimestamp(),
      version: currentTest.version + 1
    });
    currentTest.status = "published";
    return version.id;
  } catch (error) {
    console.error("Ошибка публикации теста:", error);
    throw error;
  }
}

// Загрузка теста
module.exports.loadTest = async function loadTest(testId) {
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

// Ключи ответов теста
module.exports.getTestKeys = async function getTestKeys(testId) {
  try {
    const snap = await getDoc(doc(db, "testKeys", testId));
    return snap.exists() ? snap.data().items : null;
  } catch (_) {
    return null;
  }
}

module.exports.loadDraft = function loadDraft(testId) {
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

module.exports.effectiveDeadline = function effectiveDeadline(qStartMs, attemptDeadlineMs, timePerQuestionSec) {
  if (!attemptDeadlineMs) return qStartMs + (timePerQuestionSec || 5) * 1000;
  if (!timePerQuestionSec) return attemptDeadlineMs;
  
  const qDeadline = qStartMs + timePerQuestionSec * 1000;
  return Math.min(qDeadline, attemptDeadlineMs);
}

module.exports.validateTestDraft = function validateTestDraft(test) {
  const { errors, warnings } = validateTest(test, { publishing: false });
  return { errors, warnings };
}