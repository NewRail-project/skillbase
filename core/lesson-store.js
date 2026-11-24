// core/lesson-store.js — Firestore-слой занятия: план, ход, история.
//
// Где что лежит (новых коллекций для плана и хода нет):
//   · ПЛАН (с ключами практики) — testKeys/lesson__{id}: тот же закрытый
//     документ только для сотрудников организации, что и наборы Battle
//     (testKeys/{testId}__battle). Студент и гость его не читают: id документа
//     не совпадает с id теста, правило чтения для студента падает на get().
//   · ХОД занятия — поле `lesson` входной комнаты rooms/{код} (ведущий уже
//     вправе менять свой документ комнаты; участники его читают).
//   · ИСТОРИЯ — lessonHistory/{код входной комнаты}: неизменяемый снимок
//     отчёта (rules: только create; читают ведущий и админ организации).
// Переходы между этапами идут в транзакции с проверкой текущего этапа:
// двойной клик или две вкладки не продвинут занятие дважды.
import {
  db, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc, collection, query, where,
  runTransaction, serverTimestamp, onSnapshot
} from "../shared/firebase.js";
import { State, isStaff } from "./auth.js";
import { createRoom } from "./rooms.js";
import { normalizeRoomCode } from "./rooms-logic.js";
import {
  normalizePlan, validatePlan, newRun, advance, skipStage, canAdvance, planOfRun
} from "./lesson-plan.js";

export const planDocId = (id) => `lesson__${id}`;

function requireOnline(message) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error(message || "Нет подключения к интернету.");
}
function fail(message, code = "lesson") { const e = new Error(message); e.code = code; return e; }

// Понятный текст вместо кода Firebase.
export function lessonErrorText(error) {
  if (error?.code === "permission-denied") return "Нет прав на это действие. Проверьте, что вы вошли как преподаватель этой организации.";
  if (error?.code === "unavailable") return "Нет связи с сервером. Повторите, когда появится интернет.";
  return error?.message || "Не удалось выполнить действие.";
}

// ---------- План ----------

export async function listLessonPlans() {
  if (!isStaff()) return [];
  const orgId = State?.profile?.orgId;
  const uid = State?.user?.uid;
  if (!orgId || !uid) return [];
  const snap = await getDocs(query(collection(db, "testKeys"),
    where("kind", "==", "lessonPlan"), where("orgId", "==", orgId), where("authorId", "==", uid)));
  return snap.docs.map(d => ({ id: d.data().lessonId || d.id.replace(/^lesson__/, ""), plan: normalizePlan(d.data().plan), updatedAt: d.data().updatedAt || null }))
    .sort((a, b) => String(a.plan.topic).localeCompare(String(b.plan.topic), "ru"));
}

export async function loadLessonPlan(id) {
  if (!id || !isStaff()) return null;
  const snap = await getDoc(doc(db, "testKeys", planDocId(id)));
  return snap.exists() ? normalizePlan(snap.data().plan) : null;
}

export async function saveLessonPlan(id, rawPlan) {
  requireOnline("Нет подключения к интернету. План не сохранён.");
  const plan = normalizePlan(rawPlan);
  const errors = validatePlan(plan);
  if (errors.length) { const e = fail(errors[0], "validation"); e.errors = errors; throw e; }
  const uid = State?.user?.uid;
  if (!uid) throw fail("Нужно войти в аккаунт.");
  const lessonId = id || `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await setDoc(doc(db, "testKeys", planDocId(lessonId)), {
    kind: "lessonPlan", lessonId, orgId: State?.profile?.orgId, authorId: uid,
    plan, updatedAt: serverTimestamp()
  });
  return lessonId;
}

export async function deleteLessonPlan(id) {
  requireOnline();
  await deleteDoc(doc(db, "testKeys", planDocId(id)));
}

// ---------- Запуск занятия ----------

// Создаёт входную комнату с ходом занятия. test — опубликованный входной тест
// (его загружает страница существующим загрузчиком тестов).
export async function startLesson({ planId, plan, test, profile }) {
  const p = normalizePlan(plan);
  const errors = validatePlan(p);
  if (errors.length) { const e = fail(errors[0], "validation"); e.errors = errors; throw e; }
  const run = { ...newRun(p, { nowMs: Date.now() }), planId };
  const code = await createRoom({
    test, profile,
    allowObservers: true,
    battleEnabled: p.stages.battle === true,
    lesson: run
  });
  return code;
}

// ---------- Ход занятия ----------

// Лёгкая подписка на документ комнаты (без игроков и ответов): нужна панели
// занятия, чтобы знать состояние итоговой комнаты (liveState).
export function subscribeRoomState(code, onData, onError) {
  return onSnapshot(doc(db, "rooms", normalizeRoomCode(code)),
    (snap) => onData && onData(snap.exists() ? snap.data() : null),
    (error) => onError && onError(error));
}

const roomRef = (code) => doc(db, "rooms", normalizeRoomCode(code));

export async function readLessonRun(code) {
  const snap = await getDoc(roomRef(code));
  return snap.exists() ? (snap.data().lesson || null) : null;
}

// Один шаг вперёд. expectedStage — этап, который ведущий видел на экране:
// если за это время он изменился (двойной клик, вторая вкладка), шаг не делается.
async function transitionRun(code, expectedStage, compute) {
  requireOnline("Нет подключения к интернету. Переход не выполнен.");
  const ref = roomRef(code);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw fail("Комната не найдена.");
    const run = snap.data().lesson;
    if (!run) throw fail("Это не комната занятия.");
    if (run.stage !== expectedStage) throw fail("Этап уже изменился. Обновите экран.", "stale");
    const next = compute(run);
    tx.update(ref, { lesson: next, updatedAt: serverTimestamp() });
    return next;
  });
}

// ctx — факты ведущего (entryCompleted, battleFinished, practicalConfirmed, finalCompleted).
export const advanceLesson = (code, expectedStage, ctx = {}) =>
  transitionRun(code, expectedStage, (run) => advance(run, planOfRun(run), ctx, Date.now()));

export const skipLessonStage = (code, expectedStage, reason = "") =>
  transitionRun(code, expectedStage, (run) => skipStage(run, planOfRun(run), { nowMs: Date.now(), reason }));

export { canAdvance };

// Итоговый тест: ведущий создаёт вторую Live-комнату и записывает её код во
// входную комнату — участники увидят ссылку. Защита от дубля: если код уже
// записан (двойной клик, вторая вкладка), новая комната удаляется.
export async function startFinalRoom({ entryCode, test, profile }) {
  const entry = normalizeRoomCode(entryCode);
  const current = await readLessonRun(entry);
  if (!current) throw fail("Это не комната занятия.");
  if (current.finalRoomCode) return current.finalRoomCode;
  const code = await createRoom({
    test, profile, allowObservers: true,
    lesson: { kind: "final", parentCode: entry, topic: current.topic || "" }
  });
  try {
    const ref = roomRef(entry);
    const winner = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const run = snap.data()?.lesson;
      if (!run) throw fail("Это не комната занятия.");
      if (run.finalRoomCode) return run.finalRoomCode; // кто-то успел раньше
      tx.update(ref, { lesson: { ...run, finalRoomCode: code }, updatedAt: serverTimestamp() });
      return code;
    });
    if (winner !== code) { try { await deleteDoc(roomRef(code)); } catch { /* лишняя комната останется закрытой */ } }
    return winner;
  } catch (error) {
    try { await deleteDoc(roomRef(code)); } catch { /* ignore */ }
    throw error;
  }
}

// ---------- История занятий ----------

const histRef = (code) => doc(db, "lessonHistory", normalizeRoomCode(code));

export async function saveLessonHistory({ code, report, finalCode = "" }) {
  requireOnline("Нет подключения к интернету. Занятие не сохранено в историю.");
  const roomCode = normalizeRoomCode(code);
  const uid = State?.user?.uid;
  const existing = await getDoc(histRef(roomCode));
  if (existing.exists()) return { saved: false, reason: "exists" };
  const snapshot = JSON.parse(JSON.stringify(report)); // чистая копия без undefined
  await setDoc(histRef(roomCode), {
    key: roomCode, code: roomCode, version: 1,
    orgId: State?.profile?.orgId, hostId: uid, hostName: report?.lesson?.hostName || "",
    topic: report?.lesson?.topic || "", subjectName: report?.lesson?.subjectName || "",
    createdAtMs: report?.lesson?.dateMs ?? null, finishedAtMs: Date.now(),
    finalCode, report: snapshot, savedAt: serverTimestamp()
  });
  return { saved: true };
}

export async function loadLessonHistory(code) {
  const snap = await getDoc(histRef(code));
  return snap.exists() ? snap.data() : null;
}

export async function listLessonHistory() {
  if (!isStaff()) return [];
  const orgId = State?.profile?.orgId;
  const uid = State?.user?.uid;
  if (!orgId) return [];
  const base = collection(db, "lessonHistory");
  const q = State?.profile?.role === "admin"
    ? query(base, where("orgId", "==", orgId))
    : query(base, where("orgId", "==", orgId), where("hostId", "==", uid));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}

// Строка списка: безопасно для записей любой версии.
export function lessonHistoryRow(doc) {
  const r = doc?.report || {};
  return {
    code: doc?.code || "", topic: doc?.topic || r.lesson?.topic || "Занятие",
    subjectName: doc?.subjectName || "", dateMs: doc?.createdAtMs ?? doc?.finishedAtMs ?? null,
    participants: r.participants ?? 0,
    battle: r.summary?.battle?.available ? { winner: r.summary.battle.winner ?? null, tie: Boolean(r.summary.battle.tie) } : null,
    practical: r.summary?.practical?.available ? { winner: r.summary.practical.winner ?? null, tie: Boolean(r.summary.practical.tie) } : null,
    completion: r.completion?.percent ?? null
  };
}

export const sortLessonHistory = (rows) => [...rows].sort((a, b) => (b.dateMs ?? 0) - (a.dateMs ?? 0) || String(a.code).localeCompare(String(b.code)));
