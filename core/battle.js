// core/battle.js — Firestore-слой Skillbase Battle («Командная битва»).
// Модель хранения (см. docs/BATTLE-STORAGE.md):
//   rooms/{code}/battle/state        — один документ: настройки, команды,
//                                      раунды, очки, итоговая статистика
//   rooms/{code}/votes/{round}_{uid} — голос участника на раунд
//   rooms/{code}/captainDecisions/{round}_{uid} — решение капитана
//   rooms/{code}/substitutions/{round}_{ts}     — замена игрока
//   rooms/{code}/events/{ts}_{type}  — лог событий битвы
//   rooms/{code}/battleKeys/{qid}    — правильные варианты (только ведущий)
//   rooms/{code}/players/{uid}       — расширение: teamId, isCaptain,
//                                      isReserve, battleStats
//   rooms/{code}/scores/{uid}        — расширение: battle-оценка
//   roomHistory/{code}.battle        — снимок завершённой игры
//
// Правильные ответы НЕ хранятся в battle-документе: вопросы берутся из
// tests/{testId}, ключи — из testKeys/{testId} (restricted access),
// раскрытие — через rooms/{code}/reveals/{qid} (существующий механизм).
//
// Правила для battle, votes, captainDecisions, substitutions, events и
// battleKeys — в firestore.rules. Ключи вопросов — rooms/{code}/battleKeys
// (только ведущий); публичный battle-документ ключей не содержит.
//
// Логика расчётов — core/battle-logic.js (чистая, без Firebase/DOM).

import {
  db, doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, serverTimestamp,
  collection, query, where, orderBy, limit, writeBatch
} from "../shared/firebase.js";
import { normalizeRoomCode } from "./rooms-logic.js";
import { State } from "./auth.js";

// ---------- Утилиты ----------

function requireOnline(message) {
  if (!navigator.onLine) throw new Error(message || "Нет подключения к интернету.");
}

// Документ битвы — внутри подколлекции комнаты: rooms/{code}/battle/state.
// Путь rooms/{code}/battle (3 сегмента) — это коллекция, Firestore отклоняет
// его как «Invalid document reference» и битва не запускалась.
function battleRef(code) {
  return doc(db, "rooms", code, "battle", "state");
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

// ---------- Документ битвы: rooms/{code}/battle/state ----------

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
// один голос на пользователя на раунд (ID документа); смена голоса — перезапись
// того же документа, правила разрешают её, пока раунд в фазе голосования.
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

// Решение капитана. ID документа: "{roundId}_{uid}" — способ ответа;
// "{roundId}_tb_{uid}" — решение спорного голосования (tiebreak: true).
export async function makeCaptainDecision(code, { roundId, teamId, decision, tiebreak = false }) {
  requireOnline("Нет подключения к интернету. Решение не отправлено.");
  const roomCode = validateCode(code);
  const uid = State.user?.uid;
  if (!uid) throw new Error("Нужно войти в аккаунт.");
  const decisionId = tiebreak ? `${roundId}_tb_${uid}` : `${roundId}_${uid}`;
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

// ---------- Раунды (host-only): rooms/{code}/battleRounds/{index} ----------
// Полные записи раундов (личные ответы) нужны только ведущему: для итоговых
// оценок и восстановления после перезагрузки. Участники их не читают.

export async function saveBattleRound(code, record) {
  requireOnline("Нет подключения к интернету. Раунд не сохранён.");
  const roomCode = validateCode(code);
  const id = `${record.kind}_${record.index}`;
  await setDoc(doc(db, "rooms", roomCode, "battleRounds", id), JSON.parse(JSON.stringify(record)), { merge: false });
}

export async function loadBattleRounds(code) {
  const roomCode = validateCode(code);
  const snap = await getDocs(collection(db, "rooms", roomCode, "battleRounds"));
  const out = [];
  snap.forEach((item) => out.push(item.data()));
  return out;
}

// Ключи вопросов битвы (host-only): { [questionId]: [индексы верных] }.
export async function loadBattleKeys(code) {
  const roomCode = validateCode(code);
  const snap = await getDocs(collection(db, "rooms", roomCode, "battleKeys"));
  const out = {};
  snap.forEach((item) => { out[item.id] = item.data().correct || []; });
  return out;
}

const tsMs = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : (typeof v === "number" ? v : null));

// Адаптер хранилища для core/battle-game.js (BattleGame.store).
export function createBattleStore(code) {
  const roomCode = validateCode(code);
  return {
    saveBattle: (patch) => updateBattle(roomCode, patch),
    // Поля участника (капитан, команда, резерв) — правила разрешают ведущему в режиме битвы.
    savePlayerFields: (uid, fields) => setPlayerBattleFields(roomCode, uid, fields),
    saveRound: (record) => saveBattleRound(roomCode, record),
    loadRounds: () => loadBattleRounds(roomCode),
    async readVotes(roundIndex) {
      const list = await readVotes(roomCode, roundIndex);
      return Object.fromEntries(list.map(v => [v.uid, { selected: v.selected, at: tsMs(v.at) }]));
    },
    // Выбор способа ответа: документы "{round}_{uid}" (без "_tb_").
    async readChoices(roundIndex) {
      const list = await readCaptainDecisions(roomCode, roundIndex);
      const out = {};
      for (const d of list) {
        if (String(d.id).includes("_tb_")) continue;
        out[d.teamId] = { ...(d.decision || {}), atMs: tsMs(d.at) };
      }
      return out;
    },
    // Решения спорных голосований: "{round}_tb_{uid}".
    async readDecisions(roundIndex) {
      const list = await readCaptainDecisions(roomCode, roundIndex);
      const out = {};
      for (const d of list) if (String(d.id).includes("_tb_")) out[d.teamId] = d.decision || {};
      return out;
    },
    logEvent: (event) => logBattleEvent(roomCode, { type: event.type, roundId: event.round ?? null, data: event })
  };
}

// ---------- Запуск битвы ----------
// plan — результат buildLaunchPlan() (core/battle-launch.js).
// Два шага, потому что правила читают режим комнаты из БД, а не из батча:
//   1) rooms/{code}.mode = "battle" — отдельной записью;
//   2) battle + battleKeys + поля игроков — одним батчем (атомарно).
// Если шаг 2 не прошёл, комната уже в battle-режиме: повторный запуск
// пропускает шаг 1 и дописывает данные (все записи идемпотентны).
export async function launchBattle(code, plan) {
  requireOnline("Нет подключения к интернету. Битва не запущена.");
  const roomCode = validateCode(code);
  if (!State.user?.uid) throw new Error("Нужно войти в аккаунт.");
  if (!plan?.battle || !plan.keys || !plan.playerFields) throw new Error("План запуска не собран.");

  const roomRef = doc(db, "rooms", roomCode);
  const roomSnap = await getDoc(roomRef);
  if (!roomSnap.exists()) throw new Error("Комната не найдена.");
  const room = roomSnap.data();
  if (room.hostId !== State.user.uid) throw new Error("Запускать битву может только ведущий комнаты.");

  if (room.mode !== "battle") {
    await updateDoc(roomRef, { mode: "battle", updatedAt: serverTimestamp() });
  }

  const batch = writeBatch(db);
  batch.set(battleRef(roomCode), {
    ...plan.battle,
    key: "battle",
    orgId: room.orgId,
    hostId: State.user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: false });

  for (const k of plan.keys) {
    batch.set(doc(db, "rooms", roomCode, "battleKeys", k.id), { questionId: k.id, correct: [...k.correct] });
  }

  for (const [uid, fields] of Object.entries(plan.playerFields)) {
    batch.update(playerRef(roomCode, uid), { ...fields, updatedAt: serverTimestamp() });
  }

  await batch.commit();
}


// ---------- Снимок битвы в историю Live ----------
// История Live сохраняется при завершении теста и неизменяема; битва идёт
// позже, поэтому её снимок дописывается ОДИН раз полем battle (правило
// roomHistory: affectedKeys == ["battle"], повтор запрещён). Повторный вызов
// безопасен: если снимок уже есть, ничего не меняется.
export async function attachBattleToHistory(code, snapshot) {
  requireOnline("Нет подключения к интернету. Снимок битвы не сохранён.");
  const roomCode = validateCode(code);
  const ref = doc(db, "roomHistory", roomCode);
  const existing = await getDoc(ref);
  if (!existing.exists()) return { saved: false, reason: "no-history" };
  if (existing.data().battle) return { saved: false, reason: "exists" };
  await updateDoc(ref, { battle: snapshot });
  return { saved: true };
}


// ---------- Присутствие (ТЗ §6.1) ----------
// Игрок раз в 15 с обновляет players/{uid}.updatedAt (это поле правила уже
// разрешают владельцу). Ведущий читает метку из списка участников и по
// ней определяет окно восстановления связи (60 с).
export const BATTLE_PULSE_MS = 15 * 1000;

export async function touchPresence(code) {
  const roomCode = validateCode(code);
  const uid = State.user?.uid;
  if (!uid || (typeof navigator !== "undefined" && navigator.onLine === false)) return false;
  try {
    await updateDoc(playerRef(roomCode, uid), { updatedAt: serverTimestamp() });
    return true;
  } catch {
    return false; // обрыв связи — следующий пульс повторит
  }
}
