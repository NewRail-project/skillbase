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
  normalizePlan, validatePlan, newRun, advance, skipStage, canAdvance, planOfRun, encodePlan
} from "./lesson-plan.js";
import { splitForStorage } from "./test-storage.js";
import { encodeRows, decodeRows, encodeTask, decodeTask } from "./practical.js";
import { emptyTest } from "./test-schema.js";

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
    plan: encodePlan(plan), updatedAt: serverTimestamp()
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
    // Те же параметры Battle, что на экране запуска Live: набор вопросов, число
    // вопросов и время. createRoom очищает значения; панель подготовки Battle в
    // комнате по-прежнему позволяет их изменить. Банки ничьих берутся из теста
    // комнаты (room.js: loadBattleSet) — они работают так же, как в обычной Live.
    battleSettings: p.stages.battle === true ? p.battle : null,
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

// ---------- вспомогательная функция прикрепления комнаты этапа ----------
async function attachStageRoom(entryCode, field, { test, profile, lesson }) {
  const entry = normalizeRoomCode(entryCode);
  const current = await readLessonRun(entry);
  if (!current) throw fail("Это не комната занятия.");
  if (current[field]) return current[field];
  const roomLesson = { ...lesson };
  if (!roomLesson.topic) roomLesson.topic = current.topic || "";
  const code = await createRoom({
    test, profile, allowObservers: true,
    lesson: { ...roomLesson, parentCode: entry }
  });
  try {
    const ref = roomRef(entry);
    const winner = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const run = snap.data()?.lesson;
      if (!run) throw fail("Это не комната занятия.");
      if (run[field]) return run[field]; // кто-то успел раньше
      tx.update(ref, { lesson: { ...run, [field]: code }, updatedAt: serverTimestamp() });
      return code;
    });
    if (winner !== code) { try { await deleteDoc(roomRef(code)); } catch { /* лишняя комната останется закрытой */ } }
    return winner;
  } catch (error) {
    try { await deleteDoc(roomRef(code)); } catch { /* ignore */ }
    throw error;
  }
}

// Итоговый тест: ведущий создаёт вторую Live-комнату и записывает её код во
// входную комнату — участники увидят ссылку. Защита от дубля: если код уже
// записан (двойной клик, вторая вкладка), новая комната удаляется.
export async function startFinalRoom({ entryCode, test, profile }) {
  return await attachStageRoom(entryCode, "finalRoomCode", {
    test, profile,
    lesson: { kind: "final" }
  });
}

// Материализация вопросов закрепления в опубликованный тест.
export const reinforcementTestDocId = (lessonId) => "reinforce__" + String(lessonId || "").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 120);

async function materializeReinforcementTest({ plan, lessonId, entry }) {
  const questions = plan.reinforcement?.questions || [];
  if (!questions.length) throw fail("В сценарии нет вопросов закрепления.", "validation");
  const testId = reinforcementTestDocId(lessonId || entry);
  const { publicTest, keys } = splitForStorage({ id: testId, title: plan.topic ? "Закрепление: " + plan.topic : "Закрепление материала", description: "Вопросы закрепления из сценария занятия. Редактируются в сценарии.", questions, settings: emptyTest().settings, mode: "self" });
  const uid = State?.user?.uid;
  if (!uid) throw fail("Нужно войти в аккаунт.");
  const testRef = doc(db, "tests", testId);
  const existing = await getDoc(testRef);
  if (!existing.exists()) {
    await setDoc(testRef, { ...publicTest, id: testId, authorId: uid, orgId: State?.profile?.orgId, status: "draft", version: 1, createdAt: serverTimestamp(), publishedAt: null, updatedAt: serverTimestamp() });
  }
  await updateDoc(testRef, { ...publicTest, status: "published", updatedAt: serverTimestamp() });
  // Ключи
  const keysRef = doc(db, "testKeys", testId);
  const keysSnap = await getDoc(keysRef);
  if (!keysSnap.exists()) {
    await setDoc(keysRef, { authorId: uid, orgId: State?.profile?.orgId, items: keys, version: 1, updatedAt: serverTimestamp() });
  } else {
    await setDoc(keysRef, { items: keys, updatedAt: serverTimestamp() }, { merge: true });
  }
  return { ...publicTest, id: testId, status: "published" };
}

// Новая публичная функция: создаёт комнату закрепления
export async function startReinforcementRoom({ entryCode, plan, lessonId, profile }) {
  const p = normalizePlan(plan);
  if (p.stages.reinforcement !== true) throw fail("В сценарии не включён этап «Закрепление материала».", "validation");
  const entry = normalizeRoomCode(entryCode);
  const test = await materializeReinforcementTest({ plan: p, lessonId, entry });
  return attachStageRoom(entryCode, "reinforcementRoomCode", {
    test, profile,
    lesson: { kind: "reinforcement", parentCode: entry, topic: p.topic || "" }
  });
}

// ---------- История занятий ----------

// Кодирование отчёта для Firestore: строки практики (practical.teams.{a,b}.rows)
// и, если есть, задачи (practical.tasks.{a,b}.rows) кодируются через encodeRows / encodeTask.
const encodeReport = (report) => {
  if (!report || typeof report !== "object") return report;
  const practical = report.practical ? {
    ...report.practical,
    ...(report.practical.teams ? {
      teams: {
        ...(report.practical.teams.a ? { a: { ...report.practical.teams.a, rows: encodeRows(report.practical.teams.a.rows) } } : {}),
        ...(report.practical.teams.b ? { b: { ...report.practical.teams.b, rows: encodeRows(report.practical.teams.b.rows) } } : {})
      }
    } : {}),
    ...(report.practical.tasks ? {
      tasks: {
        a: encodeTask(report.practical.tasks.a),
        b: encodeTask(report.practical.tasks.b)
      }
    } : {})
  } : null;

  return {
    ...report,
    ...(practical ? { practical } : {})
  };
};

// Декодирование отчёта из Firestore: строки практики и задачи декодируются через decodeRows/decodeTask.
const decodeReport = (report) => {
  if (!report || typeof report !== "object") return report;
  const practical = report.practical ? {
    ...report.practical,
    ...(report.practical.teams ? {
      teams: {
        ...(report.practical.teams.a ? { a: { ...report.practical.teams.a, rows: decodeRows(report.practical.teams.a.rows) } } : {}),
        ...(report.practical.teams.b ? { b: { ...report.practical.teams.b, rows: decodeRows(report.practical.teams.b.rows) } } : {})
      }
    } : {}),
    ...(report.practical.tasks ? {
      tasks: {
        a: decodeTask(report.practical.tasks.a),
        b: decodeTask(report.practical.tasks.b)
      }
    } : {})
  } : null;

  return {
    ...report,
    ...(practical ? { practical } : {})
  };
};

const histRef = (code) => doc(db, "lessonHistory", normalizeRoomCode(code));

export async function saveLessonHistory({ code, report, finalCode = "" }) {
  requireOnline("Нет подключения к интернету. Занятие не сохранено в историю.");
  const roomCode = normalizeRoomCode(code);
  const uid = State?.user?.uid;
  const existing = await getDoc(histRef(roomCode));
  if (existing.exists()) return { saved: false, reason: "exists" };
  const snapshot = JSON.parse(JSON.stringify(report)); // чистая копия без undefined
  const encodedSnapshot = encodeReport(snapshot);
  await setDoc(histRef(roomCode), {
    key: roomCode, code: roomCode, version: 1,
    orgId: State?.profile?.orgId, hostId: uid, hostName: report?.lesson?.hostName || "",
    topic: report?.lesson?.topic || "", subjectName: report?.lesson?.subjectName || "",
    createdAtMs: report?.lesson?.dateMs ?? null, finishedAtMs: Date.now(),
    finalCode, report: encodedSnapshot, savedAt: serverTimestamp()
  });
  return { saved: true };
}

export async function loadLessonHistory(code) {
  const snap = await getDoc(histRef(code));
  if (!snap.exists()) return null;
  const data = snap.data();
  if (data && data.report) {
    data.report = decodeReport(data.report);
  }
  return data;
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
