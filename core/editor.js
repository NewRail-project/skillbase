// core/editor.js — создание, публикация и чтение тестов.
// ES-модуль: раньше файл был на CommonJS (require/module.exports) и не мог
// исполняться в браузере — страницы тестов падали на импорте.

import {
  auth, db, doc, collection, getDoc, getDocs, setDoc, updateDoc, addDoc,
  query, where, serverTimestamp
} from "../shared/firebase.js";
import { State, isStaff } from "./auth.js";
import { parseQuiz } from "./import/parser.js";
import { emptyTest, validateTest } from "./test-schema.js";
import { splitForStorage, mergeKeys, sanitizePublicTest } from "./test-storage.js";

export { effectiveDeadline } from "./timing.js";
export { splitForStorage, mergeKeys, sanitizePublicTest };

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

// Ошибка валидации для UI: code="validation" и полные списки errors/warnings.
function validationFailure({ errors, warnings }) {
  const error = new Error(errors[0] || "Тест не прошёл проверку");
  error.code = "validation";
  error.errors = errors;
  error.warnings = warnings;
  return error;
}

// Сохраняет тест: публичная часть — в tests, ответы — в testKeys.
export async function saveTest(testId) {
  try {
    if (!navigator.onLine) throw new Error("Нет подключения к интернету. Черновик сохранён локально.");
    const uid = auth.currentUser?.uid || State?.user?.uid;
    if (!uid) throw new Error("Нужно войти в аккаунт.");

    // Черновик проверяем тем же валидатором, что и публикацию, но без
    // требований, которые нужны только опубликованному тесту. Если тест уже
    // опубликован, сохраняем его по правилам публикации: иначе Firestore
    // отклонит, например, больше 200 вопросов уже после записи.
    const validation = validateTest(currentTest, {
      publishing: currentTest.status === "published"
    });
    if (validation.errors.length) {
      saveDraftLocally();
      throw validationFailure(validation);
    }

    const existingId = testId || currentTest.id;
    const id = existingId || doc(collection(db, "tests")).id;
    currentTest.id = id;

    const { publicTest, keys } = splitForStorage(currentTest);
    // Для существующего документа не перезаписываем createdAt/publishedAt:
    // после JSON-клонирования они могут стать обычными объектами, а правила
    // ожидают Timestamp. setDoc с merge сохранит исходные значения.
    if (existingId) {
      delete publicTest.createdAt;
      delete publicTest.publishedAt;
    } else {
      // Новый тест всегда создаётся черновиком; служебные поля не должны
      // приходить из локального черновика в виде простых объектов.
      publicTest.createdAt = serverTimestamp();
      publicTest.publishedAt = null;
    }
    // Автора и организацию берём из существующего документа, а для нового
    // теста — из текущей сессии. Так сохранение не переписывает чужие данные.
    const authorId = existingId && currentTest.authorId ? currentTest.authorId : uid;
    const orgId = existingId && currentTest.orgId ? currentTest.orgId : currentOrgId();
    const version = Number.isInteger(currentTest.version) && currentTest.version > 0
      ? currentTest.version
      : 1;

    await setDoc(doc(db, "tests", id), {
      ...publicTest, id, authorId, orgId, updatedAt: serverTimestamp(), version
    }, { merge: true });

    await setDoc(doc(db, "testKeys", id), {
      authorId, orgId, items: keys, updatedAt: serverTimestamp(), version
    });

    // Держим локальную копию в согласии с тем, что записали в Firestore:
    // иначе публикация возьмёт пустые authorId/orgId и старую версию.
    currentTest.authorId = authorId;
    currentTest.orgId = orgId;
    currentTest.version = version;

    saveDraftLocally();
    return id;
  } catch (error) {
    if (error?.code !== "validation") {
      console.error("Ошибка сохранения теста:", error);
    }
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

    // Полная проверка до записи: не публикуем тест, который нельзя пройти.
    const validation = validateTest(currentTest, { publishing: true });
    if (validation.errors.length) {
      saveDraftLocally();
      throw validationFailure(validation);
    }

    const id = await saveTest(testId);
    const { publicTest, keys } = splitForStorage(currentTest);
    const version = (Number.isInteger(currentTest.version) && currentTest.version > 0
      ? currentTest.version
      : 1) + 1;

    const versionRef = await addDoc(collection(db, "tests", id, "versions"), {
      ...publicTest, id,
      authorId: currentTest.authorId,
      orgId: currentTest.orgId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      publishedAt: serverTimestamp(),
      status: "published",
      version,
      items: keys
    });
    await updateDoc(doc(db, "tests", id), {
      status: "published",
      publishedAt: serverTimestamp(),
      version
    });
    currentTest.status = "published";
    currentTest.version = version;
    saveDraftLocally();
    return versionRef.id;
  } catch (error) {
    if (error?.code !== "validation") {
      console.error("Ошибка публикации теста:", error);
    }
    throw error;
  }
}

export async function loadTest(testId) {
  try {
    if (!navigator.onLine) {
      const local = readDraftLocally(testId);
      if (local) {
        // Локальный черновик мог быть сохранён сотрудником до смены роли.
        // Ученику ключи не отдаём даже из localStorage.
        currentTest = isStaff() ? local : sanitizePublicTest(local);
        return getCurrentTest();
      }
      const offline = new Error("Нет подключения к интернету. Данные недоступны.");
      offline.code = "unavailable";
      throw offline;
    }

    const snap = await getDoc(doc(db, "tests", testId));
    if (!snap.exists()) return null;
    // Публичная часть всегда очищается от возможных старых ключей. Для
    // сотрудника правильные ответы затем добавляются из testKeys.
    let test = sanitizePublicTest({ ...snap.data(), id: testId });

    // Ключи нужны только автору/администратору при редактировании.
    // Ученику незачем даже пытаться читать testKeys.
    if (isStaff()) {
      try {
        const keysSnap = await getDoc(doc(db, "testKeys", testId));
        if (keysSnap.exists()) test = mergeKeys(test, keysSnap.data().items);
      } catch (_) {
        // Нет прав на ключи (например, чужой тест): остаётся публичная часть.
      }
    }

    currentTest = { ...emptyTest(), ...test };
    return getCurrentTest();
  } catch (error) {
    console.error("Ошибка загрузки теста:", error);
    throw error;
  }
}

// Ключи ответов теста. Доступны только сотрудникам организации по правилам.
export async function getTestKeys(testId) {
  if (!isStaff()) return null;
  try {
    const snap = await getDoc(doc(db, "testKeys", testId));
    return snap.exists() ? snap.data().items : null;
  } catch (_) {
    return null;
  }
}

// Чтение теста и ключей для экрана проверки. Не трогает currentTest,
// чтобы преподаватель, открывший проверку, не потерял черновик редактора.
export async function getTestForReview(testId, version = null) {
  const snap = await getDoc(doc(db, "tests", testId));
  if (!snap.exists()) return null;

  const test = sanitizePublicTest({ ...snap.data(), id: testId });
  let keys = null;
  if (version) {
    try {
      const vSnap = await getDoc(doc(db, "tests", testId, "versions", String(version)));
      if (vSnap.exists() && vSnap.data().items) {
        keys = vSnap.data().items;
      }
    } catch (_) {
      keys = null;
    }
  }
  if (!keys) {
    try {
      const keysSnap = await getDoc(doc(db, "testKeys", testId));
      if (keysSnap.exists()) keys = keysSnap.data().items;
    } catch (_) {
      keys = null;
    }
  }

  return { test, keys };
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

export function validateTestForPublish(test) {
  const { errors, warnings } = validateTest(test, { publishing: true });
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
  return snap.docs
    .map(d => sanitizePublicTest({ ...d.data(), id: d.id }))
    .sort(byUpdatedDesc);
}

export async function setTestStatus(testId, status) {
  await updateDoc(doc(db, "tests", testId), {
    status,
    updatedAt: serverTimestamp()
  });
}
