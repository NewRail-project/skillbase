// core/editor.js — создание, публикация и чтение тестов.
// ES-модуль: раньше файл был на CommonJS (require/module.exports) и не мог
// исполняться в браузере — страницы тестов падали на импорте.

import {
  auth, db, doc, collection, getDoc, getDocs, setDoc, updateDoc, addDoc,
  query, where, serverTimestamp, writeBatch
} from "../shared/firebase.js";
import { State, isStaff } from "./auth.js";
import { parseQuiz } from "./import/parser.js";
import { emptyTest, validateTest } from "./test-schema.js";
import { splitForStorage, mergeKeys, sanitizePublicTest, sameVersionSnapshot } from "./test-storage.js";
import {
  DELETED_STATUS, canDeleteTest, deletionPlan,
  sanitizedSettingsAfterDelete
} from "./test-delete-logic.js";

export { effectiveDeadline } from "./timing.js";
export { splitForStorage, mergeKeys, sanitizePublicTest, sameVersionSnapshot };

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

    // Документ версии получает id = номер версии: именно по такому пути его
    // читают attempts.js и getTestForReview (раньше addDoc давал случайный id,
    // и снимок невозможно было найти по номеру).
    const versionRef = doc(db, "tests", id, "versions", String(version));
    // Повторная публикация после сбоя: если версия уже записана, а tests не
    // обновлён, продолжаем — читаем версию, сравниваем содержимое
    // (sameVersionSnapshot без полей времени), обновляем тест.
    const payload = {
      ...publicTest, id,
      authorId: currentTest.authorId,
      orgId: currentTest.orgId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      publishedAt: serverTimestamp(),
      status: "published",
      version,
      items: keys
    };
    const existingVersion = await getDoc(versionRef).catch(err => {
      console.error("Не удалось прочитать версию:", err);
      return null;
    });
    if (existingVersion?.exists()) {
      if (!sameVersionSnapshot(existingVersion.data(), payload)) {
        throw new Error(
          `Версия ${version} уже опубликована с другим содержимым. ` +
          "Обновите тест через новую публикацию.");
      }
      // Содержимое то же — считаем публикацию завершённой по шагу версии.
    } else {
      await setDoc(versionRef, payload);
    }
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
  } catch (error) {
    console.error("[Skillbase] Не удалось прочитать testKeys:", error?.code || "unknown", error?.message || error);
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
      // Совместимость форматов: новые документы хранят карту items,
      // старые — массив keys ([{ type, answer }, ...]).
      if (keysSnap.exists()) keys = keysSnap.data().items ?? keysSnap.data().keys;
    } catch (error) {
      console.error("[Skillbase] Не удалось прочитать ключи версии:", error?.code || "unknown", error?.message || error);
      keys = null;
    }
  }

  if (!keys) {
    try {
      const keysSnap = await getDoc(doc(db, "testKeys", testId));
      if (keysSnap.exists()) {
        keys = keysSnap.data().items ?? keysSnap.data().keys;
      } else {
        console.warn("[Skillbase] Документ testKeys отсутствует для теста:", testId);
      }
    } catch (error) {
      console.error("[Skillbase] Не удалось прочитать testKeys при проверке:", error?.code || "unknown", error?.message || error);
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

// Преподаватель видит свои тесты, администратор — тесты своей организации.
// Удалённые (status "deleted") тесты не возвращает: мягкое удаление
// должно реально выводить тест из каталога и «Мои тесты».
export async function listMyTests(uid, orgId, role = "teacher") {
  if (!uid || !orgId) throw new Error("Не определены пользователь или организация.");

  const constraints = [where("orgId", "==", orgId)];

  if (role !== "admin") {
    constraints.push(where("authorId", "==", uid));
  }

  const snap = await getDocs(query(collection(db, "tests"), ...constraints));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(t => t.status !== "deleted")
    .sort(byUpdatedDesc);
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

// ---------- Удаление теста ----------

// Мягкое удаление теста автором или администратором организации.
//
// Что происходит (все шаги идемпотентны — повторное удаление безопасно):
//   1. tests/{id}: status → "deleted" (+deletedAt/deletedBy). Документ не
//      стирается: попытки студентов, история и аналитика остаются, а
//      правила запрещают дописывать что-либо в удалённый тест и
//      «воскрешать» его (см. firestore.rules /tests update).
//   2. Настройки теста закрывают доступ студента к ключам
//      (showCorrectAfterQuestion → false) — «правильные ответы через
//      старые ссылки» перестают читаться даже при активном маркере.
//   3. Активные задания этого теста закрываются (status → "closed"):
//      свои — для автора, все по организации — для администратора.
//      Задания других преподавателей остаются: правила не дают их
//      закрыть (перечисляются в результате).
//   4. Открытые Live-комнаты с этим тестом закрываются, если ведущий —
//      тот же пользователь. Комнаты чужих ведущих закрыть нельзя
//      (правила дают это только их ведущему) — они остаются для
//      ручного закрытия; продолжиться тест в них уже не может:
//      вопросы удалённого теста недоступны (status != published).
//   5. testKeys и снимки версий остаются: по ним работают проверка,
//      результаты и аналитика за прошлое. Жёсткое удаление документов
//      теста правилами запрещено (allow delete: if false).
export async function deleteTest(testId) {
  if (!navigator.onLine) {
    throw new Error("Нет подключения к интернету. Тест не удалён.");
  }
  const uid = auth.currentUser?.uid || State?.user?.uid;
  if (!uid) throw new Error("Нужно войти в аккаунт.");
  const session = { uid, role: State?.profile?.role, orgId: State?.profile?.orgId };

  // 1. Читаем тест: права и (для уже удалённого) пропускаем пометку.
  const snap = await getDoc(doc(db, "tests", testId));
  if (!snap.exists()) {
    throw new Error("Тест не найден. Возможно, он уже удалён — обновите каталог.");
  }
  const test = snap.data();
  const check = canDeleteTest(test, session);
  if (!check.allowed) throw new Error(check.reason);

  // 2. Пометка удаления — точка невозврата: если она не прошла,
  //    дальше ничего не делаем и статус не меняется.
  if (test.status !== DELETED_STATUS) {
    await updateDoc(doc(db, "tests", testId), {
      status: DELETED_STATUS,
      // Компромисс с доступом к ключам закрывается вместе с тестом.
      settings: sanitizedSettingsAfterDelete(test.settings),
      deletedAt: serverTimestamp(),
      deletedBy: uid,
      updatedAt: serverTimestamp()
    });
  }

  // 3–4. Очистка зависит от того, что видно этому пользователю:
  //      преподаватель читает свои задания, админ — задания организации.
  const isAdmin = session.role === "admin";
  const orgId = test.orgId || "";

  const assignmentQuery = isAdmin
    ? query(collection(db, "assignments"),
        where("testId", "==", testId), where("orgId", "==", orgId))
    : query(collection(db, "assignments"),
        where("testId", "==", testId), where("teacherId", "==", uid),
        where("orgId", "==", orgId));
  let assignments = [];
  try {
    const assignmentSnap = await getDocs(assignmentQuery);
    assignments = assignmentSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("[Skillbase] Задания теста не прочитаны:", err?.code || err);
  }

  let rooms = [];
  try {
    const roomsSnap = await getDocs(query(collection(db, "rooms"), where("testId", "==", testId)));
    rooms = roomsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("[Skillbase] Комнаты теста не прочитаны:", err?.code || err);
  }

  const plan = deletionPlan({ test, session, assignments, rooms });

  if (plan.closeAssignmentIds.length) {
    const batch = writeBatch(db);
    plan.closeAssignmentIds.forEach(id => {
      batch.update(doc(db, "assignments", id), {
        status: "closed",
        updatedAt: serverTimestamp()
      });
    });
    await batch.commit().catch(err => {
      console.error("[Skillbase] Задания не закрыты:", err?.code || err);
    });
  }

  await Promise.all(plan.closeRoomCodes.map(code =>
    updateDoc(doc(db, "rooms", code), {
      status: "closed",
      registrationOpen: false,
      liveState: "completed",
      closedAt: serverTimestamp(),
      closedBy: uid,
      updatedAt: serverTimestamp()
    }).catch(err => console.error("[Skillbase] Комната не закрыта:", code, err?.code || err))
  ));

  return {
    id: testId,
    ...plan,
    unaddressedAssignments: plan.foreignAssignmentIds,
    unaddressedRooms: plan.foreignRooms
  };
}

export async function setTestStatus(testId, status) {
  await updateDoc(doc(db, "tests", testId), {
    status,
    updatedAt: serverTimestamp()
  });
}
