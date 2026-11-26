// core/practical-store.js — Firestore-слой практической диагностики.
//
// Документы (внутри комнаты rooms/{код}):
//   practicalTasks/{a|b}        ПУБЛИЧНОЕ задание команды БЕЗ ключей (читает своя команда и ведущий);
//   practicalSubmissions/{a|b}  ответы команды (пишет капитан, после отправки заморожены);
//   battleKeys/practical_{a|b}  КЛЮЧИ — только ведущий (существующее правило battleKeys);
//   battleRounds/practical_review  решения преподавателя по спорным ячейкам (черновик, только ведущий).
// Ключи в клиенты участников не попадают: функции чтения ключей вызываются
// только со страницы ведущего, а правила не пускают к ним никого другого.
import {
  db, doc, getDoc, setDoc, updateDoc, onSnapshot, writeBatch, serverTimestamp
} from "../shared/firebase.js";
import { State } from "./auth.js";
import { normalizeRoomCode } from "./rooms-logic.js";
import {
  TEAMS, TASK_STATUS, SUBMISSION, splitTask, sanitizeCells, sanitizeEntry, evaluateSubmission, compareTeams
} from "./practical.js";

function requireOnline(message) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error(message || "Нет подключения к интернету.");
}
const codeOf = (code) => {
  const c = normalizeRoomCode(code);
  if (!c) throw new Error("Некорректный код комнаты.");
  return c;
};
const checkTeam = (team) => { if (!TEAMS.includes(team)) throw new Error("Неизвестная команда."); return team; };

const taskRef = (code, team) => doc(db, "rooms", codeOf(code), "practicalTasks", checkTeam(team));
const subRef = (code, team) => doc(db, "rooms", codeOf(code), "practicalSubmissions", checkTeam(team));
const keyRef = (code, team) => doc(db, "rooms", codeOf(code), "battleKeys", `practical_${checkTeam(team)}`);
const reviewRef = (code) => doc(db, "rooms", codeOf(code), "battleRounds", "practical_review");
const resultRef = (code) => doc(db, "rooms", codeOf(code), "battleRounds", "practical_result");
const entryRef = (code) => doc(db, "rooms", codeOf(code), "battleRounds", "practical_entry");

const subscribeDoc = (ref, onData, onError) => onSnapshot(
  ref, (s) => onData && onData(s.exists() ? s.data() : null), (e) => onError && onError(e));

// ---------- Ведущий: подготовка ----------

// Создаёт задания и ключи ИЗ ПЛАНА одним батчем. Идемпотентно: если задание
// команды уже есть (обновили страницу, нажали дважды), оно не перезаписывается —
// ответы и статусы не теряются.
export async function setupPractical(code, plan) {
  requireOnline("Нет подключения к интернету. Задания не подготовлены.");
  const existing = await Promise.all(TEAMS.map(t => getDoc(taskRef(code, t))));
  const batch = writeBatch(db);
  let created = 0;
  TEAMS.forEach((team, i) => {
    if (existing[i].exists()) return;
    const { publicTask, keys } = splitTask(plan?.tasks?.[team]);
    batch.set(taskRef(code, team), {
      team, ...publicTask, status: TASK_STATUS.DRAFT, updatedAt: serverTimestamp()
    });
    batch.set(keyRef(code, team), { kind: "practical", team, cells: keys, updatedAt: serverTimestamp() });
    created += 1;
  });
  if (created) await batch.commit();
  return { created };
}

export async function setTaskStatus(code, team, status) {
  requireOnline();
  if (![TASK_STATUS.OPEN, TASK_STATUS.CLOSED].includes(status)) throw new Error("Недопустимый статус задания.");
  await updateDoc(taskRef(code, team), { status, updatedAt: serverTimestamp() });
}

export const loadKeys = async (code, team) => {
  const s = await getDoc(keyRef(code, team));
  return s.exists() ? (s.data().cells || {}) : {};
};

// Ведущий возвращает таблицу на доработку (до подтверждения результата).
export async function returnForRevision(code, team) {
  requireOnline();
  await updateDoc(subRef(code, team), { status: SUBMISSION.DRAFT, updatedAt: serverTimestamp() });
}

// ---------- Ведущий: проверка ----------

// Ввод ведущим на доске (см. core/practical.js, «Ввод ведущим»). Документ
// закрыт для всех, кроме ведущего (battleRounds), студенты его не читают.
export async function loadEntry(code) {
  const s = await getDoc(entryRef(code));
  return s.exists() ? s.data() : null;
}

export async function saveEntry(code, tasks, entry) {
  requireOnline("Нет подключения к интернету. Введённые значения не сохранены.");
  const clean = sanitizeEntry(tasks, entry);
  await setDoc(entryRef(code), { kind: "practicalEntry", ...clean, updatedBy: State?.user?.uid || "", updatedAt: serverTimestamp() });
}

export async function loadReview(code) {
  const s = await getDoc(reviewRef(code));
  return s.exists() ? (s.data().overrides || {}) : {};
}
// Решения сохраняются сразу — перезагрузка страницы их не теряет.
export async function saveReview(code, overrides) {
  requireOnline();
  const clean = {};
  for (const team of TEAMS) {
    clean[team] = {};
    for (const [id, v] of Object.entries(overrides?.[team] || {})) if (typeof v === "boolean" && /^r\d+c\d+$/.test(id)) clean[team][id] = v;
  }
  await setDoc(reviewRef(code), { kind: "practicalReview", overrides: clean, updatedAt: serverTimestamp() });
}

// Расчёт результата для ведущего: ключи + ответы + решения преподавателя.
export function computeResults({ tasks, keys, submissions, overrides }) {
  const evaluations = {};
  for (const team of TEAMS) {
    if (!tasks?.[team] || !submissions?.[team]) continue;
    evaluations[team] = evaluateSubmission({
      pub: tasks[team], keys: keys?.[team] || {},
      cells: submissions[team].cells || {}, overrides: overrides?.[team] || {}
    });
  }
  return { evaluations, comparison: compareTeams(evaluations.a, evaluations.b) };
}

// Подтверждение результата: в задания команд пишется ПУБЛИЧНЫЙ итог (баллы и
// верно/неверно по ячейкам, без ожидаемых ответов), полный результат — в закрытый
// документ ведущего. После подтверждения задания закрыты: status = confirmed.
export async function confirmResult(code, { evaluations, comparison, overrides }) {
  requireOnline("Нет подключения к интернету. Результат не подтверждён.");
  if (!comparison?.ready) throw new Error(comparison?.reason || "Результат ещё нельзя подтвердить.");
  const batch = writeBatch(db);
  for (const team of TEAMS) {
    const ev = evaluations[team];
    batch.update(taskRef(code, team), {
      status: TASK_STATUS.CONFIRMED, updatedAt: serverTimestamp(),
      result: {
        score: ev.score, max: ev.max, percent: ev.percent,
        cells: Object.fromEntries(Object.entries(ev.cells).map(([id, c]) => [id, c.ok === true])),
        winner: comparison.tie ? "tie" : comparison.winner
      }
    });
  }
  batch.set(resultRef(code), {
    kind: "practicalResult", evaluations, comparison, overrides: overrides || {}, confirmedBy: State?.user?.uid || "", confirmedAt: serverTimestamp()
  });
  await batch.commit();
}

export async function loadConfirmedResult(code) {
  const s = await getDoc(resultRef(code));
  return s.exists() ? s.data() : null;
}

// ---------- Подписки ----------

export const subscribeTask = (code, team, onData, onError) => subscribeDoc(taskRef(code, team), onData, onError);
export const subscribeSubmission = (code, team, onData, onError) => subscribeDoc(subRef(code, team), onData, onError);

// ---------- Капитан ----------

// Черновик: сохраняются только известные ячейки.
export async function saveDraft(code, team, pub, cells) {
  requireOnline("Нет подключения к интернету. Черновик не сохранён.");
  await setDoc(subRef(code, team), {
    team, cells: sanitizeCells(pub, cells), status: SUBMISSION.DRAFT,
    by: State?.user?.uid || "", updatedAt: serverTimestamp()
  });
}

// Отправка: после неё таблица зафиксирована (правила запрещают правку).
export async function submitTable(code, team, pub, cells) {
  requireOnline("Нет подключения к интернету. Таблица не отправлена.");
  await setDoc(subRef(code, team), {
    team, cells: sanitizeCells(pub, cells), status: SUBMISSION.SUBMITTED,
    by: State?.user?.uid || "", updatedAt: serverTimestamp(), submittedAt: serverTimestamp()
  });
}

// Снимок для отчёта (читает ведущий): публичные задания, ответы и ключи для
// показа ожидаемых ответов преподавателю в истории занятия.
export async function loadPracticalSnapshot(code) {
  const tasks = {};
  const submissions = {};
  const keys = {};
  for (const team of TEAMS) {
    const [t, s, k] = await Promise.all([getDoc(taskRef(code, team)), getDoc(subRef(code, team)), getDoc(keyRef(code, team))]);
    if (t.exists()) tasks[team] = t.data();
    if (s.exists()) submissions[team] = s.data();
    if (k.exists()) keys[team] = k.data().cells || {};
  }
  return { tasks, submissions, keys };
}
