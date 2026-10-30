// core/rooms-logic.js — чистая логика Live-комнат.
// Без DOM и Firebase, чтобы проверяться юнит-тестами в Node.

import { isCorrect, normalizeKeys } from "./scoring.js";

// Алфавит без похожих символов: нет 0, O, 1, I.
export const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

// Хранилище кода, чтобы generateRoomCode() не работал в Edge-случаях без
// Math.random? Оставляем Math.random: для комнаты collided кода почти нет.
export function generateRoomCode(random = Math.random) {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length)];
  }
  return code;
}

// Нормализация ввода кода: обрезаем пробелы, поднимаем регистр,
// заменяем похожие символы (кириллицу О/1/I на латиницу).
export function normalizeRoomCode(value) {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/О/g, "O")
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/І/g, "I");
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(raw)) return null;
  return raw;
}

export function isValidRoomCode(value) {
  return /^[A-HJ-NP-Z2-9]{6}$/.test(String(value || ""));
}

// Время вопроса: сервер даёт qStartedAt (мс). Серверная метка — опора.
// Смещение устройства в будущее (вопрос «ещё не начался») маскируем
// моментом получения; уход в прошлое НЕ маскируем: после перезагрузки
// ведущий и таймер должны видеть, что время вопроса уже вышло, чтобы
// восстановление комнты честно закрывало вопрос один раз.
export function questionTimeMs(qStartedMs, receivedMs = Date.now()) {
  const SKEW_MS = 120_000;
  if (typeof qStartedMs !== "number" || !Number.isFinite(qStartedMs)) {
    return receivedMs;
  }
  if (qStartedMs > receivedMs + SKEW_MS) return receivedMs;
  return qStartedMs;
}

// Сигнатура состояния для отложенной перерисовки: если string не изменилась,
// DOM не трогаем — поле ввода участника не теряет фокус на каждом снапшоте.
export function roomSignature({ room, players, myAnswer }) {
  const playerBits = (players || [])
    .map(p => `${p.uid}:${(p.name || "").slice(0, 24)}:${p.observer ? 1 : 0}`)
    .sort()
    .join(",");
  const answerBits = (players || [])
    .filter(p => !p.observer)
    .map(p => `${p.uid}:${p.answers?.[room?.currentQuestionId] != null ? 1 : 0}`)
    .sort()
    .join(",");
  return [
    room?.status ?? "",
    String(room?.currentQuestionId ?? ""),
    room?.phase ?? "",
    String(room?.qStartedMs ?? ""),
    String(room?.questionCount ?? 0),
    `players=${playerBits}`,
    `ans=${answerBits}`,
    `me=${myAnswer != null ? 1 : 0}`
  ].join("|");
}

// Сколько участников (не наблюдателей) уже ответили на текущий вопрос.
export function answeredCount(players, questionId, { includeObservers = false } = {}) {
  return (players || []).filter(p => (includeObservers || !p.observer)
    && p.answers?.[questionId] != null).length;
}

// ---------- Очки: база, серия, бонус за скорость ----------
// Очки пересчитываются с нуля по answers/times при каждом закрытии
// вопроса; функция чистая, потому остаётся идемпотентной.

// Серия: +10% за каждый верный ответ подряд, максимум +50%.
export const STREAK_STEP = 0.10;
export const STREAK_MAX = 0.50;

export function streakRatio(streak) {
  const n = Number.isFinite(streak) && streak > 0 ? streak : 0;
  return Math.min(STREAK_MAX, n * STREAK_STEP);
}

// Бонус за скорость: до +50% от базовых очков, линейно по оставшемуся
// времени. Действует только если у комнаты задан qDurationSec > 0.
// Время ответа — серверное: times.<q> (мс) минус qStartedAt (мс).
export const SPEED_MAX = 0.50;

export function speedRatio(qDurationSec, answeredMs) {
  const duration = Number(qDurationSec);
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (typeof answeredMs !== "number" || !Number.isFinite(answeredMs) || answeredMs < 0) return 0;
  const left = 1 - answeredMs / (duration * 1000);
  // Ответ позже длительности даёт 0: вопрос уже не открыт.
  if (left <= 0) return 0;
  return Math.min(1, left) * SPEED_MAX;
}

// Итог очков одного ответа: базовые очки, домноженные на бонусы.
export function answerPoints(basePoints, { streak = 0, speed = 0 } = {}) {
  const mult = 1 + streakRatio(streak) + Math.min(SPEED_MAX, Math.max(0, speed));
  return Math.round((basePoints || 1) * mult);
}

// Игрок из снапшота дальше идёт в чистые функции: times приведены к мс.
export function normalizePlayerTimes(player) {
  if (!player) return player;
  const times = player.times || {};
  const fixed = {};
  for (const qid of Object.keys(times)) fixed[qid] = toNumberMs(times[qid]);
  return { ...player, times: fixed };
}

function toNumberMs(value) {
  if (typeof value === "number") return value;
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value && typeof value.seconds === "number") return value.seconds * 1000;
  if (value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.getTime();
  }
  return null;
}

// Множитель зоны расчёта скорости: qStarts — карта qid → мс начала
// вопроса (серверные метки, пишет ведущий при openQuestion).
function speedRatioFor(player, qid, speedOpts) {
  const startedMs = speedOpts?.qStarts?.[qid];
  const answeredMs = player?.times?.[qid];
  if (!startedMs || typeof answeredMs !== "number") return 0;
  return speedRatio(speedOpts?.qDurationSec, answeredMs - startedMs);
}

// Вердикт по моему ответу после закрытия вопроса: true/false/null (reveal нет).
export function myAnswerVerdict(reveal, myAnswer) {
  if (!reveal || myAnswer == null) return null;
  const data = reveal.reveal || {};
  if (data.type === "short") {
    const mine = String(myAnswer ?? "").trim().toLowerCase();
    const answer = String(data.answer ?? "").trim().toLowerCase();
    if (!mine) return false;
    return mine === answer;
  }
  const correct = Array.isArray(data.correct) ? data.correct.map(Number) : [];
  const mine = Array.isArray(myAnswer) ? myAnswer.map(Number) : [Number(myAnswer)];
  return correct.length === mine.length && correct.every(value => mine.includes(value));
}

// Очки по ответам выбранного вопроса. keys — map индексов вопросов.
export function scoreForQuestion(key, answer) {
  if (!key) return { correct: false, points: 0 };
  const correct = isCorrect(key, answer);
  return { correct, points: correct ? (key.points || 1) : 0 };
}

// Одиночный подсчёт: агрегирует ответы по всем открытым вопросам.
// revealedUntil — сколько вопросов уже закрыто и за них начислить очки.
// speed (необязательно): { qDurationSec, qStarts: {qid: ms} } — включает
// бонус за скорость для вопросов, у которых есть начальные/ответные
// серверные метки. Пересчёт с нуля из ответов — идемпотентен.
export function computeScores(players, keys, openedIndexes = [], speed = null) {
  const normalized = normalizeKeys(keys);
  const perPlayer = (players || []).filter(p => !p.observer).map(raw => {
    const player = speed ? normalizePlayerTimes(raw) : raw;
    let score = 0;
    let max = 0;
    let correctCount = 0;
    let streak = 0;
    openedIndexes.forEach(index => {
      const qid = String(index);
      const key = normalized[qid];
      if (!key) return;
      max += key.points || 1;
      const answer = player.answers?.[qid];
      if (answer == null) { streak = 0; return; } // пропуск сбрасывает серию
      const { correct, points } = scoreForQuestion(key, answer);
      if (correct) {
        correctCount += 1;
        streak += 1;
        const add = answerPoints(points, {
          streak,
          speed: speed ? speedRatioFor(player, qid, speed) : 0
        }) - points;
        score += points + add;
      } else {
        streak = 0; // неверный ответ сбрасывает серию
      }
    });
    return {
      uid: player.uid,
      name: player.name || "Участник",
      score,
      max,
      correctCount
    };
  });
  return perPlayer.sort((a, b) => b.score - a.score
    || (a.name || "").localeCompare(b.name || "", "ru"));
}

// Что раскрывается после закрытия вопроса (reveals/{q}) — только из
// ключей testKeys: правильные ответы оттуда и доходят до участников.
export function buildReveal(key) {
  if (!key) return null;
  const base = {
    type: key.type || "single",
    points: key.points || 1
  };
  if (key.type === "short") {
    base.answer = String(key.answer ?? "");
  } else {
    base.correct = Array.isArray(key.correct) ? key.correct : [];
  }
  if (typeof key.explanation === "string" && key.explanation.trim()) {
    base.explanation = key.explanation.trim();
  }
  return base;
}

// Поля players/{uid} для входа в комнату (joinRoom / joinRoomAsGuest).
//
// existing — данные существующего документа (или null при первом входе).
// Правила Firestore разрешают update только имени, аватару и updatedAt:
// повторный вход не переписывает joinedAt и не меняет роль (observer).
// SERVER_TS — маркер серверной метки: вызывающий заменяет его на
// serverTimestamp() перед записью.
export const SERVER_TIMESTAMP = Symbol("serverTimestamp");

export function joinPlayerFields(existing, { uid = "", playerId = "", name, observer = false, avatar = null } = {}) {
  if (!existing) {
    const fields = {
      uid: uid || "",
      playerId: playerId || uid || "",
      name,
      observer: !!observer,
      joinedAt: SERVER_TIMESTAMP,
      updatedAt: SERVER_TIMESTAMP
    };
    if (avatar) fields.avatar = avatar;
    return fields;
  }

  // Повторный вход: роль и время первого входа не трогаем, поле пишем
  // только если значение реально изменилось (merge не трогает остальное).
  const fields = { uid: existing.uid || uid || "", playerId: existing.playerId || playerId || uid || "" };
  if (name && name !== existing.name) fields.name = name;
  if (avatar && avatar !== existing.avatar) fields.avatar = avatar;
  fields.updatedAt = SERVER_TIMESTAMP;
  return fields;
}
