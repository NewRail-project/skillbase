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
  computeScores, buildReveal
} from "./rooms-logic.js";
import { normalizeKeys } from "./scoring.js";
import { State } from "./auth.js";

function requireOnline(message) {
  if (!navigator.onLine) throw new Error(message || "Нет подключения к интернету.");
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
        questionCount: questions.length,
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
// и пересчитывает scores по ответам на уже закрытые вопросы.
export async function closeQuestion({ code, index, keys, test, players }) {
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
  const board = computeScores(players || [], normalized, openedIndexes);
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
// вызываемую в cleanup() страницы.
export function subscribeRoom(code, { onRoom, onPlayers, onError }) {
  const roomCode = normalizeRoomCode(code);
  if (!roomCode) {
    throw new Error("Некорректный код комнаты.");
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
    snapshot => onPlayers && onPlayers(snapshot.docs.map(item => ({ uid: item.id, ...item.data() }))),
    error => onError && onError(error)
  );
  return () => {
    try { unsubscribeRoom(); } catch (e) { /* уже отписаны */ }
    try { unsubscribePlayers(); } catch (e) { /* уже отписаны */ }
  };
}

// Участник отвечает на текущий вопрос один раз: правила запрещают
// перезапись ключа answers.<текущий вопрос>.
export async function saveAnswer(code, questionId, answer) {
  requireOnline("Нет подключения к интернету. Ответ не сохранён.");
  const roomCode = normalizeRoomCode(code);
  if (!roomCode) throw new Error("Некорректный код комнаты.");
  if (!State.user?.uid) throw new Error("Нужно войти в аккаунт.");
  const questionStr = String(questionId);
  if (!questionStr || questionStr === "null") throw new Error("Вопрос не открыт.");
  await updateDoc(
    doc(db, "rooms", roomCode, "players", State.user.uid),
    {
      [`answers.${questionStr}`]: answer,
      updatedAt: serverTimestamp()
    }
  );
}

export { isValidRoomCode, normalizeRoomCode };
