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

// Время вопроса на устройстве. Сервер даёт qStartedAt (мс):
// если его снапшот старше/новее Date.now() больше чем на ±2 минуты
// (сломанные часы, подвисший tabs), считаем от момента получения.
export function questionTimeMs(qStartedMs, receivedMs = Date.now()) {
  const SKEW_MS = 120_000;
  if (typeof qStartedMs !== "number" || !Number.isFinite(qStartedMs)) {
    return receivedMs;
  }
  if (Math.abs(receivedMs - qStartedMs) > SKEW_MS) return receivedMs;
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

// Очки по ответам выбранного вопроса. keys — map индексов вопросов.
export function scoreForQuestion(key, answer) {
  if (!key) return { correct: false, points: 0 };
  const correct = isCorrect(key, answer);
  return { correct, points: correct ? (key.points || 1) : 0 };
}

// Одиночный подсчёт: агрегирует ответы по всем открытым вопросам.
// revealedUntil — сколько вопросов уже закрыто и за них начислить очки.
export function computeScores(players, keys, openedIndexes = []) {
  const normalized = normalizeKeys(keys);
  const perPlayer = (players || []).filter(p => !p.observer).map(player => {
    let score = 0;
    let max = 0;
    let correctCount = 0;
    openedIndexes.forEach(index => {
      const key = normalized[String(index)];
      if (!key) return;
      max += key.points || 1;
      const { correct, points } = scoreForQuestion(key, player.answers?.[String(index)]);
      if (correct) {
        correctCount += 1;
        score += points;
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
