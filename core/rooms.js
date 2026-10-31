// core/rooms.js — Firestore-слой Live-комнат.
// Модель: rooms/{code} (пишет ведущий), rooms/{code}/players/{uid}
// (участник пишет только answers.<номер вопроса>, один раз),
// rooms/{code}/scores/{uid} и rooms/{code}/reveals/{q} (пишет только
// ведущий), rooms/{code}/observers/{uid}. Очки считает клиент ведущего
// при закрытии вопроса; правильные ответы лежат в testKeys и доходят до
// участников только через reveals после закрытия вопроса.

import {
  db, doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp,
  collection, runTransaction
} from "../shared/firebase.js";
import {
  generateRoomCode, normalizeRoomCode, isValidRoomCode,
  computeScores, buildReveal, normalizePlayerTimes,
  joinPlayerFields, SERVER_TIMESTAMP
} from "./rooms-logic.js";
import { normalizeKeys } from "./scoring.js";
import {
  LIVE_MODE_AUTO, LIVE_MODE_MANUAL, ROLE_OBSERVER, ROLE_PLAYER,
  buildAutoSettings, resolveRequestedRole, offsetFromProbe,
  bestOffset, isRegistrationOpen
} from "./live-auto.js";
import { State, isStaff } from "./auth.js";
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
// mode: "auto" (по умолчанию) или "manual"; options — настройки
// автономного режима (questionSec, gapSec, shuffleQuestions, speedBonus,
// showLeaderboard); всё необязательное, пустое берётся из настроек теста.
export async function createRoom({ test, profile, allowObservers = false, mode = LIVE_MODE_AUTO, options = {} }) {
  requireOnline("Нет подключения к интернету. Комната не создана.");
  if (!test?.id) throw new Error("Тест не выбран.");
  if (!profile?.orgId) throw new Error("Профиль организации не загружен.");
  if (test.status !== "published") {
    throw new Error("Комнату можно открыть только для опубликованного теста.");
  }
  const questions = Array.isArray(test.questions) ? test.questions : [];
  if (!questions.length) throw new Error("В тесте нет вопросов.");
  const liveMode = mode === LIVE_MODE_MANUAL ? LIVE_MODE_MANUAL : LIVE_MODE_AUTO;
  const auto = liveMode === LIVE_MODE_AUTO ? buildAutoSettings({ test, options }) : null;

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
        mode: liveMode,
        // Регистрация открыта, пока ведущий её не закроет; закрытая
        // регистрация запрещает новые players/{uid} (правила).
        registrationOpen: true,
        // Единое состояние: waiting → in_progress → completed.
        liveState: "waiting",
        // Ёмкость комнаты (MVP по умолчанию 100) + счётчик участников,
        // публикуемый ведущим с задержкой (клиентские снапшоты).
        maxPlayers: 100,
        playersCount: 0,
        currentQuestion: -1,
        currentQuestionId: "",
        phase: "idle",
        qStartedAt: null,
        // Серверные метки старта вопросов (ручной режим). В автономном
        // режиме старты считаются из autoStartedAt и расписания.
        qStarts: {},
        qDurationSec: auto
          ? auto.questionSec
          : questionDurationSec(test, test?.settings || {}),
        questionCount: questions.length,
        showLeaderboard: auto
          ? auto.showLeaderboard
          : Boolean(test?.settings?.showLeaderboard),
        ...(auto ? {
          questionSec: auto.questionSec,
          gapSec: auto.gapSec,
          order: auto.order,
          shuffleQuestions: auto.shuffleQuestions,
          speedBonus: auto.speedBonus,
          autoStartedAt: null,
          autoEndedAt: null
        } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
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
    registrationOpen: false,
    liveState: "completed",
    closedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

// Ведущий открывает/закрывает регистрацию участников.
export async function setRegistrationOpen(code, open) {
  requireOnline("Нет подключения к интернету. Регистрация не изменена.");
  const roomCode = normalizeRoomCode(code);
  if (!roomCode) throw new Error("Некорректный код комнаты.");
  await updateDoc(roomRef(roomCode), {
    registrationOpen: open === true,
    updatedAt: serverTimestamp()
  });
}

// Единственный запуск автономного теста. Транзакция гарантирует, что
// autoStartedAt выставляется ровно один раз (повторное нажатие или вторая
// вкладка ведущего получают понятную ошибку, расписание не сдвигается).
export async function startAutoTest(code) {
  requireOnline("Нет подключения к интернету. Тест не запущен.");
  const roomCode = normalizeRoomCode(code);
  if (!roomCode) throw new Error("Некорректный код комнаты.");
  const ref = roomRef(roomCode);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Комната не найдена.");
    const room = snap.data();
    if (room.mode !== LIVE_MODE_AUTO) throw new Error("Комната работает в ручном режиме.");
    if (room.status !== "active") throw new Error("Комната закрыта.");
    if (room.autoStartedAt || room.liveState === "in_progress" || room.liveState === "completed") {
      throw new Error("Тест уже запущен.");
    }
    tx.update(ref, {
      liveState: "in_progress",
      autoStartedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });
}

// Завершение автономного теста: естественное (время вышло — только
// отметка liveState) или досрочное (early: autoEndedAt — серверная метка,
// после неё правила перестают принимать ответы).
export async function finishAutoTest(code, { early = false } = {}) {
  requireOnline("Нет подключения к интернету. Тест не завершён.");
  const roomCode = normalizeRoomCode(code);
  if (!roomCode) throw new Error("Некорректный код комнаты.");
  await updateDoc(roomRef(roomCode), {
    liveState: "completed",
    registrationOpen: false,
    ...(early ? { autoEndedAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp()
  });
}

// Ведущий закрывает вопрос автономного теста: раскрывает правильный
// ответ (reveals/{позиция}). Идемпотентно: существующий reveal не
// переписывается (правила запрещают update), повторный вызов — no-op.
export async function revealAutoQuestion({ code, position, keysByPos }) {
  requireOnline("Нет подключения к интернету. Вопрос не закрыт.");
  const roomCode = normalizeRoomCode(code);
  if (!roomCode) throw new Error("Некорректный код комнаты.");
  const qid = String(position);
  const ref = doc(db, "rooms", roomCode, "reveals", qid);
  const existing = await getDoc(ref);
  if (existing.exists()) return false;
  const key = keysByPos?.[qid] || null;
  await setDoc(ref, {
    qid,
    revealedAt: serverTimestamp(),
    reveal: buildReveal(key),
    points: key?.points || 1,
    explanation: key?.explanation || ""
  }, { merge: false });
  return true;
}

// Записывает в scores переданные строки (вызывающий отбирает изменившиеся).
export async function writeScoreBoard({ code, board }) {
  requireOnline("Нет подключения к интернету. Рейтинг не обновлён.");
  const roomCode = normalizeRoomCode(code);
  if (!roomCode) throw new Error("Некорректный код комнаты.");
  for (const entry of board) {
    await setDoc(doc(db, "rooms", roomCode, "scores", entry.uid), {
      uid: entry.uid,
      name: entry.name,
      score: entry.score,
      max: entry.max,
      correctCount: entry.correctCount,
      answered: entry.answered ?? 0,
      finished: entry.finished ?? 0,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
  return board.length;
}

// Оценка смещения часов устройства относительно сервера. Пишем
// serverTimestamp() в собственный документ (игрок: players/{uid}.updatedAt,
// разрешено правилами; ведущий: updatedAt комнаты), читаем метку и берём
// пробу с наименьшим временем отклика. Номер текущего вопроса считают от
// серверного времени: часы телефона не должны влиять на расписание.
export async function syncServerClock(code, { host = false, samples = 3, onProgress = null } = {}) {
  const roomCode = normalizeRoomCode(code);
  const uid = State.user?.uid;
  if (!roomCode || !uid) return 0;
  const ref = host ? roomRef(roomCode) : doc(db, "rooms", roomCode, "players", uid);
  const results = [];
  for (let i = 0; i < samples; i++) {
    try {
      const sendMs = Date.now();
      await updateDoc(ref, { updatedAt: serverTimestamp() });
      const ackMs = Date.now();
      const snap = await getDoc(ref);
      if (snap.metadata?.fromCache) continue;
      const serverMs = toMs(snap.data()?.updatedAt);
      results.push(offsetFromProbe({ sendMs, ackMs, serverMs }));
      // Первая проба уже даёт рабочее смещение — остальные его уточняют.
      if (onProgress) onProgress(bestOffset(results));
    } catch (err) {
      // Часы не критичны для входа: без пробы остаётся смещение 0.
      console.warn("Синхронизация часов:", err?.code || err);
      break;
    }
  }
  return bestOffset(results);
}

// Вход в комнату: участник и наблюдатель пишут свой players/{uid}
// (наблюдатель пишет и observers/{uid}). Роль выбирается явно:
// role: "player" | "observer" (observer: true — прежний способ).
// Повторный вход не вызывает permission-denied и НЕ меняет роль:
// наблюдатель не превращается в участника автоматически, а время первого
// входа и роль, которые правила запрещают менять, не переписываются.
export async function joinRoom(code, { displayName, role, observer = false, profile } = {}) {
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
  // Преподаватель, не ведущий этой комнаты, входит только наблюдателем
  // (правило Firestore дублирует проверку на сервере).
  const requested = resolveRequestedRole({
    requested: role || (observer ? ROLE_OBSERVER : ROLE_PLAYER),
    isStaffUser: isStaff(),
    isHost: room.hostId === uid
  });

  // Свой документ читать можно (правила: request.auth.uid == playerId).
  const playerRef = doc(db, "rooms", roomCode, "players", uid);
  const playerSnap = await getDoc(playerRef);
  const existing = playerSnap.exists() ? playerSnap.data() : null;

  // Новые участники — только при открытой регистрации; уже вошедшие
  // возвращаются и после её закрытия (восстановление после перезагрузки).
  if (!existing && !isRegistrationOpen(room)) {
    throw new Error("Регистрация участников закрыта.");
  }
  // Лимит: счётчик публикуется ведущим с задержкой — если он отстал,
  // откажет уже правило Firestore (одна из допустимых погрешностей).
  if (!existing && requested === ROLE_PLAYER
    && (room.playersCount || 0) >= (room.maxPlayers || 100)) {
    throw new Error("Комната заполнена: участников больше не пускаем.");
  }

  // Роль не меняем при повторном входе: правило update её защищает.
  const effectiveObserver = existing
    ? (existing.role ? existing.role === ROLE_OBSERVER : existing.observer === true)
    : requested === ROLE_OBSERVER;
  const name = existing
    ? (displayName || "").trim()
    : (displayName || profile?.fullName || "");
  const fields = joinPlayerFields(existing, {
    uid,
    playerId: uid,
    name,
    observer: effectiveObserver,
    role: effectiveObserver ? ROLE_OBSERVER : ROLE_PLAYER
  });
  await setDoc(
    playerRef,
    replaceServerMarkers(fields),
    { merge: true }
  );
  if (effectiveObserver && !existing) {
    await setDoc(
      doc(db, "rooms", roomCode, "observers", uid),
      { uid, updatedAt: serverTimestamp() },
      { merge: true }
    );
  }
  return roomCode;
}

// Роль в комнате: читает собственный документ (правила разрешают).
// null — вы ещё не в комнате.
export async function getMyRoomRole(code) {
  const roomCode = normalizeRoomCode(code);
  if (!roomCode || !State.user?.uid) return null;
  const snap = await getDoc(doc(db, "rooms", roomCode, "players", State.user.uid));
  if (!snap.exists()) return null;
  const data = snap.data() || {};
  if (data.role === ROLE_OBSERVER || data.role === ROLE_PLAYER) return data.role;
  return data.observer === true ? ROLE_OBSERVER : ROLE_PLAYER;
}

// Проверка членства ДО входа: собственный players/{uid} документ
// читается правилами любому вошедшему (request.auth.uid == playerId),
// поэтому проверка безопасна и не требует прав на список участников.
// Участник определяется id документа — без чтения поля uid.
export async function isRoomMember(code) {
  const roomCode = normalizeRoomCode(code);
  if (!roomCode || !State.user?.uid) return false;
  const snap = await getDoc(doc(db, "rooms", roomCode, "players", State.user.uid));
  return snap.exists();
}

// Заменяет маркеры SERVER_TIMESTAMP на настоящую serverTimestamp().
function replaceServerMarkers(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = value === SERVER_TIMESTAMP ? serverTimestamp() : value;
  }
  return out;
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
// Ошибки подписок разделены: onRoomError (документ комнаты),
// onPlayersError (список участников), onAnswersError (ответы). Список
// участников — вспомогательные данные: его ошибка не отменяет подключение.
// answerScope: "all" — слушать ответы всех (только ведущий, правила
// не отдадут чужие ответы никому другому), "none" — не слушать.
export function subscribeRoom(code, {
  onRoom, onPlayers, onError, onRoomError, onPlayersError, onAnswersError,
  answerScope = "all"
}) {
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
    if (answerScope !== "all") return;
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
      error => (onAnswersError || onError)?.(error)
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
    error => (onRoomError || onError)?.(error)
  );
  const unsubscribePlayers = onSnapshot(
    collection(db, "rooms", roomCode, "players"),
    snapshot => {
      // uid — это id документа (правила требуют players/{uid} == auth.uid).
      // Поле uid в данных перекрывает id только мусорный legacy-документ,
      // и тогда страница не узнаёт участника («Вы не в этой комнате»).
      playersRaw = snapshot.docs.map(item => ({ ...item.data(), uid: item.id }));
      playersRaw.forEach(watchAnswers);
      unwatchGone();
      emitPlayers();
    },
    error => (onPlayersError || onError)?.(error)
  );
  return () => {
    try { unsubscribeRoom(); } catch (e) { /* уже отписаны */ }
    try { unsubscribePlayers(); } catch (e) { /* уже отписаны */ }
    answerUnsubs.forEach(unsub => { try { unsub(); } catch (e) { /* уже отписаны */ } });
    answerUnsubs.clear();
  };
}

// Собственное состояние участника: документ players/{uid} и его ответы.
// Это независимый от списка участников источник правды о членстве:
// первый снапшот собственного документа подтверждает подключение
// (клиент переходит в «waiting»), даже если список ещё не загрузился.
// Читать собственный документ и ответы правила разрешают любому
// вошедшему (request.auth.uid == playerId).
export function subscribeOwnState(code, uid, { onPlayer, onAnswers, onError }) {
  const roomCode = normalizeRoomCode(code);
  if (!roomCode) throw new Error("Некорректный код комнаты.");
  if (!uid) throw new Error("Нужно войти в аккаунт.");
  const unsubPlayer = onSnapshot(
    doc(db, "rooms", roomCode, "players", uid),
    snapshot => onPlayer && onPlayer(snapshot.exists()
      ? { ...snapshot.data(), uid: snapshot.id }
      : null),
    error => onError && onError(error)
  );
  const unsubAnswers = onSnapshot(
    collection(db, "rooms", roomCode, "players", uid, "answers"),
    snapshot => {
      const answers = {};
      const times = {};
      snapshot.docs.forEach(item => {
        answers[item.id] = (item.data() || {}).answer;
        times[item.id] = toMs((item.data() || {}).at);
      });
      if (onAnswers) onAnswers({ answers, times });
    },
    error => onError && onError(error)
  );
  return () => {
    try { unsubPlayer(); } catch (e) { /* уже отписаны */ }
    try { unsubAnswers(); } catch (e) { /* уже отписаны */ }
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
