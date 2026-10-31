// ui/pages/room.js — единый экран Live-комнат: host, player, observer
// и проектор (#room/CODE/screen — только ведущий).
// Перерисовка только при изменении сигнатуры (where правилом поля ввода
// участника не теряет фокус). Таблица лидеров живёт вне сменной
// перерисовки: так техника FLIP сравнивает позиции строк между кадрами.
import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import {
  subscribeRoom, subscribeOwnState, openQuestion, closeQuestion, saveAnswer,
  closeRoom, questionDurationSec, sendReaction, subscribeReactions,
  getMyRoomRole, startAutoTest, finishAutoTest, setRegistrationOpen,
  revealAutoQuestion, writeScoreBoard, syncServerClock
} from "../../core/rooms.js";
import {
  questionTimeMs, answeredCount, myAnswerVerdict, buildJoinUrl, computeScores
} from "../../core/rooms-logic.js";
import {
  CONN, ROLE_OBSERVER, ROLE_PLAYER, RATING_STATUS_LABEL,
  isAutoRoom, autoPlan, autoPosition, autoQStarts, roomLifecycle,
  deriveConnectionState, roleOfPlayer, questionIndexAt, keysByPosition,
  finalizablePositions, finishedPositions, ratingRows, changedScores,
  summarizeRating, questionAccuracy, isRegistrationOpen, serverNow,
  formatClockMs
} from "../../core/live-auto.js";
import { router, leaveWithHash } from "../../shared/app.js";
import {
  db, doc, getDoc, onSnapshot, collection, updateDoc, serverTimestamp
} from "../../shared/firebase.js";
import { loadPublicProfiles } from "../../core/profile.js";
import { avatarPreset } from "../../shared/avatars.js";
import { play, soundEnabled, setSoundEnabled, vibrate } from "../../shared/sound.js";
import { REACTIONS } from "../../shared/reactions.js";
import { icons } from "../../shared/icons.js";
import { toast } from "../components/toast.js";
import { generateQRSvg } from "../../shared/qr.js";

let unsubs = [];
let autoTimer = null;   // автозакрытие у ведущего (ручной режим)
let tickTimer = null;   // звук последних 5 секунд
let ticker = null;      // общий тикер: расписание, таймеры, обязанности ведущего
let connTimer = null;   // 15 с — защита от бесконечного ожидания
let onlineHandler = null;
let pageRef = null;
let leaderRef = null;
let reactionRef = null;
let floatsRef = null;
let statusRef = null;
let confettiTimer = null;
const autoClosed = new Set();
let lastSignature = null;
let lastBoardSig = null;
let lastReactionSig = null;
let local = null;

// Обратный замеченный предыдущее «событийное» состояние комнаты.
let prev = null;
// Задержки показанных реакций: uid → atMs последней показанной.
let shownReactions = new Map();
// Ранг строки (uid → индекс прошлого кадра) для значков «↑2/↓1».
let lastRanks = null;
let lastScores = null; // uid → прошлый счёт (count-up)
let lastReactionTs = 0; // локальный троттлинг отправки реакций
let profilesLoaded = false;
// Обязанности ведущего автономного режима (раскрытие ответов, рейтинг).
let dutyBusy = false;
let lastScoreSig = "";
let dutyErrorShown = false;
function reset() {
  unsubs.forEach(fn => { try { fn(); } catch (e) { /* уже отписаны */ } });
  unsubs = [];
  stopInterval(autoTimer); autoTimer = null;
  stopInterval(tickTimer); tickTimer = null;
  stopInterval(ticker); ticker = null;
  if (connTimer) { clearTimeout(connTimer); connTimer = null; }
  if (onlineHandler) {
    window.removeEventListener("online", onlineHandler);
    document.removeEventListener("visibilitychange", onlineHandler);
    onlineHandler = null;
  }
  if (confettiTimer) { clearTimeout(confettiTimer); confettiTimer = null; }
  autoClosed.clear();
  lastSignature = null;
  lastBoardSig = null;
  lastReactionSig = null;
  lastRanks = null;
  lastScores = null;
  shownReactions = new Map();
  prev = null;
  lastReactionTs = 0;
  profilesLoaded = false;
  dutyBusy = false;
  lastScoreSig = "";
  dutyErrorShown = false;
  pageRef = null;
  leaderRef = null;
  statusRef = null;
  local = {
    room: null, players: [], scores: [], reveals: {}, reactions: [],
    profiles: new Map(), test: null, keys: null, keysReady: false,
    receivedMs: 0, code: "", playersLoaded: false,
    // Независимые источники состояния подключения:
    ownPlayer: null,       // собственный документ players/{uid}
    myAnswers: {}, myTimes: {},
    memberConfirmed: false, // членство подтверждено (или это ведущий)
    roomLoaded: false,
    removed: false,
    timedOut: false,
    errors: {},            // room / own / players — ошибки подписок
    offsetMs: 0,           // смещение часов устройства до сервера
    clockReady: false
  };
}
reset();

function stopInterval(timer) {
  try { clearInterval(timer); } catch (e) { /* уже остановлен */ }
}

export function cleanup() {
  reset();
}

function toMs(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function qStartsMs(room) {
  const out = {};
  for (const qid of Object.keys((room?.qStarts || {}))) {
    const ms = toMs(room.qStarts[qid]);
    if (ms) out[qid] = ms;
  }
  return out;
}

function formatClock(remainingMs) {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function reducedMotion() {
  return typeof matchMedia === "function"
    && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Ведущий публикует счётчик участников (не наблюдателей) в room doc:
// правило players/create разрешит вход, пока playersCount < maxPlayers.
// Счётчик отстаёт на тяжести подписки — это принятая погрешность.
function publishCounter() {
  const room = local.room;
  if (role() !== "host") return;
  const players = (local.players || []).filter(p => roleOfPlayer(p) !== ROLE_OBSERVER).length;
  if (!room || room.status !== "active") return;
  if (room.playersCount != null && room.playersCount === players) return;
  updateDoc(doc(db, "rooms", local.code), {
    playersCount: players,
    updatedAt: serverTimestamp()
  }).catch(err => console.error("playersCount:", err));
}

function role() {
  if (!local.room) return null;
  const uid = State.user?.uid;
  if (isStaff() && local.room.hostId === uid) return "host";
  const own = local.ownPlayer || local.players.find(p => p.uid === uid);
  if (own) return roleOfPlayer(own) === ROLE_OBSERVER ? "observer" : "player";
  return null;
}

// Мои данные: собственный документ — главный источник (не зависит от
// списка участников), ответы приходят из собственной подписки.
function myPlayer() {
  const uid = State.user?.uid;
  if (local.ownPlayer) {
    return { ...local.ownPlayer, uid, answers: local.myAnswers, times: local.myTimes };
  }
  const listed = local.players.find(p => p.uid === uid);
  return listed ? { ...listed, answers: { ...(listed.answers || {}), ...local.myAnswers } } : null;
}

// Серверное время: часы устройства + оценённое смещение.
function serverNowMs() {
  return serverNow(local.offsetMs, Date.now());
}

// Единое «живое» состояние комнаты, одинаковое для всех устройств.
// Автономный режим: позиция вопроса вычисляется из серверных меток и
// серверного времени, а не хранится и не ставится локальным таймером.
function liveInfo() {
  const room = local.room;
  const empty = { auto: false, lifecycle: null, phase: "idle", legacyPhase: "idle",
    position: -1, qid: "", msLeft: null, plan: null };
  if (!room) return empty;
  const nowMs = serverNowMs();
  const lifecycle = roomLifecycle(room, nowMs);
  if (!isAutoRoom(room)) {
    const left = (() => {
      if (room.phase !== "opened") return null;
      const started = questionTimeMs(room.qStartedMs, local.receivedMs);
      const duration = questionDurationSec(local.test, room.settings);
      return duration ? started + duration * 1000 - Date.now() : null;
    })();
    return { auto: false, lifecycle, phase: room.phase, legacyPhase: room.phase,
      position: Number(room.currentQuestionId), qid: String(room.currentQuestionId ?? ""),
      msLeft: left, plan: null };
  }
  const plan = autoPlan(room);
  const pos = autoPosition(plan, nowMs);
  let phase = pos.phase;
  let position = pos.position;
  if (lifecycle === "completed" || lifecycle === "closed") {
    phase = "done";
    position = Math.max(-1, plan.count - 1);
  }
  const legacyPhase = phase === "question" ? "opened"
    : phase === "gap" ? "closed"
    : phase === "done" ? "done" : "idle";
  return {
    auto: true, lifecycle, phase, legacyPhase, position,
    qid: position >= 0 ? String(position) : "",
    msLeft: phase === "question" || phase === "gap" ? pos.msLeft : null,
    plan
  };
}

// Вопрос теста для позиции (в автономном режиме порядок может быть
// случайным: order[позиция] → индекс вопроса).
function questionFor(position) {
  const questions = local.test?.questions || [];
  const idx = isAutoRoom(local.room) ? questionIndexAt(local.room, Number(position)) : Number(position);
  return questions[idx] || null;
}

function connState() {
  return deriveConnectionState({
    error: local.errors.room || local.errors.own || null,
    memberConfirmed: local.memberConfirmed,
    roomLoaded: local.roomLoaded,
    room: local.room,
    nowMs: serverNowMs(),
    timedOut: local.timedOut
  });
}

function signature() {
  const room = local.room;
  const li = liveInfo();
  const my = myPlayer();
  const myAnswer = li.qid !== "" ? my?.answers?.[li.qid] : null;
  const revealId = li.legacyPhase === "closed" && li.qid !== ""
    ? (local.reveals?.[li.qid] ? "on" : "off")
    : "-";
  const answers = (local.players || [])
    .filter(p => roleOfPlayer(p) !== ROLE_OBSERVER)
    .map(p => `${String(p.uid).slice(0, 6)}:${Object.keys(p.answers || {}).length}`)
    .sort()
    .join(",");
  const ids = (local.players || []).map(p => String(p.uid).slice(0, 6)).sort().join(",");
  const me = role();
  // Игрок, который отвечает на вопрос: не перерисовываем из-за чужих
  // данных — поле ввода не должно терять текст и фокус.
  const typing = me === "player" && li.phase === "question" && myAnswer == null;
  const crowd = typing ? "-" : [
    String(local.players.length), `ids=${ids}`, `answers=${answers}`,
    `scores=${(local.scores || []).map(s => `${String(s.uid).slice(0, 6)}:${s.score}:${s.finished ?? 0}`).sort().join(",")}`,
    `reveals=${Object.keys(local.reveals || {}).length}`
  ].join("~");
  return [
    room ? room.status : "no-room",
    connState(),
    `live=${li.lifecycle}:${li.position}:${li.phase}`,
    String(room?.currentQuestionId ?? ""),
    String(room?.phase ?? ""),
    String(room?.qStartedMs ?? ""),
    `reg=${room?.registrationOpen === false ? 0 : 1}`,
    `clock=${local.clockReady ? 1 : 0}`,
    `crowd=${crowd}`,
    `reveal=${revealId}`,
    `me=${myAnswer != null ? 1 : 0}`,
    `role=${me}`,
    `removed=${local.removed ? 1 : 0}`,
    `test=${local.test ? 1 : 0}`,
    `keys=${local.keysReady ? 1 : 0}`
  ].join("|");
}

// Оставшееся время открытого вопроса в мс (или null, если не ограничено).
function openMsLeft() {
  const li = liveInfo();
  if (li.auto) return li.phase === "question" ? li.msLeft : null;
  return li.phase === "opened" ? li.msLeft : null;
}

// ---------- Загрузка данных ----------

// ---------- Загрузка данных ----------

async function probeRoom(codeRaw) {
  const code = String(codeRaw || "").toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return null;
  const snap = await getDoc(doc(db, "rooms", code));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function loadTestPublic(testId) {
  const snap = await getDoc(doc(db, "tests", testId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function loadKeys(testId) {
  try {
    const snap = await getDoc(doc(db, "testKeys", testId));
    if (snap.exists()) {
      const data = snap.data();
      return data.items || data.keys || null;
    }
  } catch (err) {
    console.error("testKeys:", err);
  }
  return null;
}

function soundToggle() {
  const btn = h("button", {
    type: "button",
    class: "btn icon-btn room-sound-btn",
    "aria-pressed": String(soundEnabled()),
    title: soundEnabled() ? "Выключить звук" : "Включить звук",
    "aria-label": soundEnabled() ? "Выключить звук" : "Включить звук"
  }, soundEnabled() ? "🔊" : "🔇");
  btn.addEventListener("click", () => {
    const on = setSoundEnabled(!soundEnabled());
    btn.textContent = on ? "🔊" : "🔇";
    btn.setAttribute("aria-pressed", String(on));
    btn.title = btn["aria-label"] = on ? "Выключить звук" : "Включить звук";
    if (on) play("start");
  });
  return btn;
}

async function loadProfiles(orgId) {
  if (profilesLoaded || !local.room?.orgId && !orgId) return;
  const uids = (local.players || []).map(p => p.uid);
  if (!uids.length) return;
  profilesLoaded = true;
  try {
    const profiles = await loadPublicProfiles(uids, local.room?.orgId || orgId);
    profiles.forEach(p => local.profiles.set(p.id, p));
  } catch (err) {
    console.error("Аватары участников:", err);
    profilesLoaded = false;
  }
}

// Ошибка подписки: запоминаем по источнику (room / own / players /
// scores…) и показываем тост один раз на источник. Ошибка списка
// участников НЕ переводит клиента в connection_error.
const shownErrors = new Set();
function setError(source, error) {
  console.error(`Комната (${source}):`, error);
  local.errors[source] = error || { code: "error" };
  if (shownErrors.has(source)) return;
  shownErrors.add(source);
  const text = error?.code === "permission-denied"
    ? `Правила Firestore не пускают (${source}): permission-denied.`
    : `Нет связи с комнатой (${source}: ${error?.code || "ошибка"}).`;
  toast(text, "error");
}
function clearError(source) {
  if (local.errors[source]) delete local.errors[source];
  shownErrors.delete(source);
}

function decorateRoom(room) {
  return room ? { ...room, qStartedMs: toMs(room.qStartedAt) } : null;
}

export default async function RoomPage() {
  shownErrors.clear();
  const rawRoute = decodeURIComponent((State.routeParam || ""));
  const parts = rawRoute.split("/");
  const codeRaw = parts[0] || "";
  const isScreen = parts[1] === "screen";
  const page = h("div", {
    class: "page room-page" + (isScreen ? " room-screen-page" : "")
  });

  // ---------- 1. Комната и тест (разовое чтение) ----------
  let code = "";
  try {
    const probe = await probeRoom(codeRaw);
    if (!probe) {
      page.appendChild(notFoundPanel());
      return page;
    }
    code = probe.id;
    local.code = code;
    local.room = decorateRoom({ ...probe, id: probe.id });
    local.roomLoaded = true;
    local.test = await loadTestPublic(probe.testId);
    if (probe.hostId === State.user?.uid && isStaff()) {
      local.keys = await loadKeys(probe.testId);
      local.keysReady = Boolean(local.keys && Object.keys(local.keys).length);
    }
  } catch (err) {
    console.error("Комната:", err);
    page.appendChild(connectionErrorPanel(err));
    return page;
  }

  // Экран проектора: только ведущий.
  if (isScreen && role() !== "host") {
    page.appendChild(h("div", { class: "panel" },
      h("div", { class: "empty-state" },
        h("h2", {}, "Экран доступен только ведущему"),
        h("p", { class: "muted" }, "Откройте страницу под учётной записью ведущего комнаты."),
        h("a", { class: "btn secondary", href: "#/" }, "На главную"))
    ));
    return page;
  }

  // ---------- 2. Членство: собственный документ, без списка ----------
  // Чтение своего players/{uid} разрешено правилами напрямую. Подтверждённое
  // членство сразу даёт роль и состояние «waiting» — полный список
  // участников грузится отдельно и ни от чего здесь не зависит.
  const isHost = role() === "host";
  if (isHost) {
    local.memberConfirmed = true;
  } else {
    let myRole = null;
    try {
      myRole = await getMyRoomRole(code);
    } catch (err) {
      console.error("Членство:", err);
      page.appendChild(connectionErrorPanel(err));
      return page;
    }
    if (!myRole) {
      if (local.room?.status !== "active") {
        page.appendChild(closedRoomPanel());
        return page;
      }
      // Роль выбирается на экране входа: тихого автоподключения нет
      // (наблюдатель не должен превращаться в участника и наоборот).
      page.appendChild(redirectToJoinPanel(code));
      leaveWithHash(`#join/${code}`);
      return page;
    }
    local.ownPlayer = {
      uid: State.user.uid, role: myRole, observer: myRole === ROLE_OBSERVER
    };
    local.memberConfirmed = true;
  }

  // ---------- 3. Независимые подписки ----------
  const wake = () => {
    if (!local || local.code !== code) return;
    onStateUpdate(page, isScreen);
    scheduleRender(page);
  };

  // 15 секунд — только защита от бесконечного ожидания: таймаут не
  // подтверждает подключение (см. deriveConnectionState).
  connTimer = setTimeout(() => {
    connTimer = null;
    if (!(local.memberConfirmed && local.roomLoaded)) { local.timedOut = true; wake(); }
  }, 15000);

  // Комната.
  unsubs.push(subscribeRoom(code, {
    answerScope: isHost ? "all" : "none",
    onRoom: room => {
      if (room) {
        local.room = decorateRoom(room);
        local.roomLoaded = true;
      }
      local.receivedMs = Date.now();
      clearError("room");
      wake();
    },
    onPlayers: players => {
      local.players = players;
      local.playersLoaded = true;
      clearError("players");
      loadProfiles().catch(err => console.error(err));
      wake();
      publishCounter();
    },
    onRoomError: error => { setError("room", error); wake(); },
    onPlayersError: error => {
      // Список вторичен: показываем, что он недоступен, но остаёмся в комнате.
      setError("players", error);
      local.playersLoaded = true;
      wake();
    },
    onAnswersError: error => console.warn("Ответы участников:", error?.code || error)
  }));

  // Собственный документ и ответы (участник и наблюдатель).
  if (!isHost) {
    unsubs.push(subscribeOwnState(code, State.user.uid, {
      onPlayer: player => {
        if (player) {
          local.ownPlayer = player;
          local.memberConfirmed = true;
          local.removed = false;
          clearError("own");
        } else if (!isHost) {
          // Документ удалён (ведущий убрал участника).
          local.removed = true;
        }
        wake();
      },
      onAnswers: ({ answers, times }) => {
        local.myAnswers = { ...answers };
        local.myTimes = times;
        wake();
      },
      onError: error => { setError("own", error); wake(); }
    }));
  }

  unsubs.push(onSnapshot(
    collection(db, "rooms", code, "scores"),
    snapshot => {
      // uid — id документа (правила: scores/{uid}); поле в данных не доверяем.
      local.scores = snapshot.docs.map(item => ({ ...item.data(), uid: item.id }));
      wake();
    },
    error => { setError("scores", error); }
  ));

  unsubs.push(onSnapshot(
    collection(db, "rooms", code, "reveals"),
    snapshot => {
      local.reveals = {};
      snapshot.docs.forEach(item => { local.reveals[item.id] = item.data(); });
      wake();
    },
    error => { setError("reveals", error); }
  ));

  // Реакции: свои шлём кнопками, чужие показываем всплывающими эмодзи.
  unsubs.push(subscribeReactions(
    code,
    reactions => { local.reactions = reactions; wake(); },
    error => { setError("reactions", error); }
  ));

  // ---------- 4. Синхронизация часов и восстановление связи ----------
  const runClockSync = () => {
    if (!isAutoRoom(local.room)) { local.clockReady = true; return; }
    syncServerClock(code, {
      host: isHost,
      samples: 3,
      onProgress: offset => { local.offsetMs = offset; local.clockReady = true; wake(); }
    })
      .catch(err => console.warn("Часы:", err?.code || err))
      // Без пробы остаётся смещение 0 (часы устройства): лучше так, чем вечное ожидание.
      .finally(() => { local.clockReady = true; wake(); });
  };
  runClockSync();

  // Возврат сети/вкладки: SDK сам возобновляет живые подписки; мёртвые
  // (завершённые ошибкой) пересоздаются перезагрузкой страницы комнаты.
  onlineHandler = () => {
    if (document.visibilityState === "hidden") return;
    if (Object.keys(local.errors).length || connState() === CONN.ERROR) {
      router();
      return;
    }
    runClockSync();
  };
  window.addEventListener("online", onlineHandler);
  document.addEventListener("visibilitychange", onlineHandler);

  // Тикер: расписание автономного режима, таймеры, обязанности ведущего.
  ticker = setInterval(() => {
    if (!local || local.code !== code) return;
    onStateUpdate(page, isScreen);
    scheduleRender(page);
    updateLiveTexts();
    hostAutoDuties();
  }, 500);

  if (!isScreen) {
    statusRef = h("div", { class: "room-status", role: "status" });
    page.appendChild(statusRef);
  }
  const leaderHost = h("section", { class: "room-leaderboard-host", "aria-label": "Таблица результатов" });
  const reactionBar = h("div", { class: "room-reaction-bar" });
  const floats = h("div", { class: "room-reaction-floats", "aria-hidden": "true" });
  page.appendChild(leaderHost);
  page.appendChild(reactionBar);
  page.appendChild(floats);
  leaderRef = leaderHost;
  reactionRef = reactionBar;
  floatsRef = floats;
  scheduleRender(page);
  return page;
}

// ---------- Обязанности ведущего автономного режима ----------
// Расписание вопросов не требует ведущего (оно вычисляется из серверного
// времени, ответы принимают правила Firestore). Но раскрытие правильных
// ответов (reveals) и подсчёт очков (scores) пишет только ведущий: ключи
// ответов лежат в testKeys, доступных лишь сотрудникам. Если страница
// ведущего закрыта, тест продолжается, а очки и ответы «догоняются», как
// только ведущий вернётся — пересчёт идемпотентен.
function scoreSignature(plan, nowMs) {
  const finished = finishedPositions(plan, nowMs).length;
  const answers = (local.players || [])
    .map(p => `${p.uid}:${Object.keys(p.answers || {}).length}`).sort().join(",");
  return `${finished}|${answers}|${local.scores.length}`;
}

async function hostAutoDuties() {
  const room = local.room;
  if (dutyBusy || !room || role() !== "host" || !isAutoRoom(room)) return;
  if (room.status !== "active" || !room.autoStartedAt || !local.keysReady) return;
  if (!navigator.onLine) return;
  const nowMs = serverNowMs();
  const plan = autoPlan(room);
  const todo = finalizablePositions({ plan, nowMs, reveals: local.reveals || {} });
  const lifecycle = roomLifecycle(room, nowMs);
  const needComplete = lifecycle === "completed" && room.liveState !== "completed";
  const sig = scoreSignature(plan, nowMs);
  const scoresDirty = sig !== lastScoreSig && finishedPositions(plan, nowMs).length > 0;
  if (!todo.length && !needComplete && !scoresDirty) return;

  dutyBusy = true;
  try {
    const keysByPos = keysByPosition(local.keys, room);
    for (const position of todo) {
      await revealAutoQuestion({ code: local.code, position, keysByPos });
    }
    // Очки пересчитываются с нуля по всем завершённым вопросам.
    const speed = room.speedBonus === false
      ? null
      : { qDurationSec: plan.questionSec, qStarts: autoQStarts(plan) };
    const board = computeScores(local.players, keysByPos, finishedPositions(plan, nowMs), speed);
    const changed = changedScores(local.scores, board);
    if (changed.length) await writeScoreBoard({ code: local.code, board: changed });
    lastScoreSig = sig;
    if (needComplete) await finishAutoTest(local.code);
    dutyErrorShown = false;
  } catch (err) {
    console.error("Автономный режим (ведущий):", err);
    if (!dutyErrorShown) {
      dutyErrorShown = true;
      toast("Не удалось обновить ответы или рейтинг — повторю автоматически.", "error");
    }
  } finally {
    dutyBusy = false;
  }
}

// Обновление таймеров «на месте», без перерисовки (поле ответа не теряет фокус).
function updateLiveTexts() {
  const page = pageRef;
  if (!page) return;
  const li = liveInfo();
  page.querySelectorAll("[data-live-clock]").forEach(el => {
    el.textContent = li.msLeft == null ? "" : formatClockMs(li.msLeft);
  });
  page.querySelectorAll("[data-live-bar]").forEach(el => {
    const plan = li.plan;
    if (!plan || li.msLeft == null) { el.style.width = "0%"; return; }
    const total = li.phase === "question" ? plan.questionMs : plan.gapMs;
    el.style.width = `${Math.max(0, Math.min(100, (1 - li.msLeft / total) * 100))}%`;
  });
}

// ---------- Каркас ----------

function statusText() {
  const room = local.room;
  const li = liveInfo();
  const total = room?.questionCount || "?";
  let text;
  if (!room) text = "Ждём комнату…";
  else if (li.lifecycle === "closed") text = "Комната закрыта";
  else if (li.auto) {
    text = li.lifecycle === "waiting" ? "Ожидание начала теста"
      : li.lifecycle === "completed" ? "Тест завершён"
      : li.phase === "question" ? `Вопрос ${li.position + 1} из ${total}`
      : `Пауза · вопрос ${li.position + 1} из ${total}`;
  } else {
    text = room.phase === "idle" ? "Ожидание первого вопроса"
      : room.phase === "opened" ? `Вопрос ${Number(room.currentQuestionId) + 1} из ${total}`
      : "Вопрос закрыт";
  }
  const who = role();
  const suffix = who === "host" ? " · вы ведущий"
    : who === "observer" ? " · вы наблюдатель"
    : who === "player" ? " · вы участник" : "";
  const offline = typeof navigator !== "undefined" && navigator.onLine === false ? " · нет связи" : "";
  return text + suffix + offline;
}

function fillStatusBar() {
  if (!statusRef) return;
  statusRef.textContent = "";
  statusRef.append(statusText(), soundToggle());
}

function scheduleRender(page) {
  if (page) pageRef = page;
  const target = page || pageRef;
  const sig = signature();
  if (sig !== lastSignature) {
    lastSignature = sig;
    if (target) renderPage(target);
    manageAutoClose();
  }
  fillStatusBarIfChanged();
  updateLeaderboard();
  updateReactionBar();
  showFloats();
  ensureTickTimer();
}

let lastStatusText = "";
function fillStatusBarIfChanged() {
  const text = statusText();
  if (text === lastStatusText && statusRef?.childNodes.length) return;
  lastStatusText = text;
  fillStatusBar();
}

function renderPage(page) {
  const existing = page.querySelector(".room-view");
  const next = buildView();
  if (existing) existing.replaceWith(next);
  else page.insertBefore(next, page.querySelector(".room-leaderboard-host"));
  updateLeaderboard();
  updateLiveTexts();
}

// Снапшоты → события (звуки, вибрация, вспышки) → реакция на статусы.
function onStateUpdate(page, isScreen) {
  const room = local.room;
  const li = liveInfo();
  // Фаза и номер вопроса — из единого состояния (в автономном режиме
  // они вычисляются из серверного времени, а не читаются из документа).
  const now = { status: room?.status || "", phase: li.legacyPhase, qid: li.qid, life: li.lifecycle };
  const ids = (local.players || []).map(p => p.uid).sort().join(",");
  const myRank = rankOf(myPlayer()?.uid);
  const reveal = li.legacyPhase === "closed" ? local.reveals?.[now.qid] : null;
  const mine = myPlayer()?.answers?.[now.qid];

  if (prev) {
    const oldIds = prev.ids.split(",").filter(Boolean);
    const newIds = ids.split(",").filter(Boolean);
    // Вход в комнату: у кого-то (включая меня) появился uid.
    if (newIds.some(uid => !oldIds.includes(uid))) {
      play("join");
    }
    // Начало вопроса.
    if (now.phase === "opened" && now.qid && prev.qid !== now.qid) {
      play("start");
    }
    // Верность моего ответа: только когда вопрос закрылся и есть reveal.
    if (reveal && !prev.reveal) {
      const verdict = myAnswerVerdict(reveal, mine);
      if (verdict === true) {
        play("correct"); vibrate("correct"); flash(page, "room-flash-correct");
      } else if (verdict === false) {
        play("wrong"); vibrate("wrong"); flash(page, "room-flash-wrong", true);
      }
    }
    // Подъём моего места.
    if (myRank != null && prev.rank != null && myRank < prev.rank) {
      play("up");
    }
    // Финал комнаты.
    const finishedNow = room?.status === "closed" && prev.status === "active"
      || (li.auto && now.life === "completed" && prev.life === "in_progress");
    if (finishedNow) {
      play("final");
      runConfetti(page);
    }
  }
  prev = { ...now, ids, reveal: Boolean(reveal), rank: myRank, status: room?.status || "" };
}

// rankOf: место моего uid в таблице (по очкам).
function rankOf(uid) {
  if (!uid || !local.scores?.length) return null;
  const sorted = [...local.scores].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const index = sorted.findIndex(row => row.uid === uid);
  return index === -1 ? null : index + 1;
}

// Мой ответ верен? — myAnswerVerdict из core/rooms-logic.js.

function flash(page, className, shake = false) {
  if (!page || reducedMotion()) return;
  page.classList.remove("room-flash-correct", "room-flash-wrong", "room-shake");
  requestAnimationFrame(() => {
    page.classList.add(className);
    if (shake) page.classList.add("room-shake");
    setTimeout(() => {
      page.classList.remove("room-flash-correct", "room-flash-wrong", "room-shake");
    }, 700);
  });
}

// Тик последних 5 секунд — только если вопрос ограничен по времени.
function ensureTickTimer() {
  const left = openMsLeft();
  if (left === null) {
    if (tickTimer) { stopInterval(tickTimer); tickTimer = null; }
    return;
  }
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    const remaining = openMsLeft();
    if (remaining === null) { stopInterval(tickTimer); tickTimer = null; return; }
    if (remaining > 0 && Math.ceil(remaining / 1000) <= 5) play("tick");
  }, 1000);
}

// ---------- Реакции ----------

function isScreenRoute() {
  return decodeURIComponent((State.routeParam || "")).split("/")[1] === "screen";
}

function updateReactionBar() {
  const bar = reactionRef;
  if (!bar) return;
  // Перестраиваем кнопки только при смене состояния: тикер вызывает
  // функцию дважды в секунду, а нажатие не должно теряться.
  const sig = `${isScreenRoute()}|${role()}|${local.room?.status}`;
  if (sig === lastReactionSig) return;
  lastReactionSig = sig;
  bar.hidden = isScreenRoute();
  bar.textContent = "";
  const whose = role();
  if (!whose || !local.room || local.room.status === "closed") return;
  bar.appendChild(h("span", { class: "room-reaction-label" }, "Реакция:"));
  REACTIONS.forEach(emoji => {
    bar.appendChild(h("button", {
      type: "button",
      class: "room-reaction-btn",
      "aria-label": `Реакция ${emoji}`,
      onclick: () => {
        const at = Date.now();
        if (at - lastReactionTs < 1100) return; // правила требуют > 1 с
        lastReactionTs = at;
        sendReaction(local.code, emoji).catch(err => {
          console.error("Реакция:", err);
          toast("Реакцию не отправили (не чаще раза в секунду)", "error");
        });
      }
    }, emoji));
  });
}

// Всплывающие эмодзи: показываем только новые (uid с новым at).
function showFloats() {
  const host = floatsRef;
  if (!host) return;
  for (const item of local.reactions || []) {
    const atMs = item.atMs || 0;
    if (atMs <= (shownReactions.get(item.uid) || 0)) continue;
    shownReactions.set(item.uid, atMs);
    const el = h("span", { class: "room-float-emoji" }, item.emoji || "👍");
    el.style.left = `${30 + Math.abs(hashUid(item.uid)) % 40}%`;
    host.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }
}

function hashUid(uid) {
  let acc = 0;
  for (const ch of String(uid)) acc = (acc * 31 + ch.charCodeAt(0)) | 0;
  return acc;
}

// ---------- Таблица лидеров: FLIP, place badge, count-up ----------

function boardRows() {
  return [...(local.scores || [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)
    || String(a.name).localeCompare(String(b.name), "ru"));
}

function leaderSignature(rows) {
  return rows.map((row, index) =>
    `${row.uid}:${index}:${row.score ?? 0}:${row.correctCount ?? 0}`).join(",");
}

function updateLeaderboard() {
  const host = leaderRef;
  if (!host) return;
  // На проекторе таблица построена в screenView — здесь не дублируем.
  if (isScreenRoute()) return;
  // Автономный режим: общий рейтинг — часть самого вида (ratingPanel).
  if (isAutoRoom(local.room)) {
    if (host.textContent) host.textContent = "";
    host.classList.add("room-leaderboard-empty");
    lastBoardSig = null;
    return;
  }
  const room = local.room;
  const roleHere = role();

  // Участнику таблица — только по настройке теста showLeaderboard.
  const rows = Boolean(room)
    && (roleHere !== "player" || room.showLeaderboard === true)
    ? boardRows()
    : [];
  if (!rows.length) {
    host.classList.add("room-leaderboard-empty");
    if (host.textContent) host.textContent = "";
    lastBoardSig = null;
    lastRanks = null;
    return;
  }
  host.classList.remove("room-leaderboard-empty");
  const sig = leaderSignature(rows);
  if (host.querySelector("table") && sig === lastBoardSig) return;

  // FLIP: запомнить позиции ДО перерисовки.
  const oldRects = new Map();
  host.querySelectorAll("tr[data-uid]").forEach(row => {
    oldRects.set(row.getAttribute("data-uid"), row.getBoundingClientRect());
  });
  const oldRanks = oldRanksMap(host);
  const oldScores = lastScores || new Map();

  // Перерисовка.
  host.textContent = "";
  const table = h("table", { class: "table room-leader-table" },
    h("thead", {}, h("tr", {},
      h("th", {}, "#"), h("th", {}, "Участник"),
      h("th", {}, "Верно"), h("th", {}, "Баллы"))),
    h("tbody", {})
  );
  const newRanks = new Map();
  rows.forEach((row, index) => {
    newRanks.set(row.uid, index + 1);
    table.querySelector("tbody").appendChild(leaderRow(row, index, oldRanks, oldScores));
  });
  host.appendChild(table);
  lastBoardSig = sig;
  lastRanks = newRanks;
  lastScores = new Map(rows.map(row => [row.uid, row.score ?? 0]));

  animateFlip(host, oldRects);
}

function leaderRow(entry, index, oldRanks, oldScores) {
  const oldRank = oldRanks?.get(entry.uid);
  const delta = typeof oldRank === "number" ? oldRank - (index + 1) : 0;
  const rankCell = h("td", {},
    String(index + 1),
    delta !== 0 && !reducedMotion()
      ? h("span", { class: "leader-move" }, delta > 0 ? `↑${delta}` : `↓${-delta}`)
      : null);
  // Столбец очков: count-up от предыдущего значения.
  const oldScore = oldScores.get(entry.uid);
  const targetScore = entry.score ?? 0;
  const scoreCell = h("td", { class: "leader-score" }, "");
  if (typeof oldScore === "number" && oldScore !== targetScore && !reducedMotion()) {
    scoreCell.appendChild(countUp(targetScore, oldScore, entry.max ?? 0));
  } else {
    scoreCell.textContent = `${targetScore} из ${entry.max ?? 0}`;
  }
  return h("tr", { "data-uid": entry.uid },
    rankCell,
    h("td", {}, avatarChip(entry), h("b", {}, entry.name || "Участник")),
    h("td", {}, `${entry.correctCount ?? 0}`),
    scoreCell
  );
}

function countUp(target, from, max) {
  const span = h("span", { class: "score-countup" }, `${from} из ${max}`);
  const start = performance.now();
  const dur = 600;
  const step = (at) => {
    const progress = Math.min(1, (at - start) / dur);
    span.textContent = `${Math.round(from + (target - from) * progress)} из ${max}`;
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  setTimeout(() => { span.textContent = `${target} из ${max}`; }, dur + 50);
  return span;
}

function oldRanksMap(host) {
  const out = new Map();
  let index = 0;
  host.querySelectorAll("tr[data-uid]").forEach(row => {
    out.set(row.getAttribute("data-uid"), ++index);
  });
  return out;
}

// FLIP: строки поменялись местами — старые позиции к новым прыгают
// плавным transform 600 мс.
function animateFlip(host, oldRects) {
  if (reducedMotion() || !oldRects.size) return;
  const rows = host.querySelectorAll("tr[data-uid]");
  rows.forEach(row => {
    const uid = row.getAttribute("data-uid");
    const beforeRect = oldRects.get(uid);
    if (!beforeRect) return;
    const afterRect = row.getBoundingClientRect();
    const delta = beforeRect.top - afterRect.top;
    if (Math.abs(delta) < 1) return;
    row.style.transition = "none";
    row.style.transform = `translateY(${delta}px)`;
    requestAnimationFrame(() => {
      row.style.transition = "transform 600ms ease";
      row.style.transform = "";
    });
  });
}

// ---------- Аватары ----------
// ---------- QR-код комнаты ----------

// Ссылка входа в комнату для участников: #join/<код> — ссылка
// приглашения из QR. Авторизованного пользователя она подключает
// автоматически (join.js), гостя ведёт на форму имя+аватар.
// Формирует buildJoinUrl в core/rooms-logic.js — единственный
// механизм для карточки ведущего, проектора и мини-QR.
function joinUrl(code) {
  return buildJoinUrl(code);
}

// Настройки QR-кода для Live-комнат (фирменные цвета Skillbase)
const roomQROptions = {
  width: 280,
  height: 280,
  ecc: "H",
  rounded: true,
  dark: "#172817",        // тёмно-зелёные модули
  light: "#F5F7ED",       // светлый фон QR
  finderDark: "#101810"   // ещё более тёмные маркеры
}

// Рисует SVG QR-кода внутрь элемента. size — сторона в px: один механизм
// генерации, разные размеры (карточка ведущего, проектор, мини-QR).
function paintQR(box, code, size = 280) {
  if (!box || !code) return;
  try {
    box.innerHTML = generateQRSvg(joinUrl(code), {
      ...roomQROptions,
      width: size,
      height: size
    });
  } catch (err) {
    console.error("QR generation failed:", err);
  }
}

// root — собранный, но ещё не вставленный в документ вид: искать в
// document нельзя (там осталась бы прошлая версия вида).
async function initRoomQR(room, root) {
  const qrWrapper = root.querySelector('.room-qr-card .qr-wrapper');
  const copyBtn = root.querySelector('#copy-link');
  const downloadBtn = root.querySelector('#download-qr');

  if (!qrWrapper || !copyBtn || !downloadBtn) return;

  const url = joinUrl(room.code);
  // Размер задаёт карточка ведущего (компактный 160 / крупный 280);
  // ссылка и генерация общие с режимом проектора.
  paintQR(qrWrapper, room.code, Number(qrWrapper.dataset.qrSize || 280));

  // Копирование ссылки.
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast("Ссылка скопирована", "success");
    } catch (err) {
      toast("Не удалось скопировать ссылку", "error");
    }
  });

  // Скачивание QR-кода как PNG через Canvas (для соответствия дизайну и Android)
  downloadBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const svg = qrWrapper.querySelector('svg');
    if (!svg) {
      toast("QR-код ещё не готов", "error");
      return;
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const blobUrl = URL.createObjectURL(svgBlob);

    img.onload = () => {
      const exportSize = 1024;
      canvas.width = exportSize;
      canvas.height = exportSize;
      ctx.fillStyle = "#F5F7ED";
      ctx.fillRect(0, 0, exportSize, exportSize);
      ctx.drawImage(img, 0, 0, exportSize, exportSize);

      try {
        const pngUrl = canvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.href = pngUrl;
        link.download = `room-${room.code}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (err) {
        console.error("PNG export failed:", err);
        toast("Не удалось сохранить PNG", "error");
      }
      URL.revokeObjectURL(blobUrl);
    };
    img.src = blobUrl;
  });
}

// ---------- Аватары ----------

function avatarChip(entry) {
  const profile = local.profiles.get(entry.uid);
  // Гость не имеет publicProfiles — аватар берём из его players-документа.
  const preset = avatarPreset(profile?.avatar || entry.avatar);
  if (preset) {
    return h("span", {
      class: "avatar-chip",
      style: `background:${preset.bg}`,
      "aria-hidden": "true"
    }, preset.emoji);
  }
  return h("span", { class: "avatar-chip avatar-chip-fallback", "aria-hidden": "true" },
    (entry.name || "У").trim().slice(0, 1).toUpperCase() || "?");
}

// ---------- Подиум и конфетти ----------

function livePodium() {
  const room = local.room;
  if (!room || room.status !== "active") return null;
  
  // Показываем топ-3 в реальном времени для наблюдателей
  // или если в настройках включена таблица лидеров
  const roleHere = role();
  if (roleHere !== "observer" && room.showLeaderboard !== true) return null;

  const rows = boardRows().slice(0, 3);
  if (!rows.length) return null;

  const medals = ["🥇", "🥈", "🥉"];
  return h("div", { class: "room-live-podium" },
    h("div", { class: "podium-grid" },
      rows.map((row, index) => h("div", { class: `podium-item podium-${index + 1}` },
        h("div", { class: "podium-medal" }, medals[index]),
        avatarChip(row),
        h("div", { class: "podium-info" },
          h("div", { class: "podium-name" }, row.name || "Участник"),
          h("div", { class: "podium-score" }, `${row.score ?? 0} б.`)
        )
      ))
    )
  );
}

function podiumPanel() {
  const rows = boardRows().slice(0, 3);
  if (!rows.length) return null;
  const medals = ["🥇", "🥈", "🥉"];
  const heights = ["podium-first", "podium-second", "podium-third"];
  return h("div", { class: "panel room-podium" },
    h("div", { class: "panel-head" }, h("h2", {}, "Итоги")),
    h("div", { class: "podium-row" },
      rows.map((row, index) => h("div", { class: `podium ${heights[index]}` },
        h("div", { class: "podium-medal", "aria-hidden": "true" }, medals[index]),
        avatarChip(row),
        h("div", { class: "podium-name" }, row.name || row.uid),
        h("div", { class: "podium-score" }, `${row.score ?? 0} б.`)
      ))
    )
  );
}

// Confetti на canvas без библиотек: до 120 частиц, остановка через 4 с.
function runConfetti(page) {
  if (!page || reducedMotion()) return;
  const canvas = h("canvas", { class: "room-confetti", "aria-hidden": "true" });
  page.appendChild(canvas);
  const resize = () => {
    canvas.width = page.clientWidth;
    canvas.height = page.clientHeight;
  };
  resize();
  const colors = ["#F44336", "#FFC107", "#4CAF50", "#2196F3", "#9C27B0", "#FF9800"];
  const particles = [];
  const rnd = Math.random;
  for (let i = 0; i < 120; i++) {
    particles.push({
      x: rnd() * canvas.width,
      y: -20 - rnd() * canvas.height * 0.3,
      vx: (rnd() - 0.5) * 2,
      vy: 2 + rnd() * 3,
      size: 4 + rnd() * 6,
      rot: rnd() * Math.PI,
      vr: (rnd() - 0.5) * 0.2,
      color: colors[Math.floor(rnd() * colors.length)],
      shape: rnd() < 0.5 ? "rect" : "circle"
    });
  }
  const ctx2d = canvas.getContext("2d");
  const start = performance.now();
  const finishAfter = 4000;
  const draw = (at) => {
    if (at - start > finishAfter) {
      canvas.remove();
      return;
    }
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      if (p.y > canvas.height + 20) { p.y = -20; p.x = rnd() * canvas.width; }
      ctx2d.save();
      ctx2d.translate(p.x, p.y);
      ctx2d.rotate(p.rot);
      ctx2d.fillStyle = p.color;
      if (p.shape === "rect") {
        ctx2d.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      } else {
        ctx2d.beginPath();
        ctx2d.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx2d.fill();
      }
      ctx2d.restore();
    }
    if (confettiTimer !== null) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  // 4 секунды дальше — canvas подчищаем и без rAF-цепочки.
  confettiTimer = setTimeout(() => { confettiTimer = null; canvas.remove(); }, finishAfter + 100);
}

function notFoundPanel() {
  return h("div", { class: "panel room-view" },
    h("div", { class: "empty-state" },
      h("div", { class: "empty-state-icon", innerHTML: icons.users }),
      h("h2", {}, "Комната не найдена"),
      h("p", { class: "muted" }, "Проверьте код: 6 символов, без 0, O, 1 и I."),
      h("a", { class: "btn primary", href: "#join" }, "Ввести код заново")
    )
  );
}

function questionPanel(question, { showAnswer = false } = {}) {
  if (!question) return null;
  const panel = h("div", { class: "room-question panel" },
    h("div", { class: "panel-head" },
      h("h2", {}, question.text || "Вопрос без текста"),
      h("span", { class: "badge badge-neutral" }, `${question.points || 1} б.`)
    )
  );
  if (Array.isArray(question.options) && question.options.length) {
    panel.appendChild(h("ul", { class: "room-options" },
      question.options.map((option, index) =>
        h("li", {
          class: showAnswer
            ? (showAnswer.correct?.includes(index) ? "option correct" : "option")
            : "option"
        }, option.text || "—")
      )
    ));
  }
  if (showAnswer && showAnswer.type === "short") {
    panel.appendChild(h("div", { class: "option correct" },
      `Правильный ответ: ${showAnswer.answer || ""}`));
  }
  if (showAnswer?.explanation) {
    panel.appendChild(h("p", { class: "muted" }, showAnswer.explanation));
  }
  return panel;
}

// Результаты комнаты: подиум при закрытии.
function roomResults() {
  if (local.room?.status !== "closed" && liveInfo().lifecycle !== "completed") return null;
  return podiumPanel();
}

function playersListWidget(players) {
  const activePlayers = (players || []).filter(p => !p.observer);
  if (!activePlayers.length) {
    return h("div", { class: "form-hint", style: "text-align:center;margin-top:0.75rem" }, "Участники пока не подключились");
  }
  return h("div", { class: "lobby-players-grid", style: "display:flex;flex-wrap:wrap;gap:var(--space-2);justify-content:center;margin-top:1rem" },
    activePlayers.map(p => h("div", {
      class: "chip",
      style: "display:flex;align-items:center;gap:6px;padding:4px 10px;background:var(--surface-2);border-radius:16px"
    }, avatarChip(p), h("span", {}, p.name || "Участник")))
  );
}

// ---------- Вид ведущего ----------

function hostHeader(wrap, room) {
  wrap.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Live-комната · вы ведущий"),
      h("h1", {}, room.testTitle || "Комната"),
      h("p", { class: "page-sub" }, `Код комнаты: `),
    ),
    h("a", { class: "btn secondary", href: `#room/${room.code || room.id}/screen` },
      "Экран проектора")
  ));
  // Код крупно, чтобы продемонстрировать на экране/камере.
  wrap.appendChild(h("div", { class: "room-code-badge" }, room.code || room.id));
  // QR-код комнаты в фирменном стиле Skillbase: компактный по умолчанию,
  // кнопка «Показать крупнее» переключает на увеличенный для камер
  // издалека. Ссылка и генерация — те же, что в режиме проектора.
  wrap.appendChild(h("div", {
    class: "room-qr-card brand-qr-card",
    style: "text-align: center; margin-top: 1rem; padding: 2.5rem 1.5rem; background: linear-gradient(135deg, #101810 0%, #0a0f0a 100%); color: #fff; border-radius: 2rem; border: 1px solid #C5E747; box-shadow: var(--shadow-lg); position: relative; overflow: hidden;"
  },
    h("div", {
      style: "position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, transparent, #C5E747, transparent);"
    }),
    h("div", { style: "margin-bottom: 1.5rem; position: relative;" },
      h("div", { style: "font-family: var(--font-brand); font-weight: 800; font-size: 1.5rem; letter-spacing: 0.1em; color: #C5E747; text-shadow: 0 0 10px rgba(197, 231, 71, 0.3);" }, "SKILLBASE"),
      h("div", { style: "font-size: 0.8rem; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.25rem;" }, "Официальная платформа")
    ),
    h("div", { class: "qr-wrapper", style: "display: inline-block; background: #F5F7ED; padding: 1.25rem; border-radius: 1.5rem; box-shadow: 0 8px 24px rgba(0,0,0,0.2); line-height: 0; border: 2px solid #C5E747;" }),
    h("p", { style: "margin: 1.5rem 0; font-size: 0.95rem; opacity: 0.9; position: relative;" }, "Отсканируйте, чтобы войти в комнату"),
    h("div", { class: "btn-row", style: "justify-content: center; gap: 0.75rem; position: relative;" },
      h("button", { type: "button", class: "btn secondary", id: "copy-link", style: "background: #C5E747; color: #101810; border: none; font-weight: 600; padding: 0.75rem 1.5rem;" }, "Ссылка"),
      h("button", { type: "button", class: "btn", id: "download-qr", style: "background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); backdrop-filter: blur(10px); padding: 0.75rem 1.5rem;" }, "PNG")
    )
  ));
  // Компактный размер: initRoomQR читает data-qr-size, toggle перерисует
  // через тот же paintQR (один код ссылки для всех вариантов).
  (() => {
    const wrapper = wrap.querySelector(".room-qr-card .qr-wrapper");
    if (!wrapper) return;
    wrapper.dataset.qrSize = "160";
    let larger = false;
    const toggle = h("button", {
      type: "button",
      class: "btn",
      "aria-expanded": "false",
      style: "margin-top: 0.75rem; background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); padding: 0.5rem 1.25rem; position: relative;"
    }, "Показать крупнее");
    toggle.addEventListener("click", () => {
      larger = !larger;
      wrapper.dataset.qrSize = larger ? "280" : "160";
      paintQR(wrapper, room.code || room.id, larger ? 280 : 160);
      toggle.textContent = larger ? "Уменьшить" : "Показать крупнее";
      toggle.setAttribute("aria-expanded", String(larger));
    });
    wrap.querySelector(".room-qr-card").appendChild(toggle);
  })();

  const playersCount = local.players.filter(p => roleOfPlayer(p) !== ROLE_OBSERVER).length;
  const observersCount = local.players.length - playersCount;
  wrap.appendChild(h("div", { class: "quick-actions" },
    h("div", { class: "quick-action" },
      h("b", {}, String(playersCount)),
      h("span", {}, "участников")
    ),
    h("div", { class: "quick-action" },
      h("b", {}, String(observersCount)),
      h("span", {}, "наблюдателей")
    )
  ));

  initRoomQR(room, wrap);
  return { playersCount, observersCount };
}

function hostView() {
  const room = local.room;
  const test = local.test;
  const wrap = h("div", { class: "room-view" });
  const { playersCount } = hostHeader(wrap, room);

  const questions = test?.questions || [];
  const currentId = room.phase === "opened" || room.phase === "closed"
    ? String(room.currentQuestionId)
    : null;
  const question = currentId !== null ? questions[Number(currentId)] : null;
  const reveal = room.phase === "closed" ? local.reveals?.[currentId] : null;

  if (!question) {
    wrap.appendChild(h("div", { class: "panel" },
      h("div", { class: "empty-state" },
        h("div", { class: "empty-state-icon", innerHTML: icons.clock }),
        h("h2", {}, "Ожидание начала теста"),
        h("p", { class: "muted" }, `Ведущий: ${room.hostName || "Преподаватель"} · Участников в лобби: ${playersCount} · Всего вопросов: ${room.questionCount || questions.length}.`),
        playersListWidget(local.players),
        h("div", { class: "btn-row", style: "margin-top: 1.5rem; justify-content: center;" },
          h("button", {
            type: "button",
            class: "btn primary",
            onclick: () => {
              openQuestion(local.code, 0).catch(err => {
                console.error("Не удалось начать тест:", err);
                toast("Не удалось начать тест", "error");
              });
            }
          }, "Начать первый вопрос")
        )
      )
    ));
  } else {
    wrap.appendChild(questionPanel(question));
    if (reveal) wrap.appendChild(revealPanel(reveal, question, { mine: null }));
    if (room.phase === "opened") {
      const counter = answeredCount(local.players.filter(p => !p.observer), currentId);
      const left = openMsLeft();
      const controls = h("div", { class: "panel" },
        h("div", { class: "panel-head" },
          h("h2", {}, "Ответили"),
          h("span", { class: "badge badge-neutral" }, `${counter} из ${playersCount}`)
        ),
        h("div", { class: "panel-body" },
          h("div", { class: "btn-row" },
            h("button", {
              type: "button",
              class: "btn primary",
              onclick: () => manualClose(room)
            }, "Закрыть вопрос"),
            !left ? h("span", { class: "muted" }, "Без ограничения времени: закрытие вручную") : null
          ),
          left && left > 0
            ? h("p", { class: "form-hint" }, "Автозакрытие сработает по таймеру, кнопка останется рабочей.")
            : null
        )
      );
      wrap.appendChild(controls);
    } else {
      wrap.appendChild(h("div", { class: "panel" },
        h("div", { class: "btn-row" },
          h("button", {
            type: "button",
            class: "btn primary",
            disabled: Number(currentId) + 1 >= (room.questionCount || questions.length),
            onclick: () => {
              openQuestion(local.code, Number(currentId) + 1).catch(err => {
                console.error("Не удалось открыть вопрос:", err);
                toast("Не удалось открыть следующий вопрос", "error");
              });
            }
          }, "Следующий вопрос"),
          Number(currentId) + 1 >= (room.questionCount || questions.length)
            ? h("button", {
                type: "button", class: "btn secondary",
                onclick: () => {
                  closeRoom(local.code).then(() => toast("Комната закрыта", "success"))
                    .catch(err => toast("Не удалось закрыть комнату", "error"));
                }
              }, "Завершить комнату")
            : null
        )
      ));
    }
  }

  const results = roomResults();
  if (results) wrap.appendChild(results);

  return wrap;
}

async function manualClose(room) {
  try {
    await closeQuestion({
      code: local.code,
      index: Number(room.currentQuestionId),
      keys: local.keys,
      test: local.test,
      players: local.players,
      speed: {
        qDurationSec: questionDurationSec(local.test, room.settings),
        qStarts: qStartsMs(room)
      }
    });
    // Снапшоты обновят состояние; принудительно перерисуем, чтобы
    // кнопка «Следующий вопрос» появилась сразу.
    lastSignature = null;
    scheduleRender(null);
  } catch (err) {
    console.error("Закрытие вопроса:", err);
    toast("Не удалось закрыть вопрос (нет сети?) — кнопка останется активной.", "error");
  }
}

// Автозакрытие: раз в секунду проверяем, истёк ли вопрос; срабатывает
// один раз на вопрос, кнопка «Закрыть» при сбое остаётся рабочей.
function manageAutoClose() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  if (role() !== "host") return;
  const room = local.room;
  if (!room || room.phase !== "opened" || !room.currentQuestionId) return;
  const questionId = String(room.currentQuestionId);
  if (autoClosed.has(questionId)) return;

  const tick = () => {
    const left = openMsLeft();
    if (left === null) return;
    if (left <= 0 && !autoClosed.has(questionId)) {
      autoClosed.add(questionId);
      manualClose(room);
    }
  };
  tick();
  if (openMsLeft() !== null) {
    autoTimer = setInterval(() => {
      if (!local.room || local.room.phase !== "opened") { clearInterval(autoTimer); autoTimer = null; return; }
      tick();
    }, 1000);
  }
}

// ---------- Вид участника ----------

function playerView() {
  const room = local.room;
  const me = myPlayer();
  const test = local.test;
  const questions = test?.questions || [];
  const wrap = h("div", { class: "room-view" });

  wrap.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Live-комната · вы участник"),
      h("h1", {}, room.testTitle || "Комната"),
      h("p", { class: "page-sub" }, `Код комнаты: ${room.code || room.id}`)
    )
  ));

  const currentId = room.phase === "opened" || room.phase === "closed"
    ? String(room.currentQuestionId)
    : null;
  const question = currentId !== null ? questions[Number(currentId)] : null;
  const myAnswer = question ? me?.answers?.[currentId] : null;
  const reveal = room.phase === "closed" ? local.reveals?.[currentId] : null;

  if (!room || room.status !== "active") {
    wrap.appendChild(h("div", { class: "panel" },
      h("div", { class: "empty-state" }, h("h2", {}, "Комната закрыта"), h("p", { class: "muted" }, "Ведущий завершил сеанс."))
    ));
    const results = roomResults();
    if (results) wrap.appendChild(results);
    return wrap;
  }

  if (!question) {
    const playersCount = local.players.filter(p => !p.observer).length;
    const inviteBox = h("div", { class: "panel" },
      h("div", { class: "empty-state" },
        h("div", { class: "empty-state-icon", innerHTML: icons.clock }),
        h("h2", {}, "Ожидание начала теста"),
        h("p", { class: "muted" }, `Ведущий: ${room.hostName || "Преподаватель"} · Участников в лобби: ${playersCount}. Скоро запустится первый вопрос.`),
        playersListWidget(local.players),
        h("div", { class: "btn-row", style: "margin-top: 1.25rem; justify-content: center;" },
          h("button", {
            type: "button",
            class: "btn secondary",
            onclick: async () => {
              try {
                await navigator.clipboard.writeText(joinUrl(room.code || local.code));
                toast("Ссылка для входа скопирована", "success");
              } catch (e) {
                toast(`Код комнаты: ${room.code || local.code}`, "info");
              }
            }
          }, "Поделиться ссылкой")
        )
      )
    );
    wrap.appendChild(inviteBox);
    const m = materialButton();
    if (m) wrap.appendChild(m);
  } else if (myAnswer != null && reveal) {
    wrap.appendChild(revealPanel(reveal, question, { mine: myAnswer }));
    const verdict = myAnswerVerdict(reveal, myAnswer);
    if (verdict === true || verdict === false) {
      // Всплывающий «+N»: базовые очки вопроса.
      const bonus = h("div", { class: "room-plus", "aria-hidden": "true" },
        verdict ? `+${question.points || 1}` : "0");
      wrap.appendChild(bonus);
      setTimeout(() => bonus.remove(), 1500);
    }
  } else if (myAnswer != null) {
    wrap.appendChild(waitPanel("Ответ принят. Ждём закрытия вопроса."));
    const m = materialButton();
    if (m) wrap.appendChild(m);
  } else {
    wrap.appendChild(answerForm(question, currentId));
  }
  return wrap;
}

// Кнопка «Материал» доступна в ожидании, между вопросами и после
// закрытия. Во время открытого вопроса — скрыта. ЗАЩИТА ТОЛЬКО НА
// КЛИЕНТЕ: студент с прямой ссылкой #material/<testId> может открыть
// материал в другой вкладке во время вопроса. Честное описание —
// в docs/PROGRESS.md.
function materialButton() {
  const room = local.room;
  if (!room || room.phase === "opened") return null;
  // Гость не может читать материалы (правила требуют профиль) —
  // не показываем кнопку, ведущую на закрытый для гостя раздел.
  if (State.user?.isAnonymous) return null;
  return h("div", { class: "btn-row", style: "margin-top:var(--space-2)" },
    h("a", { class: "btn secondary", href: `#material/${encodeURIComponent(room.testId || "")}` },
      "Открыть материал"));
}

function waitPanel(text) {
  return h("div", { class: "panel" },
    h("div", { class: "empty-state" },
      h("div", { class: "empty-state-icon", innerHTML: icons.clock }),
      h("h2", {}, text)
    )
  );
}

// Форма ответа участника — единственная часть с фокусом, потому и
// перерисовываемся только по сигнатуре.
function answerForm(question, questionId) {
  const room = local.room;
  const left = openMsLeft();
  const wrap = h("div", { class: "panel" });
  wrap.appendChild(h("div", { class: "panel-head" },
    h("h2", {}, question.text || "Вопрос без текста"),
    left && left > 0 ? h("span", { class: "timer badge badge-neutral", "data-live-clock": "1" }, formatClock(left)) : null
  ));

  const submitBtn = h("button", { type: "button", class: "btn primary btn-block" }, "Ответить");
  const message = h("div", { class: "form-hint", role: "status" });
  const name = `room-q-${questionId}`;

  if (question.type === "short") {
    const input = h("input", {
      class: "form-control",
      type: "text",
      placeholder: "Ваш ответ",
      "aria-label": "Ответ"
    });
    wrap.appendChild(h("div", { class: "panel-body" },
      h("div", { class: "field" }, input),
      submitBtn, message
    ));
    submitBtn.addEventListener("click", async () => {
      const value = input.value.trim();
      if (!value) { message.textContent = "Введите ответ."; message.className = "form-error"; return; }
      await submitAnswer(room, questionId, value, message, submitBtn, input);
    });
  } else if (question.type === "multiple") {
    const checkboxes = [];
    const box = h("div", { class: "options" },
      (question.options || []).map((option, index) => {
        const cb = h("input", { type: "checkbox", id: `${name}-${index}`, value: String(index) });
        checkboxes.push(cb);
        return h("label", { class: "option", for: `${name}-${index}` }, cb, option.text || "—");
      })
    );
    wrap.appendChild(h("div", { class: "panel-body" }, box, submitBtn, message));
    submitBtn.addEventListener("click", async () => {
      const value = checkboxes.filter(cb => cb.checked).map(cb => Number(cb.value));
      if (!value.length) { message.textContent = "Отметьте хотя бы один вариант."; message.className = "form-error"; return; }
      await submitAnswer(room, questionId, value, message, submitBtn, box);
    });
  } else {
    const radios = [];
    const box = h("div", { class: "options" },
      (question.options || []).map((option, index) => {
        const rb = h("input", { type: "radio", name, id: `${name}-${index}`, value: String(index) });
        radios.push(rb);
        return h("label", { class: "option", for: `${name}-${index}` }, rb, option.text || "—");
      })
    );
    wrap.appendChild(h("div", { class: "panel-body" }, box, submitBtn, message));
    submitBtn.addEventListener("click", async () => {
      const checked = radios.find(rb => rb.checked);
      if (!checked) { message.textContent = "Выберите вариант."; message.className = "form-error"; return; }
      await submitAnswer(room, questionId, Number(checked.value), message, submitBtn, box);
    });
  }
  return wrap;
}

async function submitAnswer(room, questionId, value, message, submitBtn, focusEl) {
  message.textContent = "";
  message.className = "form-hint";
  submitBtn.disabled = true;
  try {
    await saveAnswer(local.code, questionId, value);
    // Снапшот players придёт сам; но перерисуем сразу, чтобы заблокировать
    // повторную отправку, даже если сеть туго тянет подписку.
    const me = myPlayer();
    if (me) {
      me.answers = me.answers || {};
      me.answers[String(questionId)] = value;
      lastSignature = null;
    }
    submitBtn.textContent = "Ответ отправлен";
    toast("Ответ записан", "success");
    scheduleRender(null);
  } catch (err) {
    console.error("Не удалось отправить ответ:", err);
    message.textContent = err?.code === "permission-denied"
      ? (isAutoRoom(local.room)
        ? "Ответ не принят: время на вопрос вышло или вы уже отвечали."
        : "Ответ отклонён (правила Firestore): ведущий мог уже закрыть вопрос или вы уже отвечали.")
      : "Ответ не отправлен. Проверьте подключение.";
    message.className = "form-error";
    submitBtn.disabled = false;
    if (focusEl && focusEl.focus) focusEl.focus();
  }
}

// ---------- Вид наблюдателя ----------

function observerView() {
  const room = local.room;
  const test = local.test;
  const questions = test?.questions || [];
  const wrap = h("div", { class: "room-view" });

  wrap.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Live-комната · вы наблюдатель"),
      h("h1", {}, room.testTitle || "Комната"),
      h("p", { class: "page-sub" }, `Код комнаты: ${room.code || room.id} · отвечать нельзя`)
    )
  ));

  const playersCount = local.players.filter(p => !p.observer).length;
  const currentId = room.phase === "opened" || room.phase === "closed"
    ? String(room.currentQuestionId)
    : null;
  const question = currentId !== null ? questions[Number(currentId)] : null;
  const reveal = room.phase === "closed" ? local.reveals?.[currentId] : null;

  if (!room || room.status !== "active") {
    wrap.appendChild(h("div", { class: "panel" },
      h("div", { class: "empty-state" }, h("h2", {}, "Комната закрыта"))
    ));
    const results = roomResults();
    if (results) wrap.appendChild(results);
    return wrap;
  }

  if (!question) {
    const observerLobby = h("div", { class: "panel" },
      h("div", { class: "empty-state" },
        h("div", { class: "empty-state-icon", innerHTML: icons.clock }),
        h("h2", {}, "Ожидание начала теста"),
        h("p", { class: "muted" }, `Ведущий: ${room.hostName || "Преподаватель"} · Участников в лобби: ${playersCount}. Вы в режиме наблюдателя.`),
        playersListWidget(local.players)
      )
    );
    wrap.appendChild(observerLobby);
    const podium = livePodium();
    if (podium) wrap.appendChild(podium);
  } else if (reveal) {
    wrap.appendChild(revealPanel(reveal, question, { mine: null }));
    const podium = livePodium();
    if (podium) wrap.appendChild(podium);
  } else {
    wrap.appendChild(questionPanel(question, {}));
    const podium = livePodium();
    if (podium) wrap.appendChild(podium);
    wrap.appendChild(h("div", { class: "panel" },
      h("div", { class: "panel-head" },
        h("h2", {}, "Ответили"),
        h("span", { class: "badge badge-neutral" },
          `${answeredCount(local.players.filter(p => !p.observer), currentId)} из ${playersCount}`)
      )
    ));
  }
  return wrap;
}

// Раскрытый правильный ответ (после закрытия вопроса).
function revealPanel(reveal, question, { mine }) {
  const data = reveal.reveal || {};
  return h("div", {},
    questionPanel(question, {
      showAnswer: {
        correct: data.correct || [],
        type: data.type,
        answer: data.answer,
        explanation: data.explanation
      }
    }),
    h("div", { class: "panel" },
      h("div", { class: "panel-body" }, h("p", { class: "muted", role: "status" },
        mine !== null && mine !== undefined
          ? "Ответ записан и проверен ведущим. Ждём следующий вопрос."
          : "Вопрос закрыт, правильный ответ раскрыт."))
    )
  );
}

// ---------- Экран проектора ----------

// #room/CODE/screen: только ведущий, крупные шрифты, вопрос, таймер,
// варианты, таблица. Кнопок управления нет — они остаются на телефоне
// ведущего. Спам реакции и всплывающие эмодзи работают и здесь.
function screenView() {
  const room = local.room;
  const test = local.test;
  const questions = test?.questions || [];
  const wrap = h("div", { class: "room-view room-screen-view" });

  const li = liveInfo();
  const currentId = li.legacyPhase === "opened" || li.legacyPhase === "closed"
    ? li.qid
    : null;
  const question = currentId !== null ? questionFor(currentId) : null;
  const reveal = li.legacyPhase === "closed" ? local.reveals?.[currentId] : null;
  const left = openMsLeft();
  const finishedRoom = room?.status === "closed" || li.lifecycle === "completed";

  wrap.appendChild(h("div", { class: "screen-top" },
    h("div", { class: "screen-title" },
      finishedRoom
        ? "Итоги комнаты"
        : room?.testTitle || "Комната"),
    h("div", { class: "screen-code" }, room?.code || local.code || ""),
    left && left > 0
      ? h("div", { class: "screen-timer", "data-live-clock": "1" }, formatClock(left))
      : h("div", { class: "screen-timer screen-timer-empty" }, "")
  ));

  if (finishedRoom) {
    const podium = podiumPanel();
    if (podium) wrap.appendChild(podium);
  } else if (!question) {
    // Ожидание первого вопроса — момент входа участников: крупный QR,
    // чтобы каждый мог отсканировать его камерой телефона.
    const qrBox = h("div", { class: "screen-qr-box" });
    paintQR(qrBox, room?.code || local.code, 240);
    wrap.appendChild(h("div", { class: "panel screen-wait-panel" },
      h("div", { class: "empty-state" },
        h("p", { class: "page-sub" }, "Отсканируйте камерой телефона, чтобы войти"),
        qrBox,
        h("p", { class: "screen-code-hint" },
          `Или введите код: ${room?.code || local.code || ""}`)
      )
    ));
  } else {
    wrap.appendChild(h("div", { class: "screen-question panel" },
      h("h2", { class: "screen-question-text" }, question.text || "Вопрос без текста"),
      reveal ? h("div", { class: "screen-reveal" }, "Правильный ответ: ") : null,
      Array.isArray(question.options) && question.options.length
        ? h("ul", { class: "screen-options" },
            question.options.map((option, index) => h("li", {
              class: "screen-option" + (reveal && reveal.reveal?.correct?.includes(index) ? " correct" : "")
            }, option.text || "—")))
        : reveal && reveal.reveal?.type === "short"
          ? h("div", { class: "screen-option correct" }, String(reveal.reveal.answer || ""))
          : null,
      reveal?.reveal?.explanation
        ? h("p", { class: "screen-explanation" }, reveal.reveal.explanation)
        : null
    ));
  }

  const rows = boardRows();
  if (rows.length) {
    wrap.appendChild(h("div", { class: "screen-board" },
      rows.slice(0, 6).map((row, index) => h("div", { class: "screen-row" },
        h("span", { class: "screen-rank" }, `${index + 1}.`),
        avatarChip(row),
        h("span", { class: "screen-name" }, row.name || row.uid),
        h("span", { class: "screen-score" }, `${row.score ?? 0} б.`)
      ))
    ));
  }

  // Комната активна, вопрос уже открыт: маленький QR под таблицей —
  // опоздавшие всё ещё могут войти камерой.
  if (room?.status === "active" && question) {
    const mini = h("div", { class: "screen-qr-mini" });
    paintQR(mini, room.code || local.code, 96);
    wrap.appendChild(h("div", { class: "screen-join-late" },
      mini,
      h("span", { class: "screen-join-late-hint" },
        `Войти: камерой или код ${room.code || local.code || ""}`)
    ));
  }
  return wrap;
}

// ---------- Автономный режим: рейтинг и виды ----------

function ratingSource() {
  const room = local.room;
  const li = liveInfo();
  const finished = li.plan ? finishedPositions(li.plan, serverNowMs()).length : 0;
  return ratingRows({
    scores: local.scores,
    players: local.players,
    questionCount: room?.questionCount || 0,
    finished,
    lifecycle: li.lifecycle
  });
}

// Общий рейтинг: место, ФИО, баллы, % верных, завершённые вопросы, статус.
// Карточки в две строки — читаются на экране телефона без горизонтальной
// прокрутки.
function ratingPanel({ title = "Общий рейтинг", limit = null, rows = null } = {}) {
  const all = rows || ratingSource();
  const list = limit ? all.slice(0, limit) : all;
  const me = State.user?.uid;
  const panel = h("section", { class: "panel live-rating", "aria-label": title },
    h("div", { class: "panel-head" },
      h("h2", {}, title),
      h("span", { class: "badge badge-neutral" }, `${all.length} уч.`)));
  if (!list.length) {
    panel.appendChild(h("div", { class: "panel-body" },
      h("p", { class: "muted" }, "Участников пока нет — рейтинг появится после первых ответов.")));
    return panel;
  }
  panel.appendChild(h("ol", { class: "live-rating-list" },
    list.map(row => h("li", {
      class: "live-rating-row" + (row.uid === me ? " is-me" : ""),
      "data-uid": row.uid
    },
      h("span", { class: "lr-place" }, String(row.place)),
      avatarChip(row),
      h("span", { class: "lr-name" }, row.name),
      h("span", { class: "lr-score" }, `${row.score} б.`),
      h("span", { class: "lr-meta" },
        `${row.percent}% верных · вопросов: ${row.answered} из ${row.finished || 0}`,
        " · ",
        h("b", { class: `lr-status lr-${row.status}` }, RATING_STATUS_LABEL[row.status]))
    ))
  ));
  return panel;
}

function progressPanel(li, room) {
  const total = room.questionCount || 0;
  const label = li.lifecycle === "waiting" ? "Тест ещё не начался"
    : li.lifecycle === "in_progress"
      ? (li.phase === "question" ? `Вопрос ${li.position + 1} из ${total}`
        : li.position + 1 >= total ? "Последний вопрос завершён"
        : `Пауза перед вопросом ${li.position + 2} из ${total}`)
      : "Тест завершён";
  return h("section", { class: "panel live-progress" },
    h("div", { class: "panel-head" },
      h("h2", {}, label),
      li.lifecycle === "in_progress"
        ? h("span", { class: "timer badge badge-neutral", "data-live-clock": "1" },
            formatClockMs(li.msLeft || 0))
        : null),
    li.lifecycle === "in_progress"
      ? h("div", { class: "live-bar", "aria-hidden": "true" }, h("div", { class: "live-bar-fill", "data-live-bar": "1" }))
      : null);
}

function peopleChips(list, emptyText) {
  if (!list.length) return h("p", { class: "form-hint", style: "text-align:center" }, emptyText);
  return h("div", { class: "live-people" },
    list.map(p => h("span", { class: "chip live-chip" }, avatarChip(p), p.name || "Участник")));
}

function settingsSummary(room) {
  const order = room.shuffleQuestions ? "случайный" : "последовательный";
  const totalMin = Math.round(((room.questionCount || 0) * ((room.questionSec || 0) + (room.gapSec || 0))) / 60);
  return `Вопросов: ${room.questionCount || 0} · ${room.questionSec} с на вопрос + пауза ${room.gapSec} с · порядок: ${order} · бонус за скорость: ${room.speedBonus === false ? "нет" : "да"} · ≈ ${totalMin} мин`;
}

function autoHostView() {
  const room = local.room;
  const li = liveInfo();
  const wrap = h("div", { class: "room-view" });
  const { playersCount, observersCount } = hostHeader(wrap, room);
  const participants = local.players.filter(p => roleOfPlayer(p) !== ROLE_OBSERVER);
  const observers = local.players.filter(p => roleOfPlayer(p) === ROLE_OBSERVER);
  const regOpen = isRegistrationOpen(room, serverNowMs());
  const active = room.status === "active";

  if (!local.keysReady) {
    wrap.appendChild(h("div", { class: "panel" },
      h("div", { class: "panel-body" },
        h("p", { class: "form-error" },
          "Ключи ответов теста не загружены: правильные ответы не раскроются, баллы не посчитаются. Обновите страницу или проверьте доступ к testKeys."))));
  }

  if (li.lifecycle === "waiting" && active) {
    // Лобби: список вошедших, регистрация, ОДИН запуск.
    const startBtn = h("button", { type: "button", class: "btn primary btn-block", id: "start-test" },
      "Начать тест");
    let confirmEmpty = false;
    startBtn.addEventListener("click", async () => {
      if (!playersCount && !confirmEmpty) {
        confirmEmpty = true;
        startBtn.textContent = "Участников нет — всё равно начать?";
        return;
      }
      startBtn.disabled = true;
      startBtn.textContent = "Запускаем…";
      try {
        await startAutoTest(local.code);
        toast("Тест запущен: вопросы пойдут автоматически", "success");
      } catch (err) {
        console.error("Запуск теста:", err);
        toast(err?.message || "Не удалось запустить тест", "error");
        startBtn.disabled = false;
        startBtn.textContent = "Начать тест";
        confirmEmpty = false;
      }
    });
    const regBtn = h("button", { type: "button", class: "btn secondary" },
      regOpen ? "Закрыть регистрацию" : "Открыть регистрацию");
    regBtn.addEventListener("click", () => {
      regBtn.disabled = true;
      setRegistrationOpen(local.code, !regOpen)
        .catch(err => toast(err?.message || "Не удалось изменить регистрацию", "error"));
    });
    wrap.appendChild(h("section", { class: "panel" },
      h("div", { class: "panel-head" },
        h("h2", {}, "Ожидание участников"),
        h("span", { class: `badge ${regOpen ? "badge-success" : "badge-neutral"}` },
          regOpen ? "Регистрация открыта" : "Регистрация закрыта")),
      h("div", { class: "panel-body" },
        h("p", { class: "muted" }, settingsSummary(room)),
        h("h3", {}, `Участники (${playersCount})`),
        peopleChips(participants, "Пока никто не вошёл — покажите QR или код."),
        h("h3", {}, `Наблюдатели (${observersCount})`),
        peopleChips(observers, "Наблюдателей нет."),
        h("div", { class: "btn-row", style: "margin-top:var(--space-3)" }, regBtn),
        startBtn,
        h("p", { class: "form-hint" },
          "Кнопка нажимается один раз: дальше вопросы выдаются автоматически."))));
  } else if (li.lifecycle === "in_progress") {
    const question = questionFor(li.position);
    const answered = answeredCount(participants, li.qid);
    const finishBtn = h("button", { type: "button", class: "btn secondary" }, "Завершить досрочно");
    finishBtn.addEventListener("click", async () => {
      if (!window.confirm("Завершить тест для всех сейчас? Ответы на текущий вопрос перестанут приниматься.")) return;
      finishBtn.disabled = true;
      try {
        await finishAutoTest(local.code, { early: true });
        toast("Тест завершён досрочно", "success");
      } catch (err) {
        toast(err?.message || "Не удалось завершить тест", "error");
        finishBtn.disabled = false;
      }
    });
    const regBtn = h("button", { type: "button", class: "btn secondary" },
      regOpen ? "Закрыть регистрацию" : "Открыть регистрацию");
    regBtn.addEventListener("click", () => {
      regBtn.disabled = true;
      setRegistrationOpen(local.code, !regOpen).catch(err => toast(err?.message || "Ошибка", "error"));
    });
    wrap.appendChild(progressPanel(li, room));
    wrap.appendChild(h("section", { class: "panel" },
      h("div", { class: "panel-head" },
        h("h2", {}, question?.text || "Вопрос"),
        h("span", { class: "badge badge-neutral" }, `ответили ${answered} из ${playersCount}`)),
      h("div", { class: "panel-body" },
        h("div", { class: "btn-row" }, finishBtn, regBtn),
        h("p", { class: "form-hint" },
          "Вопросы идут автоматически по расписанию. Эту страницу лучше держать открытой: она раскрывает ответы и считает баллы."))));
    wrap.appendChild(ratingPanel());
  } else {
    // completed / closed: итоги и статистика.
    const rows = ratingSource();
    const sum = summarizeRating(rows);
    const plan = li.plan;
    const positions = plan ? finishedPositions(plan, serverNowMs()) : [];
    const acc = questionAccuracy({
      players: local.players,
      keysByPos: local.keysReady ? keysByPosition(local.keys, room) : [],
      positions
    });
    wrap.appendChild(progressPanel(li, room));
    wrap.appendChild(h("section", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Итоговая статистика")),
      h("div", { class: "panel-body" },
        h("div", { class: "quick-actions" },
          h("div", { class: "quick-action" }, h("b", {}, String(sum.participants)), h("span", {}, "участников")),
          h("div", { class: "quick-action" }, h("b", {}, String(sum.averageScore)), h("span", {}, "средний балл")),
          h("div", { class: "quick-action" }, h("b", {}, `${sum.averagePercent}%`), h("span", {}, "верных в среднем"))),
        sum.best ? h("p", { class: "muted" }, `Лучший результат: ${sum.best.name} — ${sum.best.score} б.`) : null,
        acc.length ? h("ol", { class: "live-accuracy" },
          acc.map(item => h("li", {},
            `Вопрос ${item.position + 1}: ${item.percent}% верно (ответили ${item.answered} из ${item.participants})`))) : null)));
    wrap.appendChild(ratingPanel({ title: "Итоговый рейтинг", rows }));
  }

  if (active) {
    const closeBtn = h("button", { type: "button", class: "btn secondary" }, "Закрыть комнату");
    closeBtn.addEventListener("click", async () => {
      if (!window.confirm("Закрыть комнату? Новые подключения будут запрещены.")) return;
      closeBtn.disabled = true;
      try { await closeRoom(local.code); toast("Комната закрыта", "success"); }
      catch (err) { toast("Не удалось закрыть комнату", "error"); closeBtn.disabled = false; }
    });
    wrap.appendChild(h("div", { class: "btn-row", style: "margin-top:var(--space-3)" }, closeBtn));
  } else {
    wrap.appendChild(h("p", { class: "muted" }, "Комната закрыта: новые подключения запрещены."));
  }
  return wrap;
}

function playerHead(room, label) {
  return h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, `Live-комната · ${label}`),
      h("h1", {}, room.testTitle || "Комната"),
      h("p", { class: "page-sub" }, `Код комнаты: ${room.code || room.id}`)));
}

function lobbyPanel(room, who) {
  const participants = local.players.filter(p => roleOfPlayer(p) !== ROLE_OBSERVER);
  const text = who === "observer"
    ? "Вы подключены как наблюдатель. Рейтинг и ход теста появятся после старта."
    : "Вы подключены. Тест начнётся, когда ведущий нажмёт «Начать тест» — вопросы пойдут сами.";
  return h("div", { class: "panel" },
    h("div", { class: "empty-state" },
      h("div", { class: "empty-state-icon", innerHTML: icons.clock }),
      h("h2", {}, "Вы в комнате — ожидаем начала"),
      h("p", { class: "muted" }, text),
      h("p", { class: "muted" }, `Ведущий: ${room.hostName || "Преподаватель"} · Участников: ${participants.length}`),
      local.playersLoaded && !local.errors.players
        ? peopleChips(participants, "")
        : h("p", { class: "form-hint" }, local.errors.players
          ? "Список участников недоступен, но вы подключены."
          : "Загружаем список участников…"),
      h("p", { class: "muted" }, settingsSummary(room))));
}

function autoPlayerView() {
  const room = local.room;
  const li = liveInfo();
  const me = myPlayer();
  const wrap = h("div", { class: "room-view" });
  wrap.appendChild(playerHead(room, "вы участник"));

  if (li.lifecycle === "waiting") {
    wrap.appendChild(lobbyPanel(room, "player"));
    const m = materialButton();
    if (m) wrap.appendChild(m);
    return wrap;
  }
  // Часы ещё не сверены с сервером: короткое ожидание, чтобы не показать
  // не тот вопрос из-за неточных часов устройства.
  if (li.lifecycle === "in_progress" && !local.clockReady) {
    wrap.appendChild(waitPanel("Синхронизируем время с сервером…"));
    return wrap;
  }
  if (li.lifecycle === "in_progress") {
    const question = questionFor(li.position);
    const my = me?.answers?.[li.qid];
    wrap.appendChild(progressPanel(li, room));
    if (!question) {
      wrap.appendChild(waitPanel("Загружаем вопрос…"));
    } else if (li.phase === "question" && my == null) {
      wrap.appendChild(answerForm(question, li.qid));
    } else if (li.phase === "question") {
      wrap.appendChild(h("div", { class: "panel" },
        h("div", { class: "empty-state" },
          h("div", { class: "empty-state-icon", innerHTML: icons.clock }),
          h("h2", {}, "Ответ принят"),
          h("p", { class: "muted" }, "Следующий вопрос появится автоматически. Осталось: ",
            h("b", { "data-live-clock": "1" }, formatClockMs(li.msLeft || 0))))));
    } else {
      wrap.appendChild(gapPanel(question, li, my));
    }
    if (room.showLeaderboard === true) wrap.appendChild(ratingPanel({ title: "Рейтинг", limit: 10 }));
    return wrap;
  }
  // completed / closed
  return finishedPlayerView(wrap, room, li);
}

// Пауза между вопросами: итог по моему ответу и верный ответ (когда
// ведущий его раскрыл).
function gapPanel(question, li, my) {
  const reveal = local.reveals?.[li.qid];
  const verdict = reveal ? myAnswerVerdict(reveal, my) : null;
  const title = my == null ? "Время вышло — вопрос пропущен"
    : verdict === true ? "Верно!"
    : verdict === false ? "Неверно"
    : "Ответ принят";
  const last = li.position + 1 >= (local.room.questionCount || 0);
  const box = h("div", { class: "panel" },
    h("div", { class: "empty-state" },
      h("h2", { class: verdict === true ? "live-ok" : verdict === false || my == null ? "live-bad" : "" }, title),
      h("p", { class: "muted" }, last ? "Результаты появятся через " : "Следующий вопрос через ",
        h("b", { "data-live-clock": "1" }, formatClockMs(li.msLeft || 0)))));
  if (reveal) {
    box.appendChild(questionPanel(question, {
      showAnswer: {
        correct: reveal.reveal?.correct || [],
        type: reveal.reveal?.type,
        answer: reveal.reveal?.answer,
        explanation: reveal.reveal?.explanation
      }
    }));
  }
  return box;
}

function finishedPlayerView(wrap, room, li) {
  const rows = ratingSource();
  const mine = rows.find(r => r.uid === State.user?.uid);
  wrap.appendChild(h("section", { class: "panel" },
    h("div", { class: "panel-head" },
      h("h2", {}, li.lifecycle === "closed" ? "Комната закрыта — ваш результат" : "Тест завершён")),
    h("div", { class: "panel-body" },
      mine
        ? h("div", { class: "quick-actions" },
            h("div", { class: "quick-action" }, h("b", {}, `${mine.place}`), h("span", {}, "место")),
            h("div", { class: "quick-action" }, h("b", {}, `${mine.score}`), h("span", {}, "баллов")),
            h("div", { class: "quick-action" }, h("b", {}, `${mine.percent}%`), h("span", {}, "верных"))) 
        : h("p", { class: "muted" }, "Ваш результат появится, как только ведущий подведёт итоги."),
      mine ? h("p", { class: "muted" }, `Верных ответов: ${mine.correctCount} из ${room.questionCount || 0}`) : null)));
  wrap.appendChild(ratingPanel({ title: "Итоговый рейтинг", rows }));
  const m = materialButton();
  if (m) wrap.appendChild(m);
  return wrap;
}

function autoObserverView() {
  const room = local.room;
  const li = liveInfo();
  const wrap = h("div", { class: "room-view" });
  wrap.appendChild(playerHead(room, "вы наблюдатель"));
  const participants = local.players.filter(p => roleOfPlayer(p) !== ROLE_OBSERVER);
  const observers = local.players.length - participants.length;
  wrap.appendChild(h("div", { class: "quick-actions" },
    h("div", { class: "quick-action" }, h("b", {}, String(participants.length)), h("span", {}, "участников")),
    h("div", { class: "quick-action" }, h("b", {}, String(observers)), h("span", {}, "наблюдателей")),
    h("div", { class: "quick-action" },
      h("b", {}, `${Math.max(0, li.lifecycle === "waiting" ? 0 : li.position + (li.phase === "gap" || li.phase === "done" ? 1 : 0))}/${room.questionCount || 0}`),
      h("span", {}, "вопросов пройдено"))));
  if (li.lifecycle === "waiting") {
    wrap.appendChild(lobbyPanel(room, "observer"));
  } else {
    wrap.appendChild(progressPanel(li, room));
  }
  // Рейтинг наблюдатель видит всегда; отвечать и получать баллы нельзя.
  wrap.appendChild(ratingPanel({ title: li.lifecycle === "waiting" ? "Рейтинг" : "Общий рейтинг" }));
  wrap.appendChild(h("p", { class: "form-hint" }, "Режим наблюдателя: ответы и баллы недоступны."));
  return wrap;
}

// ---------- Роутер вида ----------

function buildView() {
  // Проектор рисуется всё тем же buildView: разбор через локальную метку.
  const rawRoute = decodeURIComponent((State.routeParam || ""));
  if (rawRoute.split("/")[1] === "screen") return screenView();
  const state = connState();
  if (state === CONN.ERROR) return connectionErrorPanel(local.errors.room || local.errors.own);
  if (local.removed) return removedPanel();
  const current = role();
  if (!current || state === CONN.CONNECTING) return connectingPanel();
  const auto = isAutoRoom(local.room);
  if (current === "host") return auto ? autoHostView() : hostView();
  if (current === "observer") return auto ? autoObserverView() : observerView();
  return auto ? autoPlayerView() : playerView();
}

// ---------- Карточки состояний подключения ----------

function emptyIcon(name) {
  const el = document.createElement("div");
  el.className = "empty-state-icon";
  el.innerHTML = icons[name] || "";
  return el;
}

// connecting: идёт проверка членства и загрузка комнаты. Тупика здесь нет:
// по ошибке или через 15 секунд клиент уходит в connection_error с кнопкой.
function connectingPanel() {
  return h("div", { class: "room-view" },
    h("div", { class: "panel" },
      h("div", { class: "empty-state" },
        emptyIcon("users"),
        h("h2", {}, "Подключаемся к комнате…"),
        h("p", { class: "muted" }, `Код ${local.room?.code || local.code || ""}.`))));
}

// connection_error: ошибка подключения с понятной причиной и повтором.
function connectionErrorPanel(err) {
  const reason = err?.code === "permission-denied"
    ? "Правила Firestore не разрешают доступ к комнате."
    : err?.code === "unavailable" || (typeof navigator !== "undefined" && navigator.onLine === false)
      ? "Нет связи с сервером. Проверьте подключение к сети."
      : local?.timedOut
        ? "Подключение не подтвердилось за 15 секунд."
        : "Не удалось подключиться к комнате.";
  const retry = h("button", { type: "button", class: "btn primary btn-block" }, "Повторить");
  retry.addEventListener("click", () => { router(); });
  return h("div", { class: "room-view panel" },
    h("div", { class: "empty-state" },
      emptyIcon("users"),
      h("h2", {}, "Ошибка подключения"),
      h("p", { class: "muted" }, reason),
      retry,
      h("a", { class: "btn secondary btn-block", href: "#join" }, "Вернуться к входу")));
}

function redirectToJoinPanel(code) {
  return h("div", { class: "room-view panel" },
    h("div", { class: "empty-state" },
      emptyIcon("users"),
      h("h2", {}, "Выберите, как войти"),
      h("p", { class: "muted" }, `Комната ${code}: нужно выбрать роль — участник или наблюдатель.`),
      h("a", { class: "btn primary btn-block", href: `#join/${code}` }, "Выбрать роль")));
}

function removedPanel() {
  return h("div", { class: "room-view panel" },
    h("div", { class: "empty-state" },
      emptyIcon("users"),
      h("h2", {}, "Вас нет в этой комнате"),
      h("p", { class: "muted" }, "Ведущий убрал вас из списка. Можно войти заново, пока регистрация открыта."),
      h("a", { class: "btn primary", href: `#join/${local.code}` }, "Войти заново")));
}

function closedRoomPanel() {
  return h("div", { class: "room-view" },
    h("div", { class: "panel" },
      h("div", { class: "empty-state" },
        emptyIcon("users"),
        h("h2", {}, "Комната закрыта"),
        h("p", { class: "muted" }, "Ведущий завершил комнату; новые подключения не принимаются."),
        h("a", { class: "btn secondary", href: "#/" }, "На главную"))));
}
