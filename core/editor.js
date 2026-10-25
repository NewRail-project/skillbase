import { db, collection, doc, getDoc, getDocs, updateDoc, query, where, serverTimestamp, writeBatch } from "../shared/firebase.js";
import { parseQuiz } from "./import/parser.js";

export function parseQuizText(text) {
  return parseQuiz(text);
}

// Публичная часть теста НЕ содержит правильных ответов (правило AGENTS.md №4).
// Ответы уходят в отдельную коллекцию testKeys, доступную только преподавателям.
function splitTest(parsed) {
  const questions = [];
  const keys = [];
  for (const q of parsed.questions) {
    questions.push({ type: q.type, text: q.text, options: q.options.map(o => ({ text: o.text })) });
    if (q.type === "short") keys.push({ type: "short", answer: String(q.answer || "") });
    else if (q.type === "multiple") keys.push({ type: "multiple", answer: q.options.flatMap((o, i) => o.correct ? [i] : []) });
    else keys.push({ type: "single", answer: q.options.findIndex(o => o.correct) });
  }
  return { questions, keys };
}

export async function createTest({ title, parsed, timePerQuestion, status }, user, profile) {
  if (!navigator.onLine) throw new Error("Нет подключения к интернету.");
  const { questions, keys } = splitTest(parsed);
  const testRef = doc(collection(db, "tests"));
  const base = { authorId: user.uid, orgId: profile.orgId };

  const batch = writeBatch(db);
  batch.set(testRef, { ...base, title, questions, timePerQuestion, status, createdAt: serverTimestamp() });
  batch.set(doc(db, "testKeys", testRef.id), { ...base, keys });
  await batch.commit();
  return testRef.id;
}

export async function loadTest(testId) {
  const snap = await getDoc(doc(db, "tests", testId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

const byDateDesc = (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);

export async function listMyTests(uid) {
  const snap = await getDocs(query(collection(db, "tests"), where("authorId", "==", uid)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(byDateDesc);
}

export async function listPublishedTests(orgId) {
  const snap = await getDocs(query(collection(db, "tests"), where("orgId", "==", orgId), where("status", "==", "published")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(byDateDesc);
}

export function setTestStatus(testId, status) {
  return updateDoc(doc(db, "tests", testId), { status });
}
