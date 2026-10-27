import {
  db, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, query, where,
  serverTimestamp, Timestamp, writeBatch
} from "../shared/firebase.js";
import { isCorrect, normalizeKeys, sanitizeAnswers, scoreAttempt } from "./scoring.js";
import { State } from "./auth.js";

export { isCorrect, sanitizeAnswers };

const byTimeDesc = (a, b) => {
  const left = a.submittedAt?.seconds || a.startedAt?.seconds || 0;
  const right = b.submittedAt?.seconds || b.startedAt?.seconds || 0;
  return right - left;
};

function cleanDecisions(decisions) {
  if (!decisions || typeof decisions !== "object") return {};
  const clean = {};
  Object.keys(decisions).forEach(index => {
    if (/^\d+$/.test(index) && typeof decisions[index] === "boolean") {
      clean[index] = decisions[index];
    }
  });
  return clean;
}

function requireOnline(message) {
  if (!navigator.onLine) throw new Error(message || "Нет подключения к интернету.");
}

// Начало попытки. Документ создаётся со статусом in_progress; ученик
// не может записать в него оценку — это разрешено только сотруднику.
export async function startAttempt({ test, user, profile, assignmentId = "", attemptNo = 1, deadlineAt = null }) {
  requireOnline("Нет подключения к интернету. Попытка не начата.");
  if (!user?.uid) throw new Error("Нужно войти в аккаунт.");
  if (!profile?.orgId) throw new Error("Профиль организации не загружен.");
  if (!test?.id) throw new Error("Тест не выбран.");

  const deadline = deadlineAt
    ? (deadlineAt instanceof Date ? Timestamp.fromDate(deadlineAt) : deadlineAt)
    : null;

  // Снимок ФИО и группы на момент попытки. Имя в users можно изменить,
  // поэтому журнал не должен зависеть только от текущего профиля.
  // Поля необязательные: старые профили могли быть созданы без ФИО/группы.
  const snapshot = {};
  const fullName = String(profile.fullName || "").trim();
  if (fullName) snapshot.userName = fullName;
  const groupId = String(profile.groupId || "").trim();
  if (groupId) snapshot.groupId = groupId;

  const version = Number.isInteger(test.version) && test.version >= 1 ? test.version : 1;
  const authorId = test.authorId || "";

  const payload = {
    userId: user.uid,
    userEmail: user.email || "",
    orgId: profile.orgId,
    testId: test.id,
    testTitle: test.title || "",
    assignmentId: assignmentId || "",
    answers: {},
    startedAt: serverTimestamp(),
    status: "in_progress",
    attemptNo: Number.isInteger(attemptNo) && attemptNo > 0 ? attemptNo : 1,
    deadlineAt: deadline,
    testVersion: version,
    ...snapshot,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  if (authorId) payload.testAuthorId = authorId;

  // Маркер «идёт попытка»: в одном batch пишем попытку и маркер
  // activeAttempts/{uid}. По нему правила закрывают учебный материал
  // (materials/**) на время прохождения.
  const batch = writeBatch(db);
  const attemptRef = doc(collection(db, "attempts"));
  batch.set(attemptRef, payload);
  batch.set(doc(db, "activeAttempts", user.uid), {
    uid: user.uid,
    attemptId: attemptRef.id,
    testId: test.id,
    deadlineAt: deadline,
    startedAt: serverTimestamp()
  });
  await batch.commit();

  return attemptRef.id;
}

export async function saveAttemptAnswers(attemptId, answers) {
  requireOnline("Нет подключения к интернету. Ответы сохранены в браузере.");
  if (!attemptId) throw new Error("Попытка не найдена.");

  await updateDoc(doc(db, "attempts", attemptId), {
    answers: sanitizeAnswers(answers),
    updatedAt: serverTimestamp()
  });
}

export async function submitAttemptById(attemptId, answers, { expired = false } = {}) {
  requireOnline("Нет подключения к интернету. Ответы не отправлены.");
  if (!attemptId) throw new Error("Попытка не найдена.");

  // Отправка и снятие маркера активной попытки — в одном batch:
  // материал открывается ровно в момент завершения попытки.
  const batch = writeBatch(db);
  batch.update(doc(db, "attempts", attemptId), {
    answers: sanitizeAnswers(answers),
    status: expired ? "expired" : "submitted",
    submittedAt: serverTimestamp(),
    finishedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  batch.delete(doc(db, "activeAttempts", State.user?.uid || ""));
  await batch.commit();
}

export async function getAttempt(attemptId) {
  const snap = await getDoc(doc(db, "attempts", attemptId));
  return snap.exists() ? { id: attemptId, ...snap.data() } : null;
}

export async function listMyAttempts(uid) {
  const snap = await getDocs(query(collection(db, "attempts"), where("userId", "==", uid)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(byTimeDesc);
}

export async function listMyAttemptsForTest(uid, testId) {
  const snap = await getDocs(query(
    collection(db, "attempts"),
    where("userId", "==", uid),
    where("testId", "==", testId)
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(byTimeDesc);
}

export async function listOrgAttempts(orgId, { groupIdFilter = null } = {}) {
  const queryRef = query(collection(db, "attempts"), where("orgId", "==", orgId));
  const snap = await getDocs(queryRef);
  let attempts = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(byTimeDesc);

  if (groupIdFilter) {
    if (Array.isArray(groupIdFilter)) {
      attempts = attempts.filter(a => groupIdFilter.includes(a.groupId));
    } else if (typeof groupIdFilter === "string") {
      attempts = attempts.filter(a => a.groupId === groupIdFilter);
    }
  }

  return attempts;
}

function hasPoints(key) {
  const points = key?.points;
  return typeof points === "number" && Number.isFinite(points) && points > 0;
}

// Ключи теста доступны только преподавателю/администратору (правила Firestore).
// Если попытка сохранила testVersion, пытаемся сначала загрузить снимок из
// tests/{testId}/versions/{version}. Иначе используем текущие ключи из testKeys.
async function loadKeys(testId, version = null, cache = {}) {
  const cacheKey = version ? `${testId}:v${version}` : testId;
  if (cache[cacheKey]) return cache[cacheKey];

  let keys = null;

  if (version) {
    try {
      const vSnap = await getDoc(doc(db, "tests", testId, "versions", String(version)));
      if (vSnap.exists() && vSnap.data().items) {
        keys = normalizeKeys(vSnap.data().items);
      }
    } catch (_) {
      // Игнорируем ошибку чтения версии — попробуем загрузить основные ключи.
    }
  }

  if (!keys) {
    const snap = await getDoc(doc(db, "testKeys", testId));
    if (!snap.exists()) throw new Error("Ключи теста не найдены.");
    keys = normalizeKeys(snap.data().items ?? snap.data().keys);
  }

  if (keys.some(key => !hasPoints(key))) {
    try {
      const testSnap = await getDoc(doc(db, "tests", testId));
      const questions = testSnap.exists() && Array.isArray(testSnap.data().questions)
        ? testSnap.data().questions
        : [];
      keys.forEach((key, index) => {
        if (key && !hasPoints(key) && hasPoints(questions[index])) {
          key.points = questions[index].points;
        }
      });
    } catch (_) {}
  }

  cache[cacheKey] = keys;
  return keys;
}

export async function getAttemptKeys(testId) {
  return loadKeys(testId, null, {});
}

// Проверка делается на стороне преподавателя: только у него есть доступ к testKeys.
export async function gradeAttempt(attempt, graderUid, keysCache = {}, decisions = null) {
  if (!attempt?.id) throw new Error("Попытка не найдена.");
  if (!graderUid) throw new Error("Не указан проверяющий.");

  const keys = await loadKeys(attempt.testId, attempt.testVersion || null, keysCache);
  const review = cleanDecisions(decisions);
  const { score, total, percent } = scoreAttempt(keys, attempt.answers || {}, { decisions: review });

  await updateDoc(doc(db, "attempts", attempt.id), {
    status: "graded",
    score,
    total,
    percent,
    review,
    finishedAt: serverTimestamp(),
    gradedAt: serverTimestamp(),
    gradedBy: graderUid,
    updatedAt: serverTimestamp()
  });

  return { score, total, percent };
}

// Устаревшая прямая отправка (совместимость). Создаёт попытку и сразу
// отправляет её; новый код использует startAttempt + submitAttemptById.
export async function submitAttempt({ test, answers }, user, profile) {
  const attemptId = await startAttempt({ test, user, profile });
  await submitAttemptById(attemptId, answers);
  return attemptId;
}
