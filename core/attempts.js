import {
  db, collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where,
  serverTimestamp, Timestamp
} from "../shared/firebase.js";
import { isCorrect, normalizeKeys, scoreAttempt } from "./scoring.js";

export { isCorrect };

const byTimeDesc = (a, b) => {
  const left = a.submittedAt?.seconds || a.startedAt?.seconds || 0;
  const right = b.submittedAt?.seconds || b.startedAt?.seconds || 0;
  return right - left;
};

// Firestore не принимает undefined и вложенные объекты с мусором.
// Оставляем только те значения, которые понимает scoreAttempt.
export function sanitizeAnswers(answers) {
  if (!answers || typeof answers !== "object") return {};
  const clean = {};

  Object.keys(answers).forEach(index => {
    if (!/^\d+$/.test(index)) return;
    const value = answers[index];

    if (Array.isArray(value)) {
      clean[index] = value.filter(item => Number.isInteger(item) && item >= 0);
    } else if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
      clean[index] = value;
    } else if (typeof value === "string") {
      clean[index] = value.slice(0, 4000);
    }
  });

  return clean;
}

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

  const ref = await addDoc(collection(db, "attempts"), {
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
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return ref.id;
}

export async function saveAttemptAnswers(attemptId, answers) {
  requireOnline("Нет подключения к интернету. Ответы сохранены в браузере.");
  if (!attemptId) throw new Error("Попытка не найдена.");

  await updateDoc(doc(db, "attempts", attemptId), {
    answers: sanitizeAnswers(answers),
    updatedAt: serverTimestamp()
  });
}

export async function submitAttemptById(attemptId, answers) {
  requireOnline("Нет подключения к интернету. Ответы не отправлены.");
  if (!attemptId) throw new Error("Попытка не найдена.");

  await updateDoc(doc(db, "attempts", attemptId), {
    answers: sanitizeAnswers(answers),
    status: "submitted",
    submittedAt: serverTimestamp(),
    finishedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
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

export async function listOrgAttempts(orgId) {
  const snap = await getDocs(query(collection(db, "attempts"), where("orgId", "==", orgId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(byTimeDesc);
}

function hasPoints(key) {
  const points = key?.points;
  return typeof points === "number" && Number.isFinite(points) && points > 0;
}

// Ключи теста доступны только преподавателю/администратору (правила Firestore).
// Баллы берём из ключей; для старых ключей без points — из публичных вопросов.
async function loadKeys(testId, cache) {
  if (cache[testId]) return cache[testId];

  const snap = await getDoc(doc(db, "testKeys", testId));
  if (!snap.exists()) throw new Error("Ключи теста не найдены.");

  const keys = normalizeKeys(snap.data().items ?? snap.data().keys);

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
    } catch (_) {
      // Если публичную часть прочитать не удалось, scoreAttempt посчитает
      // такой вопрос как 1 балл (совместимость со старыми ключами).
    }
  }

  cache[testId] = keys;
  return keys;
}

export async function getAttemptKeys(testId) {
  return loadKeys(testId, {});
}

// Проверка делается на стороне преподавателя: только у него есть доступ к testKeys.
export async function gradeAttempt(attempt, graderUid, keysCache = {}, decisions = null) {
  if (!attempt?.id) throw new Error("Попытка не найдена.");
  if (!graderUid) throw new Error("Не указан проверяющий.");

  const keys = await loadKeys(attempt.testId, keysCache);
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
