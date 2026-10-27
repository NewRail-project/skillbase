// core/rooms.js — Firestore-слой Live-комнат.
// Модель: rooms/{code} (пишет ведущий), rooms/{code}/players/{uid}
// (участник пишет только answers.<номер вопроса>, один раз),
// rooms/{code}/scores/{uid} и rooms/{code}/reveals/{q} (пишет только
// ведущий), rooms/{code}/observers/{uid}. Очки считает клиент ведущего
// при закрытии вопроса; правильные ответы лежат в testKeys и доходят до
// участников только через reveals после закрытия вопроса.

import {
  db, doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp,
  collection
} from "../shared/firebase.js";
import {
  generateRoomCode, normalizeRoomCode, isValidRoomCode,
  computeScores, buildReveal, normalizePlayerTimes
} from "./rooms-logic.js";
import { normalizeKeys } from "./scoring.js";
import { State } from "./auth.js";
import {
  REACTIONS, normalizeReaction
} from "../shared/reactions.js";

function requireOnline(message) {
  if (!navigator.onLine) throw new Error(message || "Нет подключения к интернету.");
}

function toMs(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function roomRef(code) {
  return doc(db, "rooms", code);
}

// Ведущий создаёт комнату. Правила разрешают только сотрудникам
// организации и только для опубликованного теста.
export async function createRoom({ test, profile }) {
  requireOnline("Нет подключения к интернету. Комната не создана.");
  if (!test?.id) throw new Error("Тест не выбран.");
  if (!profile?.orgId) throw new Error("Профиль организации не загружен.");
  if (test.status !== "published") {
    throw new Error("Комнату можно открыть только для опубликованного теста.");
  }
  const questions = Array.isArray(test.questions) ? test.questions : [];
  if (!questions.length) throw new Error("В тесте нет вопросов.");

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    try {
      await setDoc(roomRef(code), {
        code,
        testId: test.id,
        testTitle: test.title || "",
        orgId: profile.orgId,
        hostId: State.user?.uid || "",
        hostName: profile.fullName || "",
        status: "active",
        currentQuestion: -1,
        currentQuestionId: "",
        phase: "idle",
        qStartedAt: null,
        // Серверные метки старта каждого вопроса: { "0": timestamp, ... }.
        // Задержки сдают расчёт бонуса за скорость на пересчёте с нуля.
        qStarts: {},
        qDurationSec: questionDurationSec(test, test?.settings || {}),
        questionCount: questions.length,
        showLeaderboard: Boolean(test?.settings?.showLeaderboard),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      // Первый вход ведущего как собственного игрока-наблюдателя не нужен,
      // но игрокам нужна страница: сохраняем код.
      return code;
    } catch (err) {
      // Коллизия кода пробуется ещё раз; остальное — наружу.
      if (attempt === 4) throw err;
    }
  }
  throw new Error("Не удалось подобрать свободный код комнаты.");
}

export async function getRoom(code) {
  const normalized = normalizeRoomCode(code);
  if (!normalized) return null;
  const snap = await getDoc(roomRef(normalized));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function closeRoom(code) {
  await updateDoc(roomRef(normalizeRoomCode(code)), {
    status: "closed",
    closedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

// Вход в комнату: участник и наблюдатель пишут свой players/{uid}
// (наблюдатель пишет и observers/{uid}).
export async function joinRoom(code, { displayName, observer = false, profile } = {}) {
  requireOnline("Нет подключения к интернету. Вход в комнату не выполнен.");
  const roomCode = normalizeRoomCode(code);
  if (!roomCode) throw new Error("Некорректный код комнаты.");
  if (!State.user?.uid) throw new Error("Нужно войти в аккаунт.");
  const uid = State.user.uid;
  const room = await getRoom(roomCode);
  if (!room) throw new Error("Комната не найдена.");
  if (room.status !== "active") throw new Error("Комната закрыта.");
  if (room.orgId && profile?.orgId && room.orgId !== profile.orgId) {
    throw new Error("Комната принадлежит другой организации.");
  }

  await setDoc(
    doc(db, "rooms", roomCode, "players", uid),
    {
      uid,
      playerId: uid,
      name: displayName || profile?.fullName || "",
      observer: !!observer,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
  if (observer) {
    await setDoc(
      doc(db, "rooms", roomCode, "observers", uid),
      { uid, updatedAt: serverTimestamp() },
      { merge: true }
    );
  }
  return roomCode;
}

// Ведущий открывает вопрос: серверный qStartedAt — опора для таймера.
export async function openQuestion(code, questionIndex) {
  requireOnline("Нет подключения к интернету. Вопрос не открыт.");
  const index = Number(questionIndex);
  if (!Number.isInteger(index) || index < 0) throw new Error("Некорректный номер вопроса.");
  await updateDoc(roomRef(normalizeRoomCode(code)), {
    currentQuestion: index,
    currentQuestionId: String(index),
    phase: "opened",
    qStartedAt: serverTimestamp(),
    // История стартов — основа бонуса за скорость при пересчёте с нуля.
    [`qStarts.${index}`]: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

// Ведущий задаёт вопросу длительность (сек) из настроек теста.
export function questionDurationSec(test, settings) {
  const s = settings || test?.settings || {};
  if (s.timePerQuestion && Number(s.timePerQuestion) > 0) {
    return Number(s.timePerQuestion);
  }
  if (s.totalTime && Number(s.totalTime) > 0) {
    const count = (test?.questions || []).length || 1;
    return Math.max(0, Math.round(Number(s.totalTime) / count));
  }
  // Без настройки вопрос открыт до ручного закрытия.
  return null;
}

// Ведущий закрывает вопрос: пишет reveal (правильный ответ виден всем)
// и пересчитывает scores по ответам на уже закрытые вопросы. speed:
// { qDurationSec, qStarts: {qid: ms} } — бонус за скорость и серия.
export async function closeQuestion({ code, index, keys, test, players, speed = null }) {
  requireOnline("Нет подключения к интернету. Вопрос не закрыт.");
  const roomCode = normalizeRoomCode(code);
  if (!roomCode) throw new Error("Некорректный код комнаты.");
  const targetIndex = Number(index);
  if (!Number.isInteger(targetIndex) || targetIndex < 0) {
    throw new Error("Некорректный номер вопроса.");
  }

  // Ключи могут прийти документом testKeys (поле items) или готовой картой.
  const sourceKeys = keys?.items ?? keys;
  const normalized = normalizeKeys(sourceKeys);
  const key = normalized[String(targetIndex)] || null;

  await setDoc(
    doc(db, "rooms", roomCode, "reveals", String(targetIndex)),
    {
      qid: String(targetIndex),
      revealedAt: serverTimestamp(),
      reveal: buildReveal(key),
      points: key?.points || 1,
      explanation: key?.explanation || ""
    },
    { merge: false }
  );

  const openedIndexes = [];
  for (let i = 0; i <= targetIndex; i++) openedIndexes.push(i);
  const board = computeScores(players || [], normalized, openedIndexes, speed);
  for (const entry of board) {
    await setDoc(doc(db, "rooms", roomCode, "scores", entry.uid), {
      uid: entry.uid,
      name: entry.name,
      score: entry.score,
      max: entry.max,
      correctCount: entry.correctCount,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  await updateDoc(roomRef(roomCode), {
    phase: "closed",
    qStartedAt: null,
    updatedAt: serverTimestamp()
  });
  return board.length;
}

// Подписка на комнату и список игроков. Возвращает функцию отписки,
// вызываемую в cleanup() страницы. Ответы участников лежат в
// players/{uid}/answers/{qid} — подписываемся динамически на каждого.
export function subscribeRoom(code, { onRoom, onPlayers, onError }) {
  const roomCode = normalizeRoomCode(code);
  if (!roomCode) {
    throw new Error("Некорректный код комнаты.");
  }
  let playersRaw = [];
  const answerUnsubs = new Map();   // uid → unsubscribe
  const answersByUid = new Map();   // uid → {qid: value}
  const timesByUid = new Map();     // uid → {qid: ms}

  function emitPlayers() {
    if (!onPlayers) return;
    onPlayers(playersRaw.map(p => normalizePlayerTimes({
      ...p,
      answers: answersByUid.get(p.uid) || {},
      times: timesByUid.get(p.uid) || {}
    })));
  }

  function watchAnswers(player) {
    if (answerUnsubs.has(player.uid)) return;
    answersByUid.set(player.uid, {});
    timesByUid.set(player.uid, {});
    const unsub = onSnapshot(
      collection(db, "rooms", roomCode, "players", player.uid, "answers"),
      snapshot => {
        const answers = {};
        const times = {};
        snapshot.docs.forEach(item => {
          answers[item.id] = (item.data() || {}).answer;
          times[item.id] = toMs((item.data() || {}).at);
        });
        answersByUid.set(player.uid, answers);
        timesByUid.set(player.uid, times);
        emitPlayers();
      },
      error => onError && onError(error)
    );
    answerUnsubs.set(player.uid, unsub);
  }

  function unwatchGone() {
    const alive = new Set(playersRaw.map(p => p.uid));
    for (const [uid, unsub] of answerUnsubs) {
      if (!alive.has(uid)) {
        try { unsub(); } catch (e) { /* уже отписаны */ }
        answerUnsubs.delete(uid);
        answersByUid.delete(uid);
        timesByUid.delete(uid);
      }
    }
  }

  const unsubscribeRoom = onSnapshot(
    roomRef(roomCode),
    snapshot => onRoom && onRoom(snapshot.exists()
      ? { id: snapshot.id, ...snapshot.data() }
      : null),
    error => onError && onError(error)
  );
  const unsubscribePlayers = onSnapshot(
    collection(db, "rooms", roomCode, "players"),
    snapshot => {
      playersRaw = snapshot.docs.map(item => ({ uid: item.id, ...item.data() }));
      playersRaw.forEach(watchAnswers);
      unwatchGone();
      emitPlayers();
    },
    error => onError && onError(error)
  );
  return () => {
    try { unsubscribeRoom(); } catch (e) { /* уже отписаны */ }
    try { unsubscribePlayers(); } catch (e) { /* уже отписаны */ }
    answerUnsubs.forEach(unsub => { try { unsub(); } catch (e) { /* уже отписаны */ } });
    answerUnsubs.clear();
  };
}

// Участник отвечает на текущий вопрос один раз: правила запрещают
// перезапись ключа answers.<текущий вопрос>.
// Ответ на текущий вопрос — документ players/{uid}/answers/{qid}
// { answer, at }: правила разрешают только create и только пока qid ==
// currentQuestionId, поэтому перезапись и ответы на будущие вопросы
// невозможны. at — серверная метка (основа бонуса за скорость).
export async function saveAnswer(code, questionId, answer) {
  requireOnline("Нет подключения к интернету. Ответ не сохранён.");
  const roomCode = normalizeRoomCode(code);
  if (!roomCode) throw new Error("Некорректный код комнаты.");
  if (!State.user?.uid) throw new Error("Нужно войти в аккаунт.");
  const questionStr = String(questionId);
  if (!questionStr || questionStr === "null") throw new Error("Вопрос не открыт.");
  await setDoc(
    doc(db, "rooms", roomCode, "players", State.user.uid, "answers", questionStr),
    { answer, at: serverTimestamp() },
    { merge: false }
  );
}

// ---------- Реакции ----------

// rooms/{code}/reactions/{uid}: { emoji, at }. Каждый участник/наблюдатель
// пишет только свой документ; правила не дают слать чаще раза в секунду.
export const REACTIONS_PRESETS = REACTIONS;

export async function sendReaction(code, emoji) {
  requireOnline("Нет подключения к интернету. Реакция не отправлена.");
  const roomCode = normalizeRoomCode(code);
  if (!roomCode) throw new Error("Некорректный код комнаты.");
  if (!State.user?.uid) throw new Error("Нужно войти в аккаунт.");
  const clean = normalizeReaction(emoji);
  if (!clean) throw new Error("Неизвестная реакция.");
  await setDoc(
    doc(db, "rooms", roomCode, "reactions", State.user.uid),
    { emoji: clean, at: serverTimestamp() },
    { merge: true }
  );
}

// Подписка на реакции: возвращаем uid/emoji/at (мс). Рисует всплывающие
// эмодзи страница; здесь только снапшоты.
export function subscribeReactions(code, callback, onError) {
  const roomCode = normalizeRoomCode(code);
  if (!roomCode) throw new Error("Некорректный код комнаты.");
  return onSnapshot(
    collection(db, "rooms", roomCode, "reactions"),
    snapshot => {
      if (!callback) return;
      callback(snapshot.docs
        .map(item => {
          const data = item.data() || {};
          return {
            uid: item.id,
            emoji: data.emoji || "",
            atMs: toMs(data.at)
          };
        }));
    },
    error => onError && onError(error)
  );
}

export { isValidRoomCode, normalizeRoomCode };
