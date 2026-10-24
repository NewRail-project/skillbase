import { db, collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where, serverTimestamp } from "../shared/firebase.js";

const bySubmittedDesc = (a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0);

export async function submitAttempt({ test, answers, startedAt }, user, profile) {
  if (!navigator.onLine) throw new Error("Нет подключения к интернету. Ответы не отправлены.");
  const ref = await addDoc(collection(db, "attempts"), {
    userId: user.uid,
    userEmail: user.email,
    orgId: profile.orgId,
    testId: test.id,
    testTitle: test.title,
    answers,
    startedAt,
    submittedAt: serverTimestamp(),
    status: "submitted"
  });
  return ref.id;
}

export async function listMyAttempts(uid) {
  const snap = await getDocs(query(collection(db, "attempts"), where("userId", "==", uid)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(bySubmittedDesc);
}

export async function listOrgAttempts(orgId) {
  const snap = await getDocs(query(collection(db, "attempts"), where("orgId", "==", orgId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(bySubmittedDesc);
}

const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");

export function isCorrect(key, ans) {
  if (!key || ans === undefined || ans === null) return false;
  if (key.type === "short") return norm(ans) === norm(key.answer);
  if (key.type === "multiple") {
    const a = [...(Array.isArray(ans) ? ans : [])].sort().join(",");
    return a === [...key.answer].sort().join(",");
  }
  return ans === key.answer;
}

// Проверка делается на стороне преподавателя: только он имеет доступ к testKeys
export async function gradeAttempt(attempt, graderUid, keysCache = {}) {
  if (!keysCache[attempt.testId]) {
    const snap = await getDoc(doc(db, "testKeys", attempt.testId));
    if (!snap.exists()) throw new Error("Ключи теста не найдены.");
    keysCache[attempt.testId] = snap.data().keys || [];
  }
  const keys = keysCache[attempt.testId];
  const score = keys.reduce((n, k, i) => n + (isCorrect(k, attempt.answers?.[i]) ? 1 : 0), 0);
  await updateDoc(doc(db, "attempts", attempt.id), {
    status: "graded", score, total: keys.length, gradedAt: serverTimestamp(), gradedBy: graderUid
  });
  return { score, total: keys.length };
}
