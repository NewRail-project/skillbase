// core/battle.js — Firestore-слой Skillbase Battle («Командная битва»).
// Модель хранения (см. docs/BATTLE-STORAGE.md):
//   rooms/{code}/battle              — один документ: настройки, команды,
//                                      раунды, очки, итоговая статистика
//   rooms/{code}/votes/{round}_{uid} — голос участника на раунд
//   rooms/{code}/captainDecisions/{round}_{uid} — решение капитана
//   rooms/{code}/substitutions/{round}_{ts}     — замена игрока
//   rooms/{code}/events/{ts}_{type}  — лог событий битвы
//   rooms/{code}/players/{uid}       — расширение: teamId, isCaptain,
//                                      isReserve, battleStats
//   rooms/{code}/scores/{uid}        — расширение: battle-оценка
//   roomHistory/{code}.battle        — снимок завершённой игры
//
// Правильные ответы НЕ хранятся в battle-документе: вопросы берутся из
// tests/{testId}, ключи — из testKeys/{testId} (restricted access),
// раскрытие — через rooms/{code}/reveals/{qid} (существующий механизм).
//
// Firestore Rules для battle-подколлекций спроектированы, но ещё не
// добавлены в firestore.rules (см. docs/BATTLE-STORAGE.md §5).
// Модуль работает только после добавления правил.
//
// Логика расчётов — core/battle-logic.js (чистая, без Firebase/DOM).

import {
  db, doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, serverTimestamp,
  collection, query, where, orderBy, limit
} from "../shared/firebase.js";
import { normalizeRoomCode } from "./rooms-logic.js";
import { State } from "./auth.js";

// ---------- Утилиты ----------

function requireOnline(message) {
  if (!navigator.onLine) throw new Error(message || "Нет подключения к интернету.");
}

function battleRef(code) {
  return doc(db, "rooms", code, "battle");
}

function votesRef(code) {
  return collection(db, "rooms", code, "votes");
}

function captainDecisionsRef(code) {
  return collection(db, "rooms", code, "captainDecisions");
}

function substitutionsRef(code) {
  return collection(db, "rooms", code, "substitutions");
}

function eventsRef(code) {
  return collection(db, "rooms", code, "events");
}

function playerRef(code, uid) {
  return doc(db, "rooms", code, "players", uid);
}

function scoreRef(code, uid) {
  return doc(db, "rooms", code, "scores", uid);
}

function validateCode(code) {
  const roomCode = normalizeRoomCode(code);
  if (!roomCode) throw new Error("Некорректный код комнаты.");
  return roomCode;
}

// ---------- Документ битвы: rooms/{code}/battle ----------

// Подписка на состояние битвы: null — документа ещё нет.
export function subscribeBattle(code, onData, onError) {
  const roomCode = validateCode(code);
  return onSnapshot(
    battleRef(roomCode),
    snapshot => onData && onData(snapshot.exists() ? snapshot.data() : null),
    error => onError && onError(error)
  );
}

// Чтение документа битвы: null — нет битвы.
export async function getBattle(code) {
  const roomCode = validateCode(code);
  const snap = await getDoc(battleRef(roomCode));
  return snap.exists() ? snap.data() : null;
}

// Создание документа битвы. Вызывается ведущим при запуске battle-режима.
// Повторное создание перезаписывает (merge: false) — ведущий контролирует
// состояние целиком.
export async function createBattle(code, payload) {
  requireOnline("Нет подключения к интернету. Битва не создана.");
  const roomCode = validateCode(code);
  if (!State.user?.uid) throw new Error("Нужно войти в аккаунт.");
  await setDoc(battleRef(roomCode), {
    ...payload,
    key: "battle",
    hostId: State.user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: false });
}

// Обновление документа битвы: новый раунд, закрытие раунда, изменение
// состава команд, финальная статистика. Ведущий пишет целиком (merge: false).
export async function updateBattle(code, payload) {
  requireOnline("Нет подключения к интернету. Битва не обновлена.");
  const roomCode = validateCode(code);
  await setDoc(battleRef(roomCode), {
    ...payload,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// Установка статуса битвы.
export async function setBattleStatus(code, status) {
  requireOnline("Нет подключения к интернету. Статус не изменён.");
  const roomCode = validateCode(code);
  const valid = ["waiting", "active", "paused", "finished"];
  if (!valid.includes(status)) throw new Error(`Недопустимый статус: ${status}.`);
  await updateDoc(battleRef(roomCode), {
    status,
    updatedAt: serverTimestamp()
  });
}

// ---------- Голоса: rooms/{code}/votes/{round}_{uid} ----------

// Подписка на голоса раунда. Каждый участник видит только свой голос
// (правила Firestore ограничивают чтение), ведущий — все голоса.
export function subscribeVotes(code, roundId, onData, onError) {
  const roomCode = validateCode(code);
  return onSnapshot(
    query(votesRef(roomCode), where("roundId", "==", roundId)),
    snapshot => {
      const votes = [];
      snapshot.forEach(item => votes.push({ id: item.id, ...item.data() }));
      onData && onData(votes);
    },
    error => onError && onError(error)
  );
}

// Голос участника на раунд. ID документа: "{roundId}_{uid}" — гарантирует
// один голос на пользователя на раунд (правила Firestore запрещают update).
export async function castVote(code, { roundId, teamId, selected }) {
  requireOnline("Нет подключения к интернету. Голос не отправлен.");
  const roomCode = validateCode(code);
  const uid = State.user?.uid;
  if (!uid) throw new Error("Нужно войти в аккаунт.");
  if (!Array.isArray(selected) || !selected.length) {
    throw new Error("Выберите хотя бы один вариант.");
  }
  const voteId = `${roundId}_${uid}`;
  await setDoc(doc(db, "rooms", roomCode, "votes", voteId), {
    voteId,
    uid,
    roundId,
    teamId,
    selected,
    at: serverTimestamp()
  }, { merge: false });
}

// Чтение голосов раунда (для ведущего и капитанов).
export async function readVotes(code, roundId) {
  const roomCode = validateCode(code);
  const snap = await getDocs(
    query(votesRef(roomCode), where("roundId", "==", roundId))
  );
  const votes = [];
  snap.forEach(item => votes.push({ id: item.id, ...item.data() }));
  return votes;
}

// ---------- Решения капитанов: rooms/{code}/captainDecisions/{round}_{uid} ----------

// Подписка на решения капитанов раунда.
export function subscribeCaptainDecisions(code, roundId, onData, onError) {
  const roomCode = validateCode(code);
  return onSnapshot(
    query(captainDecisionsRef(roomCode), where("roundId", "==", roundId)),
    snapshot => {
      const decisions = [];
      snapshot.forEach(item => decisions.push({ id: item.id, ...item.data() }));
      onData && onData(decisions);
    },
    error => onError && onError(error)
  );
}

// Решение капитана на раунд. ID документа: "{roundId}_{uid}".
export async function makeCaptainDecision(code, { roundId, teamId, decision }) {
  requireOnline("Нет подключения к интернету. Решение не отправлено.");
  const roomCode = validateCode(code);
  const uid = State.user?.uid;
  if (!uid) throw new Error("Нужно войти в аккаунт.");
  const decisionId = `${roundId}_${uid}`;
  await setDoc(doc(db, "rooms", roomCode, "captainDecisions", decisionId), {
    decisionId,
    uid,
    roundId,
    teamId,
    decision,
    at: serverTimestamp()
  }, { merge: false });
}

// Чтение решений капитанов раунда.
export async function readCaptainDecisions(code, roundId) {
  const roomCode = validateCode(code);
  const snap = await getDocs(
    query(captainDecisionsRef(roomCode), where("roundId", "==", roundId))
  );
  const decisions = [];
  snap.forEach(item => decisions.push({ id: item.id, ...item.data() }));
  return decisions;
}

// ---------- Замены: rooms/{code}/substitutions/{round}_{ts} ----------

// Подписка на все замены битвы.
export function subscribeSubstitutions(code, onData, onError) {
  const roomCode = validateCode(code);
  return onSnapshot(
    substitutionsRef(roomCode),
    snapshot => {
      const subs = [];
      snapshot.forEach(item => subs.push({ id: item.id, ...item.data() }));
      onData && onData(subs);
    },
    error => onError && onError(error)
  );
}

// Замена игрока: резервный выходит вместо действующего. Инициирует
// капитан команды или ведущий.
export async function makeSubstitution(code, { roundId, fromUid, toUid, teamId, reason = "strategy" }) {
  requireOnline("Нет подключения к интернету. Замена не выполнена.");
  const roomCode = validateCode(code);
  const uid = State.user?.uid;
  if (!uid) throw new Error("Нужно войти в аккаунт.");
  const subId = `${roundId}_${Date.now()}`;
  await setDoc(doc(db, "rooms", roomCode, "substitutions", subId), {
    subId,
    roundId,
    fromUid,
    toUid,
    teamId,
    by: uid,
    reason,
    at: serverTimestamp()
  }, { merge: false });
}

// Чтение всех замен битвы.
export async function readSubstitutions(code) {
  const roomCode = validateCode(code);
  const snap = await getDocs(substitutionsRef(roomCode));
  const subs = [];
  snap.forEach(item => subs.push({ id: item.id, ...item.data() }));
  return subs;
}

// ---------- События: rooms/{code}/events/{ts}_{type} ----------

// Подписка на события битвы (для живых обновлений).
export function subscribeEvents(code, onData, onError) {
  const roomCode = validateCode(code);
  return onSnapshot(
    query(eventsRef(roomCode), orderBy("at", "desc"), limit(100)),
    snapshot => {
      const events = [];
      snapshot.forEach(item => events.push({ id: item.id, ...item.data() }));
      onData && onData(events);
    },
    error => onError && onError(error)
  );
}

// Логирование события битвы. Пишет только ведущий (правила Firestore).
export async function logBattleEvent(code, { type, roundId = null, data = {} }) {
  requireOnline("Нет подключения к интернету. Событие не записано.");
  const roomCode = validateCode(code);
  const eventId = `${Date.now()}_${type}`;
  await setDoc(doc(db, "rooms", roomCode, "events", eventId), {
    eventId,
    type,
    roundId,
    data,
    at: serverTimestamp()
  }, { merge: false });
}

// Чтение событий битвы.
export async function readBattleEvents(code) {
  const roomCode = validateCode(code);
  const snap = await getDocs(
    query(eventsRef(roomCode), orderBy("at", "desc"), limit(100))
  );
  const events = [];
  snap.forEach(item => events.push({ id: item.id, ...item.data() }));
  return events;
}

// ---------- Поля битвы в документе игрока ----------

// Установка battle-полей участника: команда, капитан, резерв, статистика.
// Пишет только ведущий (правила Firestore).
export async function setPlayerBattleFields(code, uid, fields) {
  requireOnline("Нет подключения к интернету. Данные игрока не обновлены.");
  const roomCode = validateCode(code);
  const allowed = ["teamId", "isCaptain", "isReserve", "battleStats"];
  const update = {};
  for (const key of allowed) {
    if (key in fields) update[key] = fields[key];
  }
  update.updatedAt = serverTimestamp();
  await updateDoc(playerRef(roomCode, uid), update);
}

// Чтение battle-полей участника.
export async function getPlayerBattleFields(code, uid) {
  const roomCode = validateCode(code);
  const snap = await getDoc(playerRef(roomCode, uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    teamId: data.teamId || null,
    isCaptain: data.isCaptain || false,
    isReserve: data.isReserve || false,
    battleStats: data.battleStats || null
  };
}

// ---------- Очки битвы в документе scores ----------

// Установка battle-оценки участника. Пишет только ведущий.
export async function setBattleScore(code, uid, scoreData) {
  requireOnline("Нет подключения к интернету. Оценка не записана.");
  const roomCode = validateCode(code);
  await setDoc(scoreRef(roomCode, uid), {
    ...scoreData,
    uid,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// Чтение battle-оценки участника.
export async function getBattleScore(code, uid) {
  const roomCode = validateCode(code);
  const snap = await getDoc(scoreRef(roomCode, uid));
  return snap.exists() ? snap.data() : null;
}

// ---------- Снимок завершённой игры ----------
// Снимок битвы попадает в roomHistory/{code}.battle ОДНОЙ записью вместе с
// основным снимком Live (rules: roomHistory неизменяем, update запрещён) —
// см. buildRoomHistorySnapshot({ battle }) и core/battle-snapshot.js.
// Отдельной записи в roomHistory этот модуль не делает.

// Адаптер хранилища для core/battle-game.js (BattleGame.store).
export function createBattleStore(code) {
  const roomCode = validateCode(code);
  return {
    saveBattle: (patch) => updateBattle(roomCode, patch),
    async readVotes(roundIndex) {
      const list = await readVotes(roomCode, roundIndex);
      return Object.fromEntries(list.map(v => [v.uid, { selected: v.selected, at: v.at }]));
    },
    async readDecisions(roundIndex) {
      const list = await readCaptainDecisions(roomCode, roundIndex);
      const out = {};
      for (const d of list) out[d.teamId] = d.decision || {};
      return out;
    },
    logEvent: (event) => logBattleEvent(roomCode, { type: event.type, roundId: event.round ?? null, data: event })
  };
}
