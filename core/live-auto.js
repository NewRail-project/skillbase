// core/live-auto.js — чистая логика автономного режима Live-комнат.
// Без DOM и Firebase: проверяется юнит-тестами в Node.
//
// Идея автономного режима. Ведущий один раз нажимает «Начать тест»: в
// документ комнаты пишется серверная метка autoStartedAt. Дальше номер
// текущего вопроса — ЧИСТАЯ ФУНКЦИЯ серверного времени:
//
//   позиция = floor((серверное_время − autoStartedAt) / слот)
//   слот    = questionSec + gapSec
//   окно ответа = первые questionSec секунд слота (+ небольшая погрешность)
//
// Никто не «выпускает» вопросы руками, и никакой локальный таймер не
// решает, какой вопрос текущий: все устройства считают одно и то же из
// одних и тех же полей комнаты. Правила Firestore считают ту же формулу
// от request.time (см. firestore.rules, players/answers) — поэтому ответ
// на «не тот» вопрос или после окончания окна сервер отклонит сам.

import { scoreForQuestion } from "./rooms-logic.js";

// ---------- Режимы, роли, состояния ----------

export const LIVE_MODE_AUTO = "auto";
export const LIVE_MODE_MANUAL = "manual";

export const ROLE_PLAYER = "player";
export const ROLE_OBSERVER = "observer";

// Состояния клиента. Каждое — независимое: «waiting» наступает по факту
// подтверждённой записи участника и НЕ зависит от загрузки списка.
export const CONN = Object.freeze({
  CONNECTING: "connecting",
  WAITING: "waiting",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  ERROR: "connection_error",
  CLOSED: "closed"
});

// Параметры расписания (границы совпадают с правилами Firestore).
export const QUESTION_SEC_DEFAULT = 30;
export const QUESTION_SEC_MIN = 5;
export const QUESTION_SEC_MAX = 600;
export const GAP_SEC_DEFAULT = 3;
export const GAP_SEC_MIN = 2;   // gap ≥ 2 с: допуск ответа (1 с) не залезает в следующий слот
export const GAP_SEC_MAX = 10;
// Допуск на задержку сети между кликом и записью (мс). Правило Firestore
// использует то же значение.
export const ANSWER_GRACE_MS = 1000;
// Когда ведущий закрывает вопрос (раскрывает ответ): окно + допуск + запас
// на доставку последних ответов в снапшот ведущего.
export const FINALIZE_DELAY_MS = ANSWER_GRACE_MS + 400;

// ---------- Роли ----------

export function normalizeRole(value) {
  return value === ROLE_OBSERVER ? ROLE_OBSERVER : ROLE_PLAYER;
}

// Роль записи players/{uid}: поле role, а для старых документов — observer.
export function roleOfPlayer(player) {
  if (!player) return null;
  if (player.role === ROLE_OBSERVER || player.role === ROLE_PLAYER) return player.role;
  return player.observer === true ? ROLE_OBSERVER : ROLE_PLAYER;
}

// Роль, которую можно запросить при входе. Преподаватель, не ведущий
// этой комнаты, входит только наблюдателем (так же требуют правила).
export function resolveRequestedRole({ requested, isStaffUser = false, isHost = false } = {}) {
  const role = normalizeRole(requested);
  if (role === ROLE_PLAYER && isStaffUser && !isHost) return ROLE_OBSERVER;
  return role;
}

// ФИО для входа: подставляем из профиля, если там есть минимум два слова
// (фамилия и имя). Иначе его нужно ввести.
export function nameForJoin({ typed = "", profileName = "", role = ROLE_PLAYER } = {}) {
  const clean = value => String(value ?? "").trim().replace(/\s+/g, " ");
  const name = clean(typed) || clean(profileName);
  if (name.length < 2) {
    return { ok: false, error: role === ROLE_OBSERVER
      ? "Укажите имя или ФИО — оно будет видно в комнате."
      : "Укажите ФИО." };
  }
  if (name.length > 120) return { ok: false, error: "Имя слишком длинное (максимум 120 символов)." };
  if (role === ROLE_PLAYER && !clean(profileName) && !clean(typed).includes(" ")) {
    return { ok: false, error: "Укажите фамилию и имя." };
  }
  return { ok: true, value: name };
}

// ---------- Настройки автономного теста ----------

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Время на вопрос: явное значение → timePerQuestion теста →
// totalTime / число вопросов → по умолчанию.
export function questionSecFor(test, override = null) {
  const s = test?.settings || {};
  const count = Array.isArray(test?.questions) ? test.questions.length : 0;
  let value = Number(override);
  if (!Number.isFinite(value) || value <= 0) value = Number(s.timePerQuestion);
  if (!Number.isFinite(value) || value <= 0) {
    const total = Number(s.totalTime);
    value = Number.isFinite(total) && total > 0 && count > 0
      ? Math.round(total / count)
      : QUESTION_SEC_DEFAULT;
  }
  return clampInt(value, QUESTION_SEC_MIN, QUESTION_SEC_MAX, QUESTION_SEC_DEFAULT);
}

// Итоговые настройки комнаты автономного режима.
export function buildAutoSettings({ test, options = {}, random = Math.random } = {}) {
  const count = Array.isArray(test?.questions) ? test.questions.length : 0;
  const questionSec = questionSecFor(test, options.questionSec);
  const gapSec = clampInt(options.gapSec, GAP_SEC_MIN, GAP_SEC_MAX, GAP_SEC_DEFAULT);
  const shuffle = options.shuffleQuestions === true;
  return {
    mode: LIVE_MODE_AUTO,
    questionSec,
    gapSec,
    shuffleQuestions: shuffle,
    order: buildQuestionOrder(count, shuffle, random),
    speedBonus: options.speedBonus !== false,
    showLeaderboard: options.showLeaderboard != null
      ? options.showLeaderboard === true
      : test?.settings?.showLeaderboard === true,
    totalSec: count * (questionSec + gapSec)
  };
}

// Порядок вопросов: позиция → индекс вопроса в тесте.
export function buildQuestionOrder(count, shuffle = false, random = Math.random) {
  const order = Array.from({ length: Math.max(0, count | 0) }, (_, i) => i);
  if (!shuffle) return order;
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export function isValidOrder(order, count) {
  if (!Array.isArray(order) || order.length !== count) return false;
  return [...order].sort((a, b) => a - b).every((value, index) => value === index);
}

// Индекс вопроса теста для позиции.
export function questionIndexAt(room, position) {
  const order = room?.order;
  const count = Number(room?.questionCount) || (Array.isArray(order) ? order.length : 0);
  if (isValidOrder(order, count) && order[position] != null) return order[position];
  return position;
}

// Ключи по позициям: keysByPosition(...)[p] = ключ вопроса order[p].
// Возвращает МАССИВ длиной questionCount (нет ключа — null): scoring.js
// превращает карту в массив по отсортированным индексам, и дыры сдвинули
// бы позиции. Массив он оставляет как есть.
export function keysByPosition(keys, room) {
  const source = keys?.items ?? keys;
  const count = Number(room?.questionCount) || 0;
  const out = [];
  for (let p = 0; p < count; p++) {
    const index = questionIndexAt(room, p);
    const key = Array.isArray(source) ? source[index] : source?.[String(index)];
    out.push(key || null);
  }
  return out;
}

// ---------- Расписание ----------

function toMs(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

export function isAutoRoom(room) {
  return room?.mode === LIVE_MODE_AUTO;
}

// План из документа комнаты. startMs/endedMs — серверные метки в мс.
export function autoPlan(room) {
  const questionSec = clampInt(room?.questionSec, QUESTION_SEC_MIN, QUESTION_SEC_MAX, QUESTION_SEC_DEFAULT);
  const gapSec = clampInt(room?.gapSec, GAP_SEC_MIN, GAP_SEC_MAX, GAP_SEC_DEFAULT);
  const questionMs = questionSec * 1000;
  const gapMs = gapSec * 1000;
  return {
    count: Math.max(0, Number(room?.questionCount) || 0),
    questionSec,
    gapSec,
    questionMs,
    gapMs,
    slotMs: questionMs + gapMs,
    startMs: toMs(room?.autoStartedAt),
    endedMs: toMs(room?.autoEndedAt)
  };
}

// Когда тест закончится сам (без досрочного завершения).
export function autoEndMs(plan) {
  if (plan.startMs == null) return null;
  return plan.startMs + plan.count * plan.slotMs;
}

// Начало вопроса на позиции p (серверное время, мс).
export function questionStartMs(plan, position) {
  if (plan.startMs == null) return null;
  return plan.startMs + position * plan.slotMs;
}

// Карта «позиция → начало вопроса» для бонуса за скорость.
export function autoQStarts(plan) {
  const out = {};
  if (plan.startMs == null) return out;
  for (let p = 0; p < plan.count; p++) out[String(p)] = questionStartMs(plan, p);
  return out;
}

// Где мы в расписании в момент nowMs (серверное время).
// state: waiting | in_progress | completed
// phase: idle | question | gap | done
export function autoPosition(plan, nowMs) {
  if (plan.startMs == null) {
    return { state: "waiting", phase: "idle", position: -1, msLeft: null, elapsedMs: 0 };
  }
  const endByTime = autoEndMs(plan);
  const endMs = plan.endedMs != null ? Math.min(plan.endedMs, endByTime) : endByTime;
  if (plan.count === 0 || nowMs >= endMs) {
    return { state: "completed", phase: "done", position: plan.count - 1, msLeft: 0,
      elapsedMs: Math.max(0, endMs - plan.startMs) };
  }
  // Часы устройства могут чуть опережать/отставать: до старта считаем 0.
  const elapsed = Math.max(0, nowMs - plan.startMs);
  const position = Math.min(plan.count - 1, Math.floor(elapsed / plan.slotMs));
  const inSlot = elapsed - position * plan.slotMs;
  const phase = inSlot < plan.questionMs ? "question" : "gap";
  const msLeft = phase === "question" ? plan.questionMs - inSlot : plan.slotMs - inSlot;
  return { state: "in_progress", phase, position, msLeft, elapsedMs: elapsed };
}

// Копия формулы правил Firestore: можно ли записать ответ на вопрос qid
// в момент requestMs (серверное время записи). Используется в тестах как
// эталон, с которым сверяются правила, и клиентом, чтобы не слать заведомо
// отклонённые ответы.
export function answerAllowed(plan, requestMs, qid, { graceMs = ANSWER_GRACE_MS } = {}) {
  if (plan.startMs == null || plan.count <= 0) return false;
  if (plan.endedMs != null && requestMs >= plan.endedMs) return false;
  const elapsed = requestMs - plan.startMs;
  if (elapsed < 0) return false;
  const index = Math.floor(elapsed / plan.slotMs);
  if (index >= plan.count) return false;
  if (!/^[0-9]{1,4}$/.test(String(qid)) || Number(qid) !== index) return false;
  return elapsed - index * plan.slotMs < plan.questionMs + graceMs;
}

// Позиции, у которых окно ответа закончилось, а reveal ещё не записан.
export function finalizablePositions({ plan, nowMs, reveals = {}, delayMs = FINALIZE_DELAY_MS }) {
  if (plan.startMs == null) return [];
  const out = [];
  for (let p = 0; p < plan.count; p++) {
    const startedAt = questionStartMs(plan, p);
    // Вопрос, который не успел начаться из-за досрочного завершения.
    if (plan.endedMs != null && startedAt >= plan.endedMs) break;
    const windowEnd = plan.endedMs != null
      ? Math.min(startedAt + plan.questionMs, plan.endedMs)
      : startedAt + plan.questionMs;
    if (nowMs >= windowEnd + delayMs && !reveals[String(p)]) out.push(p);
  }
  return out;
}

// Позиции, на которые участники могли отвечать (для подсчёта «завершённых»).
export function finishedPositions(plan, nowMs) {
  if (plan.startMs == null) return [];
  const out = [];
  for (let p = 0; p < plan.count; p++) {
    const startedAt = questionStartMs(plan, p);
    if (plan.endedMs != null && startedAt >= plan.endedMs) break;
    const windowEnd = plan.endedMs != null
      ? Math.min(startedAt + plan.questionMs, plan.endedMs)
      : startedAt + plan.questionMs;
    if (nowMs >= windowEnd) out.push(p);
  }
  return out;
}

// ---------- Единое состояние комнаты ----------

// waiting | in_progress | completed | closed — одинаково для всех ролей.
export function roomLifecycle(room, nowMs) {
  if (!room) return null;
  if (room.status === "closed") return "closed";
  if (isAutoRoom(room)) {
    const stored = room.liveState;
    const pos = autoPosition(autoPlan(room), nowMs);
    if (pos.state === "completed" || stored === "completed") return "completed";
    return pos.state;
  }
  if (room.phase === "idle" || room.phase == null) return "waiting";
  return "in_progress";
}

export function isRegistrationOpen(room, nowMs = Date.now()) {
  if (!room || room.status !== "active") return false;
  if (room.registrationOpen === false) return false;
  return roomLifecycle(room, nowMs) !== "completed";
}

// Состояние клиента (то, что рисует страница комнаты).
//  error      — последняя ошибка подписки на комнату/свой документ;
//  memberConfirmed — собственный документ players/{uid} прочитан (или это ведущий);
//  roomLoaded — документ комнаты получен;
//  timedOut   — прошло 15 с без подтверждения (защита от вечного ожидания).
// Таймаут НЕ подтверждает подключение: без подтверждения он даёт ошибку.
export function deriveConnectionState({
  error = null, memberConfirmed = false, roomLoaded = false,
  room = null, nowMs = Date.now(), timedOut = false
} = {}) {
  if (!memberConfirmed || !roomLoaded) {
    if (error || timedOut) return CONN.ERROR;
    return CONN.CONNECTING;
  }
  const lifecycle = roomLifecycle(room, nowMs);
  if (lifecycle === "closed") return CONN.CLOSED;
  if (lifecycle === "completed") return CONN.COMPLETED;
  if (lifecycle === "in_progress") return CONN.IN_PROGRESS;
  return CONN.WAITING;
}

// ---------- Синхронизация часов ----------

// Оценка смещения часов устройства относительно сервера по одной пробе:
// запись serverTimestamp() отправлена в sendMs, ack получен в ackMs,
// сервер поставил метку serverMs. Метка ≈ середине запроса.
export function offsetFromProbe({ sendMs, ackMs, serverMs }) {
  if (![sendMs, ackMs, serverMs].every(Number.isFinite) || ackMs < sendMs) return null;
  return { offsetMs: serverMs - (sendMs + ackMs) / 2, rttMs: ackMs - sendMs };
}

// Лучшая проба — с наименьшим временем отклика.
export function bestOffset(samples) {
  const valid = (samples || []).filter(Boolean);
  if (!valid.length) return 0;
  return valid.reduce((best, s) => (s.rttMs < best.rttMs ? s : best)).offsetMs;
}

export function serverNow(offsetMs = 0, localNowMs = Date.now()) {
  return localNowMs + (Number.isFinite(offsetMs) ? offsetMs : 0);
}

// ---------- Рейтинг ----------

// Строки общего рейтинга: участники (не наблюдатели) + их очки.
// Участник без документа очков (ещё нет закрытых вопросов) — с нулями.
// scores — документы rooms/{code}/scores; players — список участников.
export function ratingRows({ scores = [], players = [], questionCount = 0,
  finished = 0, lifecycle = "waiting" } = {}) {
  const byUid = new Map();
  for (const s of scores) byUid.set(s.uid, s);
  const roster = new Map();
  for (const p of players) {
    if (roleOfPlayer(p) === ROLE_OBSERVER) continue;
    roster.set(p.uid, { uid: p.uid, name: p.name || "Участник", avatar: p.avatar });
  }
  // Очки есть, а участника в списке нет (список ещё грузится): не теряем.
  for (const s of scores) {
    if (!roster.has(s.uid)) roster.set(s.uid, { uid: s.uid, name: s.name || "Участник" });
  }
  const done = lifecycle === "completed" || lifecycle === "closed";
  const rows = [...roster.values()].map(p => {
    const s = byUid.get(p.uid) || {};
    const correct = Number(s.correctCount) || 0;
    const closed = Number(s.finished) || finished || 0;
    return {
      uid: p.uid,
      name: s.name || p.name,
      avatar: p.avatar,
      score: Number(s.score) || 0,
      max: Number(s.max) || 0,
      correctCount: correct,
      answered: Number(s.answered) || 0,
      finished: closed,
      total: questionCount,
      percent: closed > 0 ? Math.round((correct / closed) * 100) : 0,
      status: done ? "completed" : "in_progress"
    };
  });
  rows.sort((a, b) => b.score - a.score
    || b.correctCount - a.correctCount
    || a.name.localeCompare(b.name, "ru"));
  // Места: равные очки и верные — одно место (1, 1, 3).
  let place = 0;
  rows.forEach((row, index) => {
    const prev = rows[index - 1];
    if (!prev || prev.score !== row.score || prev.correctCount !== row.correctCount) place = index + 1;
    row.place = place;
  });
  return rows;
}

export const RATING_STATUS_LABEL = Object.freeze({
  in_progress: "Проходит",
  completed: "Завершил"
});

// Записи scores, которые реально изменились (экономим записи Firestore).
export function changedScores(existing = [], board = []) {
  const byUid = new Map(existing.map(s => [s.uid, s]));
  return board.filter(entry => {
    const old = byUid.get(entry.uid);
    return !old
      || old.score !== entry.score
      || old.max !== entry.max
      || old.correctCount !== entry.correctCount
      || old.answered !== entry.answered
      || old.finished !== entry.finished
      || old.name !== entry.name;
  });
}

// Сводка итогов для ведущего.
export function summarizeRating(rows) {
  if (!rows.length) return { participants: 0, averageScore: 0, averagePercent: 0, best: null };
  const sum = (key) => rows.reduce((acc, row) => acc + row[key], 0);
  return {
    participants: rows.length,
    averageScore: Math.round((sum("score") / rows.length) * 10) / 10,
    averagePercent: Math.round(sum("percent") / rows.length),
    best: rows[0]
  };
}

// Доля верных ответов по каждому закрытому вопросу (для ведущего).
export function questionAccuracy({ players = [], keysByPos = [], positions = [] }) {
  const roster = players.filter(p => roleOfPlayer(p) !== ROLE_OBSERVER);
  return positions.map(position => {
    const key = keysByPos[String(position)];
    let answered = 0;
    let correct = 0;
    for (const p of roster) {
      const answer = p.answers?.[String(position)];
      if (answer == null) continue;
      answered += 1;
      if (key && scoreForQuestion(key, answer).correct) correct += 1;
    }
    return {
      position,
      answered,
      correct,
      participants: roster.length,
      percent: roster.length ? Math.round((correct / roster.length) * 100) : 0
    };
  });
}

// Короткая подпись времени «мм:сс».
export function formatClockMs(ms) {
  const total = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
