// ui/pages/room.js — единый экран Live-комнат: host, player, observer
// и проектор (#room/CODE/screen — только ведущий).
// Перерисовка только при изменении сигнатуры (where правилом поля ввода
// участника не теряет фокус). Таблица лидеров живёт вне сменной
// перерисовки: так техника FLIP сравнивает позиции строк между кадрами.
import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { loadCss } from "../../shared/load-css.js";
import {
  subscribeRoom, subscribeOwnState, openQuestion, closeQuestion, saveAnswer,
  closeRoom, questionDurationSec, sendReaction, subscribeReactions,
  getMyRoomRole, startAutoTest, finishAutoTest, setRegistrationOpen,
  revealAutoQuestion, writeScoreBoard, syncServerClock,
  subscribeDuels, ensureDuelsDoc, updateDuelsDoc, saveDuelAnswer, readDuelAnswers,
  saveRoomHistory
} from "../../core/rooms.js";
import { buildRoomHistorySnapshot } from "../../core/room-history.js";
import {
  tieGroups, buildDuelsDoc, withGroup, applyDuelPlaces, duelGroupsChanged,
  pendingUidsFor, openDuelRound, applyRound, stopGroup, settleGroup,
  validateDecision, applyDecision
} from "../../core/duel-logic.js";
import { isCorrect, normalizeKeys } from "../../core/scoring.js";
import {
  questionTimeMs, answeredCount, myAnswerVerdict, buildJoinUrl, computeScores,
  streakFromReveals, verdictsFromTrail, streakTier, streakEvent, scoreBreakdown,
  speedRatio, formatBreakdown, normalizePlayerTimes,
  roomRenderSignature, roomCrowdSignature
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
import { avatarChip as avatarChipEl } from "../components/avatar.js";
import { play, soundEnabled, setSoundEnabled, vibrate } from "../../shared/sound.js";
import { REACTIONS, REACTION_COOLDOWN_MS, canSendReaction } from "../../shared/reactions.js";
import { reactionGlyph, reactionLabel } from "../components/reaction-icons.js";
import { leaderList, reconcileLeaderList, captureRects, playFlip, MOVE_VISIBLE_MS } from "../components/leaderboard.js";
import { streakMeter } from "../components/streak.js";
import { ringTimer, updateRings, pulseRings, gapCountdown, updateGap } from "../components/ring-timer.js";
import { buildPodium, playPodium, showPodiumNow, podiumOrder, STEP_MS } from "../components/podium.js";
import { runConfetti, stopConfetti } from "../components/confetti.js";
import { buildDuel } from "../components/duel.js";
import { buildExpress, expressStations, EXPRESS_STOP_MS } from "../components/express.js";
import { themeToggle } from "../components/theme-toggle.js";
import { icons } from "../../shared/icons.js";
import { toast } from "../components/toast.js";
import { generateQRSvg } from "../../shared/qr.js";
import { hasMaterial } from "../../core/materials.js";
import { themedQrOptions, qrPalette } from "../../shared/qr-theme.js";
import { subscribeTheme, subscribeSkin } from "../../shared/theme.js";
import { t as tr, lt } from "../../core/i18n.js";
import { buildLiveReport } from "../../core/live-report.js";
import { gradeRoster, journalRows } from "../../core/pair-grade.js";
import {
  journalPanel, reportPanel, reportSection, overviewPanel,
  studentsPanel, recommendationsPanel
} from "../components/live-report.js";
import { getSubject, getTopic } from "../../core/subjects.js";

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
let streakRef = null;
let final = null;          // финальная последовательность: дуэль → подиум → экспресс
let frame = { sig: "", at: 0, prev: null, cur: null }; // кадр рейтинга для анимаций
let moveState = new Map(); // uid → { delta, until } значки ↑2 / ↓1
let meterStreak = 0;       // серия, показанная над карточкой участника
let pendingRect = null;    // позиции карточек до перерисовки (FLIP)
const autoClosed = new Set();
let lastSignature = null;
let lastCrowdSig = null;  // подпись «толпы»: ответы/очки/состав участников
let lastStepKey = null;   // «шаг» комнаты: смена вопроса/фазы/роли → плавный переход вида
let lastBoardSig = null;
let lastReactionSig = null;
const ratingNodes = new Map(); // рейтинг живёт между перерисовками вида: карточки не пересоздаются
let finalDock = null;     // единый итоговый экран с вкладками: обновляется на месте
let finalDockSig = "";
let finalTab = "overview";        // активная вкладка итогового экрана
let finalTabPanes = new Map();    // id вкладки → узел (кэш на текущую подпись данных)
let finalMeta = { subject: "", topic: "" }; // предмет/тема теста для вкладки «Обзор»
let duelEnsureBusy = false;        // автоматическое создание документа дуэлей — один поток
let historySaveBusy = false;       // сохранение снимка истории — один поток
let historySavedCode = null;       // код комнаты, снимок которой уже сохранён
const duelAnswerKnown = new Map(); // ответId → true (свой ответ на раунд уже принят)
let local = null;

// Обратный замеченный предыдущее «событийное» состояние комнаты.
let prev = null;
// Задержки показанных реакций: uid → atMs последней показанной.
let shownReactions = new Map();
// Ранг строки (uid → индекс прошлого кадра) для значков «↑2/↓1».
let lastRanks = null;
let lastScores = null; // uid → прошлый счёт (count-up)
let lastReactionTs = 0; // локальный троттлинг отправки реакций
let profilesRev = 0;       // версия загруженных профилей (аватары догружаются)
// Обязанности ведущего автономного режима (раскрытие ответов, рейтинг).
let dutyBusy = false;
let lastScoreSig = "";
let dutyErrorShown = false;
// Ошибка подписки: тост показывается один раз на источник (room / own /
// players / scores…); очищается при восстановлении (clearError).
const shownErrors = new Set();
// Подписки на смену темы/скина для перекраски QR (см. initRoomQR).
// Одна пара на страницу: при пересборке вида старые отписываются.
let qrThemeOff = null;
let qrSkinOff = null;
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
  stopConfetti();
  if (final) { final.cancel(); final = null; }
  frame = { sig: "", at: 0, prev: null, cur: null };
  moveState = new Map();
  meterStreak = 0;
  pendingRect = null;
  streakRef = null;
  autoClosed.clear();
  lastSignature = null;
  lastCrowdSig = null;
  lastStepKey = null;
  lastBoardSig = null;
  lastReactionSig = null;
  ratingNodes.clear();
  finalDock = null;
  finalDockSig = "";
  finalTab = "overview";
  finalTabPanes.clear();
  finalMeta = { subject: "", topic: "" };
  historySaveBusy = false;
  historySavedCode = null;
  lastRanks = null;
  lastScores = null;
  shownReactions = new Map();
  prev = null;
  lastReactionTs = 0;
  profilesRev = 0;
  dutyBusy = false;
  lastScoreSig = "";
  dutyErrorShown = false;
  duelEnsureBusy = false;
  duelWriteBusy = false;
  duelAnswerKnown.clear();
  try { qrThemeOff?.(); } catch (e) { /* уже отписаны */ }
  try { qrSkinOff?.(); } catch (e) { /* уже отписаны */ }
  qrThemeOff = null;
  qrSkinOff = null;
  shownErrors.clear();
  pageRef = null;
  leaderRef = null;
  statusRef = null;
  local = {
    room: null, players: [], scores: [], reveals: {}, reactions: [],
    profiles: new Map(), test: null, keys: null, keysReady: false,
    hasMaterial: false,    // у теста есть учебный материал (кнопка «Прочитать»)
    receivedMs: 0, code: "", playersLoaded: false,
    profilesDone: new Set(), // uid, для которых профиль уже запрашивался
    // Независимые источники состояния подключения:
    ownPlayer: null,       // собственный документ players/{uid}
    myAnswers: {}, myTimes: {},
    memberConfirmed: false, // членство подтверждено (или это ведущий)
    roomLoaded: false,
    removed: false,
    timedOut: false,
    errors: {},            // room / own / players — ошибки подписок
    duels: null,           // rooms/{code}/duels/final — состояние дуэлей за места
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
  // ПОЛНАЯ перерисовка вида — только по этим полям (шаг комнаты, мой ответ,
  // роль, состояние подключения). «Толпа» (ответы и очки других участников,
  // входы/выходы, счётчики) в подпись не входит: она обновляется точечно
  // (updateRatingPanels, updateAnswered, updatePeople, updateLivePodiums,
  // updateScreenBoard), поэтому чужой ответ не пересобирает экран и не
  // сбивает поле ввода/прокрутку. Раньше crowd был частью подписи — каждый
  // чужой ответ или очко вызывали rebuild всего .room-view.
  // Подпись дуэлей для пересборки вида: ведущий реагирует на весь
  // документ, участник — только на свою группу (чужие группы и очки
  // раундов не сбивают его поле ответа) и на факт полного разрешения.
  return roomRenderSignature({
    roomStatus: room ? room.status : "no-room",
    conn: connState(),
    life: li.lifecycle,
    position: li.position,
    phase: li.phase,
    currentQuestionId: room?.currentQuestionId,
    qStartedMs: room?.qStartedMs,
    regOpen: room?.registrationOpen === false ? 0 : 1,
    clockReady: local.clockReady,
    revealOn: revealId,
    myAnswered: myAnswer != null,
    role: role(),
    removed: local.removed,
    testReady: Boolean(local.test),
    keysReady: local.keysReady,
    hasMaterial: local.hasMaterial
  }) + `|duel=${duelViewSig()}`;
}

// Подпись дуэлей для пересборки вида: ведущий реагирует на весь документ,
// участник — на свою группу и на факт полного разрешения ничьих.
function duelViewSig() {
  const doc = local.duels;
  if (!doc) return "";
  if (role() === "host") return duelSig();
  const uid = State.user?.uid;
  const mine = (doc.groups || []).find(g => (g.uids || []).includes(uid));
  const resolvedCount = (doc.groups || []).filter(g => g.status === "resolved").length;
  if (!mine) return `${doc.status}|${resolvedCount}`;
  return `${doc.status}|${resolvedCount}|${mine.id}:${mine.status}:${mine.currentQid ?? "-"}:${(mine.rounds || []).length}:${(mine.order || []).join(".")}`;
}

// Подпись «толпы»: ответы/очки/состав участников. Её изменение запускает
// ТОЛЬКО локальные обновляторы, а не перерисовку вида. Версия профилей
// входит сюда: дозагрузка аватара обновляет чипы и карточки точечно.
function crowdSignature() {
  return `${roomCrowdSignature({
    players: local.players || [],
    scores: local.scores || [],
    reveals: local.reveals || {}
  })}|p=${profilesRev}|d=${duelSig()}`;
}

// Подпись состояния дуэлей за места: состав групп, статусы, открытый
// раунд, история раундов и порядок. Входит в stepKey (полная пересборка
// вида при смене раунда/статуса) и в crowdSignature (точечное обновление
// рейтинговых панелей).
function duelSig() {
  const doc = local.duels;
  if (!doc) return "";
  return `${doc.status || ""}|${(doc.groups || []).map(g =>
    `${g.id}:${g.status}:${g.currentQid ?? "-"}:${(g.rounds || []).length}:${(g.order || []).join(".")}`
  ).join(",")}`;
}

// Полная длительность вопроса в мс (для кольца таймера) или 0, если не ограничен.
function questionTotalMs() {
  const li = liveInfo();
  if (li.plan?.questionMs) return li.plan.questionMs;
  const sec = questionDurationSec(local.test, local.room?.settings);
  return sec ? sec * 1000 : 0;
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

// Возвращает true, если появились новые данные профилей (вызвавшая
// сторона после этого wake() — запускает точечное обновление аватаров).
async function loadProfiles(orgId) {
  const org = local.room?.orgId || orgId;
  if (!org) return false;
  // Грузим только ещё не запрошенные профили: участники, вошедшие позже,
  // тоже получают аватары (раньше после первой загрузки флаг навсегда
  // закрывал дозагрузку — новые участники оставались без аватаров).
  const uids = (local.players || []).map(p => p.uid).filter(uid => !local.profilesDone?.has(uid));
  if (!uids.length) return false;
  try {
    const profiles = await loadPublicProfiles(uids, org);
    profiles.forEach(p => local.profiles.set(p.id, p));
    // Профиль могло не быть — не спрашиваем этот uid повторно.
    uids.forEach(uid => local.profilesDone.add(uid));
    // Аватары живут в карточках рейтинга и чипах участников: bump версии
    // профилей проходит через crowd-гейт и запускает точечное обновление
    // (без полной перерисовки вида).
    profilesRev += 1;
    return true;
  } catch (err) {
    console.error("Аватары участников:", err);
    return false;
  }
}

// Ошибка подписки: запоминаем по источнику (room / own / players /
// scores…) и показываем тост один раз на источник. Ошибка списка
// участников НЕ переводит клиента в connection_error.
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
  // Стили Live-комнаты и реакций подключаются точечно: они не нужны
  // остальным страницам и не должны блокировать первую отрисовку.
  await Promise.all([
    loadCss("ui/css/live.css"),
    loadCss("ui/css/reactions.css")
  ]);
  shownErrors.clear();
  const rawRoute = decodeURIComponent((State.routeParam || ""));
  const parts = rawRoute.split("/");
  const codeRaw = parts[0] || "";
  const isScreen = parts[1] === "screen";
  const page = h("div", {
    class: "page room-page" + (isScreen ? " room-screen-page" : "")
  });

  // ---------- 1. Комната и тест (разовые чтения) ----------
  // Всегда читаем комнату из Firestore (ведущий только что создал её, документ
  // уже записан). Состояние кладём в local ДО подписок: wake() и role()
  // работают только когда local.code и local.room заполнены.
  reset();
  const code = String(codeRaw || "").toUpperCase();
  let probeResult = null;
  try {
    probeResult = await probeRoom(code);
  } catch (err) {
    console.error("Комната:", err);
    local.timedOut = false;
    page.appendChild(connectionErrorPanel(err));
    return page;
  }
  if (!probeResult) {
    page.appendChild(notFoundPanel());
    return page;
  }
  local.code = code;
  local.room = decorateRoom(probeResult);
  local.roomLoaded = true;
  local.receivedMs = Date.now();

  const isHost = isStaff() && probeResult.hostId === State.user?.uid;

  // Тест и ключи грузятся параллельно; недоступное (ключи у студента)
  // не ломает отрисовку.
  try {
    const [testDoc, keys, materialExists] = await Promise.all([
      loadTestPublic(probeResult.testId).catch(err => {
        console.error("Тест комнаты:", err);
        return null;
      }),
      isHost ? loadKeys(probeResult.testId) : Promise.resolve(null),
      // Материал читает участник с профилем; гостю правила его не отдают.
      isHost || State.user?.isAnonymous
        ? Promise.resolve(false)
        : hasMaterial(probeResult.testId)
    ]);
    local.hasMaterial = Boolean(materialExists);
    local.test = testDoc;
    local.keys = keys;
    local.keysReady = true;
    // Предмет/тема для вкладки «Обзор»: только у ведущего (имена из
    // справочников организации), не блокирует отрисовку.
    if (isHost && testDoc) resolveFinalMeta(testDoc);
  } catch (err) {
    console.error("Комната:", err);
    page.appendChild(connectionErrorPanel(err));
    return page;
  }

  // Экран проектора: только ведущий.
  if (isScreen && !isHost) {
    page.appendChild(h("div", { class: "panel" },
      h("div", { class: "empty-state" },
        h("h2", {}, "Экран доступен только ведущему"),
        h("p", { class: "muted" }, "Откройте страницу под учётной записью ведущего комнаты."),
        h("a", { class: "btn secondary", href: "#/" }, "На главную"))
    ));
    return page;
  }

  // ---------- 2. Членство ----------
  if (isHost) {
    local.memberConfirmed = true;
    local.roomLoaded = true;
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
      if (probeResult.status !== "active") {
        page.appendChild(closedRoomPanel());
        return page;
      }
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
  // Пачки снапшотов (очки, раскрытия и реакции часто приходят вместе,
  // особенно у ведущего и на проекторе) дают один проход состояния на кадр:
  // requestAnimationFrame схлопывает подряд идущие wake() в один проход.
  // Данные к этому моменту уже лежат в local, промежуточные состояния
  // пропускаются безопасно — события (звуки, вспышки) срабатывают по
  // итоговой разнице с prev.
  let passQueued = false;
  const runPass = () => {
    passQueued = false;
    if (!local || local.code !== code) return;
    onStateUpdate(page, isScreen);
    scheduleRender(page);
  };
  const wake = () => {
    if (!local || local.code !== code) return;
    if (passQueued) return;
    passQueued = true;
    requestAnimationFrame(runPass);
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
      loadProfiles().then(changed => { if (changed) wake(); })
        .catch(err => console.error(err));
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
        clearError("own");
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
      clearError("scores");
      wake();
    },
    error => { setError("scores", error); }
  ));

  unsubs.push(onSnapshot(
    collection(db, "rooms", code, "reveals"),
    snapshot => {
      local.reveals = {};
      snapshot.docs.forEach(item => { local.reveals[item.id] = item.data(); });
      clearError("reveals");
      wake();
    },
    error => { setError("reveals", error); }
  ));

  // Реакции: свои шлём кнопками, чужие показываем всплывающими эмодзи.
  unsubs.push(subscribeReactions(
    code,
    reactions => { local.reactions = reactions; clearError("reactions"); wake(); },
    error => { setError("reactions", error); }
  ));

  // Дуэли за места: состояние ведущего читают все в комнате (финальный
  // рейтинг с уникальными местами нужен каждому).
  unsubs.push(subscribeDuels(
    code,
    doc => { local.duels = doc; clearError("duels"); wake(); },
    error => { setError("duels", error); wake(); }
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
  // (завершённые ошибкой) пересоздаются переинициализацией страницы.
  // Полная переинициализация — ТОЛЬКО когда сломано само подключение
  // (room или own). Вторичные ошибки (scores, reveals, reactions, players)
  // SDK восстанавливает сам: их наличие — не причина пересобирать страницу.
  // Раньше здесь проверялось Object.keys(local.errors).length — одна
  // случайная ошибка оставалась в local.errors навсегда (у secondary
  // источников не было clearError), и каждый возврат на вкладку или каждое
  // событие online заново перезапускали всю страницу комнаты.
  onlineHandler = () => {
    if (document.visibilityState === "hidden") return;
    if (connState() === CONN.ERROR) {
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
  // Полоса серии — над карточкой участника, вне сменной перерисовки вида.
  streakRef = h("div", { class: "streak-host", "aria-live": "polite" });
  if (!isScreen) page.appendChild(streakRef);
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
  // Кольцо вопроса и обратный отсчёт паузы обновляются «на месте».
  const ringLeft = openMsLeft();
  if (ringLeft !== null) updateRings(page, ringLeft);
  if (li.phase === "gap" || li.legacyPhase === "closed") updateGap(page, li.msLeft);
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
    text = li.lifecycle === "waiting" ? tr("room.waitStart")
      : li.lifecycle === "completed" ? tr("room.finished")
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
  // Дуэли: создание документа и слежение за составом групп — по снапшотам
  // очков и состоянию комнаты; охраняется флагом и проверками внутри.
  manageDuels();
  // История: снимок итогового отчёта при завершении — тоже один поток.
  manageHistorySave();
  fillStatusBarIfChanged();
  updateLeaderboard();
  // «Толпа» (ответы и очки других участников, входы/выходы) обновляется
  // точечно и только когда её подпись изменилась: полная перерисовка вида
  // на толпу не реагирует (см. signature()).
  const crowd = crowdSignature();
  if (crowd !== lastCrowdSig) {
    lastCrowdSig = crowd;
    updateRatingPanels(target);
    updateScreenBoard(target);
    updateAnswered(target);
    updatePeople(target);
    updateLivePodiums(target);
    if (finalDock?.isConnected) updateFinalDock();
  }
  updateStreakMeter();
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

// Ключ «шага»: меняется, только когда на экране должен появиться другой вид
// (новый вопрос, пауза, раскрытие ответа, финал, смена роли). Обновления
// толпы (чужие ответы, очки, новые участники) шаг не меняют — вид
// пересобирается на месте без анимации, чтобы ничто не мигало.
function stepKey() {
  const li = liveInfo();
  const revealed = li.legacyPhase === "closed" && li.qid !== "" && local.reveals?.[li.qid] ? 1 : 0;
  return [
    local.room ? local.room.status : "no-room",
    connState(), role() || "-", local.removed ? 1 : 0,
    li.lifecycle, li.position, li.phase, li.qid, revealed,
    local.room?.registrationOpen === false ? 0 : 1,
    duelViewSig()
  ].join("|");
}

const VIEW_FADE_MS = 280;

// Старый вид не исчезает мгновенно: его «снимок» остаётся поверх и плавно
// гаснет, пока новый вид плавно проявляется под ним (кроссфейд). Между
// ними нет кадра с пустым фоном — поэтому нет и «мерцания».
function makeGhost(page, existing) {
  const ghost = existing.cloneNode(true);
  ghost.classList.add("room-view-ghost");
  ghost.setAttribute("aria-hidden", "true");
  ghost.removeAttribute("id");
  ghost.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
  ghost.querySelectorAll("button, input, textarea, select, a").forEach(el => {
    el.tabIndex = -1;
    el.disabled = true;
  });
  const pageBox = page.getBoundingClientRect();
  const box = existing.getBoundingClientRect();
  ghost.style.top = `${box.top - pageBox.top}px`;
  ghost.style.left = `${box.left - pageBox.left}px`;
  ghost.style.width = `${box.width}px`;
  return ghost;
}

function crossfade(page, existing, next, ghost) {
  existing.replaceWith(next);
  page.appendChild(ghost);
  next.classList.add("room-view-enter");
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    ghost.remove();
    next.classList.remove("room-view-enter");
  };
  if (typeof ghost.animate === "function") {
    const fade = ghost.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: VIEW_FADE_MS * 0.8, easing: "ease-out", fill: "forwards" }
    );
    fade.onfinish = finish;
    fade.oncancel = finish;
  }
  setTimeout(finish, VIEW_FADE_MS + 120);
}

function renderPage(page) {
  const existing = page.querySelector(".room-view:not(.room-view-ghost)");
  syncBoardFrame();
  const oldTops = captureRects(existing);
  const key = stepKey();
  const stepChanged = key !== lastStepKey;
  lastStepKey = key;
  // Снимок старого вида — ДО сборки нового: общие узлы (рейтинг) переедут
  // в новый вид, а снимок сохранит их для плавного исчезновения.
  const ghost = existing && stepChanged && !reducedMotion() ? makeGhost(page, existing) : null;
  const next = buildView();
  if (existing) {
    // Фиксируем высоту и прокрутку на время подмены: страница не
    // «проваливается» и не прыгает, когда вид собирается заново.
    const scrollY = window.scrollY;
    const lockH = page.offsetHeight;
    page.style.minHeight = `${lockH}px`;
    if (ghost) crossfade(page, existing, next, ghost);
    else existing.replaceWith(next);
    if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
    requestAnimationFrame(() => requestAnimationFrame(() => { page.style.minHeight = ""; }));
  } else {
    page.insertBefore(next, page.querySelector(".room-leaderboard-host"));
  }
  playFlip(next, oldTops);
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
  const myStreak = role() === "player"
    ? (boardData().find(r => r.uid === State.user?.uid)?.streak ?? 0)
    : null;

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
    // Серия: огонь с 3, молния с 5, обрыв — гаснущий звук.
    if (myStreak != null && prev.streak != null && myStreak !== prev.streak) {
      const ev = streakEvent(prev.streak, myStreak);
      const tier = streakTier(myStreak);
      setTimeout(() => {
        if (ev === "tier" && tier === "bolt") { play("streak5"); vibrate("streak5"); }
        else if (ev === "tier" && tier === "fire") { play("streak3"); vibrate("streak3"); }
        else if (ev === "break") { play("streakBreak"); vibrate("streakBreak"); }
      }, 280);
    }
    // Подъём моего места.
    if (myRank != null && prev.rank != null && myRank < prev.rank) {
      play("up");
    }
    // Финал комнаты.
    const finishedNow = room?.status === "closed" && prev.status === "active"
      || (li.auto && now.life === "completed" && prev.life === "in_progress");
    if (finishedNow) {
      // Звук финала и конфетти играет финальная последовательность (подиум).
      if (!boardData().length) play("final");
    }
  }
  prev = { ...now, ids, reveal: Boolean(reveal), rank: myRank, streak: myStreak, status: room?.status || "" };
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
    if (remaining > 0 && Math.ceil(remaining / 1000) <= 5) {
      // Пульс кольца и звук «тик» — одним событием, чтобы шли в такт.
      updateRings(pageRef, remaining);
      pulseRings(pageRef);
      play("tick");
    }
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
  const buttons = [];
  REACTIONS.forEach(value => {
    const btn = h("button", {
      type: "button",
      class: "room-reaction-btn",
      title: reactionLabel(value),
      "aria-label": `Реакция: ${reactionLabel(value)}`,
      onclick: () => {
        const at = Date.now();
        // Клиентский троттлинг: правила требуют паузу больше 1 с.
        if (!canSendReaction(lastReactionTs, at)) return;
        lastReactionTs = at;
        play("reaction");
        buttons.forEach(b => { b.disabled = true; b.classList.add("is-cooling"); });
        setTimeout(() => buttons.forEach(b => { b.disabled = false; b.classList.remove("is-cooling"); }), REACTION_COOLDOWN_MS);
        sendReaction(local.code, value).catch(err => {
          console.error("Реакция:", err);
          toast("Реакцию не отправили (не чаще раза в секунду)", "error");
        });
      }
    }, reactionGlyph(value));
    buttons.push(btn);
    bar.appendChild(btn);
  });
}

// Всплывающие реакции: показываем только новые (uid с новым at).
function showFloats() {
  const host = floatsRef;
  if (!host) return;
  for (const item of local.reactions || []) {
    const atMs = item.atMs || 0;
    if (atMs <= (shownReactions.get(item.uid) || 0)) continue;
    shownReactions.set(item.uid, atMs);
    const el = h("span", { class: "room-float-emoji" }, reactionGlyph(item.emoji || "👍"));
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

// ---------- Рейтинг карточками: данные, FLIP, значки места и серии ----------

// Единый источник строк рейтинга: очки из scores + участники комнаты.
// Серия и дорожка ответов приходят из scores (их пишет ведущий), а для
// своей строки серия считается сразу по раскрытым вопросам.
function boardData() {
  const room = local.room;
  const li = liveInfo();
  const revealIds = Object.keys(local.reveals || {}).sort((a, b) => Number(a) - Number(b));
  const finished = li.plan ? finishedPositions(li.plan, serverNowMs()).length : revealIds.length;
  const rows = ratingRows({
    scores: local.scores,
    players: local.players,
    questionCount: room?.questionCount || 0,
    finished,
    lifecycle: li.lifecycle
  });
  const mine = role() === "player" ? myPlayer() : null;
  for (const row of rows) {
    row.verdicts = verdictsFromTrail(row.trail);
    // Аватар из профиля богаче аватара из players-документа; строка рейтинга
    // должна обновиться, когда профиль догрузился (см. rowSignature).
    const profile = local.profiles.get(row.uid);
    if (profile?.avatar) row.avatar = profile.avatar;
    if (mine && row.uid === mine.uid && revealIds.length) {
      const own = streakFromReveals(mine, local.reveals, revealIds);
      if (own.verdicts.length >= row.verdicts.length) {
        row.streak = own.streak;
        row.bestStreak = own.bestStreak;
        row.verdicts = own.verdicts;
      }
    }
  }
  return rows;
}

// Рейтинг для ручного режима: пока нет ни одного документа очков — пусто.
function boardRows() {
  return (local.scores || []).length ? ratingSource() : [];
}

// Единый источник строк рейтинга. Пока тест идёт — общие места
// (ratingRows: 1, 1, 3). На итоговом экране (тест завершён или комната
// закрыта) места разрешаются дуэлями за места: порядок из документа
// duels/final, без повторов; неразрешённые группы остаются с общими
// местами и пометкой «ожидается решение». Очки строки не меняются —
// дуэль не трогает баллы основного теста.
function ratingSource() {
  const rows = boardData();
  const room = local.room;
  const li = liveInfo();
  const done = room?.status === "closed"
    || li.lifecycle === "completed"
    || li.lifecycle === "closed";
  if (!done) return rows;
  return applyDuelPlaces(rows, local.duels);
}

// Кадр рейтинга: что было до последнего изменения (для count-up, значков
// места ↑2/↓1 и вспышки серии). Подсказки живут ~1.5 с, потом гаснут,
// чтобы обычная перерисовка не проигрывала анимацию заново.
function syncBoardFrame() {
  const rows = boardData();
  const sig = rows.map(r => `${r.uid}:${r.place}:${r.score}:${r.streak}`).join(",");
  if (sig === frame.sig) return rows;
  const now = Date.now();
  const mk = () => ({
    places: new Map(rows.map(r => [r.uid, r.place])),
    scores: new Map(rows.map(r => [r.uid, r.score ?? 0])),
    streaks: new Map(rows.map(r => [r.uid, r.streak ?? 0]))
  });
  const prevCur = frame.cur;
  frame = { sig, at: now, prev: prevCur, cur: mk() };
  if (prevCur) {
    for (const row of rows) {
      const old = prevCur.places.get(row.uid);
      if (typeof old === "number" && old !== row.place) {
        moveState.set(row.uid, { delta: old - row.place, until: now + MOVE_VISIBLE_MS });
      }
    }
  }
  return rows;
}

function leaderCtx({ board = false, enter = false } = {}) {
  const now = Date.now();
  const moves = new Map();
  for (const [uid, m] of moveState) {
    if (m.until > now) moves.set(uid, m.delta); else moveState.delete(uid);
  }
  const fresh = frame.prev && now - frame.at < 1500 && !reducedMotion();
  return {
    avatar: avatarChip,
    me: State.user?.uid,
    moves,
    prevScores: fresh ? new Map(frame.prev.scores) : new Map(),
    prevStreaks: fresh ? new Map(frame.prev.streaks) : new Map(),
    statusLabel: RATING_STATUS_LABEL,
    board,
    enter
  };
}

function leaderListFor(rows, opts) {
  return leaderList(rows, leaderCtx(opts));
}

function leaderSignature(rows) {
  return rows.map(row =>
    `${row.uid}:${row.place}:${row.score ?? 0}:${row.correctCount ?? 0}:${row.streak ?? 0}:${row.percent}:${row.answered}`).join(",");
}

function updateLeaderboard() {
  const host = leaderRef;
  if (!host) return;
  // На проекторе рейтинг построен в screenView — здесь не дублируем.
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

  // Участнику рейтинг — только по настройке теста showLeaderboard.
  syncBoardFrame();
  const rows = Boolean(room)
    && (roleHere !== "player" || room.showLeaderboard === true)
    ? boardRows()
    : [];
  // Фича "в своём темпе" (isSelfPaced) не реализована, оставлена заглушкой
  // if (isSelfPaced) {
  //   rows = computeSelfScores(players, questions);
  // }
  if (!rows.length) {
    host.classList.add("room-leaderboard-empty");
    if (host.textContent) host.textContent = "";
    lastBoardSig = null;
    return;
  }
  host.classList.remove("room-leaderboard-empty");
  const sig = leaderSignature(rows);
  if (host.querySelector(".lb-list") && sig === lastBoardSig) return;

  // FLIP: запомнить позиции ДО обновления, доехать ПОСЛЕ.
  const oldTops = captureRects(host);
  // Список уже на экране — обновляем только изменившиеся карточки,
  // без пересоздания всего блока (иначе страница мигает).
  const list = host.querySelector(".lb-list");
  if (!(list && host.querySelector(".lb-title") && reconcileLeaderList(list, rows, leaderCtx()))) {
    host.replaceChildren(
      h("h2", { class: "lb-title" }, "Рейтинг"),
      leaderListFor(rows, { enter: true })
    );
  }
  lastBoardSig = sig;
  playFlip(host, oldTops);
}

// Полоса серии над карточкой участника: огонь с 3, молния с 5.
function updateStreakMeter() {
  const host = streakRef;
  if (!host) return;
  if (isScreenRoute() || role() !== "player" || !local.room || local.room.status === "closed") {
    if (host.firstChild) host.textContent = "";
    meterStreak = 0;
    return;
  }
  const row = boardData().find(r => r.uid === State.user?.uid);
  const streak = row?.streak ?? 0;
  if (streak === meterStreak) return;
  const node = streakMeter(streak, meterStreak);
  const prevStreak = meterStreak;
  meterStreak = streak;
  host.textContent = "";
  if (node) host.appendChild(node);
  // Оборванная серия: значок гаснет, затем полоса убирается.
  if (streak === 0 && prevStreak > 0) {
    setTimeout(() => { if (meterStreak === 0) host.textContent = ""; }, 1700);
  }
}

// ---------- Локальные обновляторы «толпы» ----------
// Ответы, очки и состав участников меняются часто, но не требуют
// пересборки вида: каждый блок обновляется точечно и только если
// изменился его собственный ключ. Прокрутка, фокус и открытые
// состояния при этом не затрагиваются.

// Контейнер участников с точечным обновлением: kind — participants /
// observers / players. Пустой список показывает подсказку data-people-empty.
function peopleBox(kind, emptyText) {
  return h("div", {
    class: "live-people",
    "data-people": kind,
    "data-people-empty": emptyText || ""
  });
}

function updatePeople(page) {
  if (!page) return;
  const players = local.players || [];
  const participants = players.filter(p => roleOfPlayer(p) !== ROLE_OBSERVER);
  const observers = players.filter(p => roleOfPlayer(p) === ROLE_OBSERVER);
  const sets = { participants, observers, players };
  page.querySelectorAll("[data-people]").forEach(el => {
    const list = sets[el.dataset.people] || [];
    // Подпись чипа включает аватар: догрузка профиля обновит только свой чип.
    const chipSig = p => {
      const profile = local.profiles.get(p.uid);
      return `${p.name || "Участник"}|${profile?.avatar || p.avatar || ""}`;
    };
    const sig = list.map(p => `${p.uid}:${chipSig(p)}`).join(",");
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    // Точечная сборка: чипы остаются на месте, меняются только изменённые.
    if (!list.length) {
      el.textContent = "";
      const hint = el.dataset.peopleEmpty;
      if (hint) {
        el.appendChild(h("p", { class: "form-hint people-empty-hint", style: "text-align:center;margin:0" }, hint));
      }
      return;
    }
    el.querySelectorAll(":scope > .people-empty-hint").forEach(node => node.remove());
    const existing = new Map();
    el.querySelectorAll(":scope > [data-uid]").forEach(node => existing.set(node.dataset.uid, node));
    list.forEach((p, index) => {
      const next = chipSig(p);
      let chip = existing.get(p.uid);
      existing.delete(p.uid);
      if (!chip || chip.dataset.sig !== next) {
        const fresh = h("span", { class: "chip live-chip", "data-uid": p.uid, "data-sig": next },
          avatarChip(p), p.name || "Участник");
        if (chip && chip.parentNode === el) el.replaceChild(fresh, chip);
        else el.appendChild(fresh);
        chip = fresh;
      }
      const at = el.children[index] || null;
      if (at !== chip) el.insertBefore(chip, at);
    });
    existing.forEach(node => node.remove());
  });
  page.querySelectorAll("[data-people-count]").forEach(el => {
    const value = String((sets[el.dataset.peopleCount] || []).length);
    if (el.textContent !== value) el.textContent = value;
  });
}

// Счётчики «ответили X из Y» на открытый вопрос (ведущий ручного и
// автономного режима). Ответы чужих читает только ведущий (правила),
// поэтому у наблюдателя счётчик остаётся 0 — как и раньше.
function updateAnswered(page) {
  if (!page) return;
  const li = liveInfo();
  const participants = (local.players || []).filter(p => roleOfPlayer(p) !== ROLE_OBSERVER);
  const qid = li.auto ? li.qid : String(local.room?.currentQuestionId ?? "");
  const answered = qid ? answeredCount(participants, qid) : 0;
  const text = `${answered} из ${participants.length}`;
  page.querySelectorAll("[data-answered]").forEach(el => {
    if (el.textContent !== text) el.textContent = text;
  });
}

// Рейтинговые панели автономного режима (внутри вида): список карточек
// дозаполняется/переставляется точечно, заглушка и счётчик — по месту.
function updateRatingPanels(page) {
  if (!page) return;
  const rows = ratingSource();
  page.querySelectorAll(".live-rating[data-rating-limit]").forEach(panel => {
    const limit = panel.dataset.ratingLimit ? Number(panel.dataset.ratingLimit) : null;
    const list = limit ? rows.slice(0, limit) : rows;
    const countText = `${rows.length} уч.`;
    const countEl = panel.querySelector("[data-rating-count]");
    if (countEl && countEl.textContent !== countText) countEl.textContent = countText;
    const ol = panel.querySelector(".lb-list");
    if (!list.length) {
      if (ol) ol.remove();
      if (!panel.querySelector(".rating-empty")) {
        panel.appendChild(h("div", { class: "panel-body rating-empty" },
          h("p", { class: "muted" }, "Участников пока нет — рейтинг появится после первых ответов.")));
      }
      return;
    }
    const empty = panel.querySelector(".rating-empty");
    if (empty) empty.remove();
    if (!ol) {
      panel.appendChild(leaderListFor(list));
      return;
    }
    // FLIP: позиции карточек до reconcile, плавный доезд после.
    const oldTops = captureRects(panel);
    syncBoardFrame();
    reconcileLeaderList(ol, list, leaderCtx());
    playFlip(panel, oldTops);
  });
}

// Табло проектора: топ-8 карточек внутри вида, обновляется точечно.
function updateScreenBoard(page) {
  if (!page) return;
  const el = page.querySelector("[data-screen-board]");
  if (!el) return;
  const rows = boardRows().slice(0, 8);
  const sig = leaderSignature(rows);
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  const oldTops = captureRects(el);
  el.textContent = "";
  if (!rows.length) return;
  syncBoardFrame();
  el.appendChild(leaderListFor(rows, { board: true }));
  playFlip(el, oldTops);
}

// Топ-3 наблюдателя в ручном режиме: перестраивается только при изменении
// состава/очков тройки.
function updateLivePodiums(page) {
  if (!page) return;
  const rows = boardRows().slice(0, 3);
  const sig = rows.map(r => `${r.uid}:${r.place}:${r.score ?? 0}`).join(",");
  page.querySelectorAll("[data-live-podium]").forEach(el => {
    if (el.dataset.podSig === sig) return;
    el.dataset.podSig = sig;
    el.textContent = "";
    if (!rows.length) return;
    const medals = ["🥇", "🥈", "🥉"];
    el.appendChild(h("div", { class: "room-live-podium" },
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
    ));
  });
}

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
// Цвета модулей берутся из текущей темы/скина (shared/qr-theme.js).
const roomQROptions = {
  width: 280,
  height: 280,
  ecc: "H",
  rounded: true
}

// Рисует SVG QR-кода внутрь элемента. size — сторона в px: один механизм
// генерации, разные размеры (карточка ведущего, проектор, мини-QR).
function paintQR(box, code, size = 280) {
  if (!box || !code) return;
  try {
    box.style.background = qrPalette().light;
    box.dataset.qrCode = code;
    box.dataset.qrSize = String(size);
    box.innerHTML = generateQRSvg(joinUrl(code), themedQrOptions({
      ...roomQROptions,
      width: size,
      height: size
    }));
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
  // Смена темы или скина перекрашивает QR; после ухода со страницы — отписка
  // (reset). При пересборке вида старые подписки снимаются до новых: без
  // этого каждый rebuild карточки ведущего добавлял по две подписки.
  try { qrThemeOff?.(); } catch (e) { /* уже отписаны */ }
  try { qrSkinOff?.(); } catch (e) { /* уже отписаны */ }
  const repaintQR = () => {
    if (!qrWrapper.isConnected) {
      if (qrWrapper.dataset.seen) { offTheme(); offSkin(); }
      return;
    }
    qrWrapper.dataset.seen = "1";
    paintQR(qrWrapper, qrWrapper.dataset.qrCode || room.code, Number(qrWrapper.dataset.qrSize || 280));
  };
  const offTheme = subscribeTheme(repaintQR);
  const offSkin = subscribeSkin(repaintQR);
  qrThemeOff = offTheme;
  qrSkinOff = offSkin;

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
      ctx.fillStyle = qrPalette().light;
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
  // Гость не имеет publicProfiles — аватар берём из его players-документа.
  const profile = local.profiles.get(entry.uid);
  return avatarChipEl(profile?.avatar || entry.avatar, entry.name);
}

// ---------- Подиум и конфетти ----------

// Финальная последовательность: Дуэль двух лидеров → подиум (3 → 2 → 1,
// очки «набегают», конфетти на 1 месте) → Экспресс по станциям-вопросам.
// Узел создаётся один раз и переиспользуется при перерисовках вида, а
// пройденная последовательность запоминается (sessionStorage), чтобы
// обновление страницы не гоняло её заново.
function finalSeenKey() { return `sb:finalSeen:${local.code}`; }
function finalWasSeen() { try { return sessionStorage.getItem(finalSeenKey()) === "1"; } catch { return false; } }
function markFinalSeen() { try { sessionStorage.setItem(finalSeenKey(), "1"); } catch { /* нет storage */ } }

function finalSequence({ projector = false } = {}) {
  const rows = ratingSource();
  if (!rows.length) return null;
  const sig = `${local.code}|${projector ? 1 : 0}`;
  if (final && final.sig === sig) { final.refresh(rows); return final.node; }
  if (final) final.cancel();
  final = createFinal(sig, rows, projector);
  return final.node;
}

function createFinal(sig, initialRows, projector) {
  const node = h("div", { class: `final-seq${projector ? " final-projector" : ""}` });
  const st = { sig, node, rows: initialRows, stage: "start", timers: [], stop: null };
  const clearTimers = () => { st.timers.forEach(clearTimeout); st.timers = []; if (st.stop) { st.stop(); st.stop = null; } };
  const mount = (child) => { node.textContent = ""; node.appendChild(child); };
  const later = (fn, ms) => { st.timers.push(setTimeout(fn, ms)); };
  const hasExpress = () => expressStations(st.rows).length > 0;

  const podiumBlock = (instant) => {
    const pod = buildPodium(st.rows, { avatar: avatarChip });
    if (instant) showPodiumNow(pod);
    return { pod, panel: h("div", { class: "panel room-podium" },
      h("div", { class: "panel-head" }, h("h2", {}, "Итоги")), pod) };
  };

  const goDone = () => {
    clearTimers(); st.stage = "done"; markFinalSeen();
    const { panel } = podiumBlock(true);
    const actions = h("div", { class: "btn-row", style: "padding:0 var(--space-3) var(--space-3)" },
      hasExpress() ? h("button", { type: "button", class: "btn secondary", onclick: () => goExpress(true) }, "Показать экспресс") : null);
    panel.appendChild(actions);
    mount(panel);
  };

  const goExpress = (manual = false) => {
    clearTimers(); st.stage = "express";
    if (!hasExpress()) { goDone(); return; }
    const ex = buildExpress(st.rows, { avatar: avatarChip, questionCount: local.room?.questionCount || 0 });
    const toDone = h("button", { type: "button", class: "btn primary", onclick: goDone }, "К итогам");
    mount(h("div", {}, ex.el, h("div", { class: "btn-row", style: "padding:0 var(--space-3) var(--space-3)" }, toDone)));
    st.stop = ex.stop;
    requestAnimationFrame(() => ex.start());
    if (!manual) later(goDone, 600 + expressStations(st.rows).length * EXPRESS_STOP_MS + 3500);
  };

  const goPodium = () => {
    clearTimers(); st.stage = "podium";
    const { pod, panel } = podiumBlock(false);
    const next = h("button", { type: "button", class: "btn secondary", onclick: () => (hasExpress() ? goExpress() : goDone()) }, "Дальше");
    panel.appendChild(h("div", { class: "btn-row", style: "padding:0 var(--space-3) var(--space-3)" }, next));
    mount(panel);
    const count = Math.min(3, st.rows.length);
    const first = () => {
      play("podiumFirst"); vibrate("podiumFirst");
      runConfetti(pageRef || document.body, { power: 1.4 });
    };
    requestAnimationFrame(() => {
      st.stop = playPodium(pod, {
        onStep: () => { play("podiumStep"); vibrate("podiumStep"); },
        onFirst: first
      });
    });
    const total = 400 + podiumOrder(count).length * STEP_MS + 4200;
    later(() => (hasExpress() ? goExpress() : goDone()), total);
  };

  const goDuel = () => {
    clearTimers(); st.stage = "duel";
    const [a, b] = st.rows;
    if (!a || !b || !(a.verdicts?.length || b.verdicts?.length)) { goPodium(); return; }
    const duel = buildDuel(a, b, { avatar: avatarChip, onDone: goPodium });
    mount(duel.el);
    st.stop = duel.stop;
    requestAnimationFrame(() => duel.start());
  };

  st.cancel = () => { clearTimers(); stopConfetti(); };
  st.refresh = (rows) => {
    st.rows = rows;
    if (st.stage === "done") goDone();
  };
  if (finalWasSeen()) goDone(); else goDuel();
  return st;
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

// Результаты комнаты при закрытии: дуэль, подиум, экспресс.
function roomResults() {
  if (local.room?.status !== "closed" && liveInfo().lifecycle !== "completed") return null;
  return finalSequence();
}

// Список участников в лобби (ручной режим): контейнер с точечным
// обновлением — updatePeople пересобирает чипы только при смене состава.
function playersListWidget() {
  return peopleBox("players", "Участники пока не подключились");
}

// ---------- Вид ведущего ----------

function hostHeader(wrap, room) {
  wrap.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Live-комната · вы ведущий"),
      h("h1", {}, room.testTitle || "Комната"),
      h("p", { class: "page-sub" }, `Код комнаты: `),
    ),
    h("div", { class: "room-head-tools" },
      themeToggle(),
      h("a", { class: "btn secondary", href: `#room/${room.code || room.id}/screen` },
        "Экран проектора"))
  ));
  // Код крупно, чтобы продемонстрировать на экране/камере.
  wrap.appendChild(h("div", { class: "room-code-badge" }, room.code || room.id));
  // QR-код комнаты в фирменном стиле Skillbase: компактный по умолчанию,
  // кнопка «Показать крупнее» переключает на увеличенный для камер
  // издалека. Ссылка и генерация — те же, что в режиме проектора.
  wrap.appendChild(h("div", { class: "room-qr-card brand-qr-card" },
    h("div", { class: "brand-qr-head" },
      h("div", { class: "brand-qr-title" }, "SKILLBASE"),
      h("div", { class: "brand-qr-sub" }, "Live-комната")
    ),
    h("div", { class: "qr-wrapper qr-frame" }),
    h("p", { class: "brand-qr-hint" }, "Отсканируйте, чтобы войти в комнату"),
    h("div", { class: "btn-row brand-qr-actions" },
      h("button", { type: "button", class: "btn primary", id: "copy-link" }, "Ссылка"),
      h("button", { type: "button", class: "btn secondary", id: "download-qr" }, "PNG")
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
      class: "btn secondary brand-qr-toggle",
      "aria-expanded": "false"
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
      h("b", { "data-people-count": "participants" }, String(playersCount)),
      h("span", {}, "участников")
    ),
    h("div", { class: "quick-action" },
      h("b", { "data-people-count": "observers" }, String(observersCount)),
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
        h("h2", {}, lt("room.waitStart")),
        h("p", { class: "muted" }, `Ведущий: ${room.hostName || "Преподаватель"} · Участников в лобби: `,
          h("b", { "data-people-count": "participants" }, String(playersCount)),
          ` · Всего вопросов: ${room.questionCount || questions.length}.`),
        playersListWidget(),
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
          h("span", { class: "badge badge-neutral", "data-answered": "1" }, `${counter} из ${playersCount}`)
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
  const duels = duelsPanel();
  if (duels) wrap.appendChild(duels);

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

// ---------- Дуэли за места (ведущий) ----------
// Равные (score, correctCount) в итоговом рейтинге разрешаются дуэльной
// серией: раунд = вопрос из банка теста, участники отвечают заново.
// Состояние — rooms/{code}/duels/final, ответы — в answers-подколлекции.
// Чистая логика состояний — core/duel-logic.js.

// Одно действие ведущего за раз: двойное нажатие не должно закрыть
// один раунд дважды и задвоить счёт серии.
let duelWriteBusy = false;

// Размер банка вопросов дуэли: столько же, сколько вопросов в тесте.
function duelBankSize() {
  return local.room?.questionCount || (local.test?.questions || []).length || 0;
}

// Ключи теста в виде карты "индекс вопроса" → ключ (вердикты раундов
// считает ведущий; у участников ключей нет — им они и не нужны).
function duelKeys() {
  return normalizeKeys(local.keys?.items ?? local.keys);
}

// Ничья не разрешается сама: как только тест завершён и появились группы
// с равным результатом, ведущий создаёт документ дуэлей (однократно —
// ensureDuelsDoc не затирает существующие раунды и решения). Если очки
// после завершения теста догнались и состав групп изменился — документ
// пересобирается с сохранением уже сыгранных раундов и решений.
function manageDuels() {
  if (duelEnsureBusy) return;
  const room = local.room;
  if (!room || role() !== "host") return;
  const done = room.status === "closed"
    || liveInfo().lifecycle === "completed"
    || liveInfo().lifecycle === "closed";
  if (!done) return;
  const groups = tieGroups(boardData());
  if (!groups.length) return;
  duelEnsureBusy = true;
  (async () => {
    try {
      if (!local.duels) {
        await ensureDuelsDoc(local.code, buildDuelsDoc({
          rows: boardData(),
          questionCount: duelBankSize()
        }));
      } else if (duelGroupsChanged(local.duels, groups)) {
        await updateDuelsDoc(local.code, buildDuelsDoc({
          rows: boardData(),
          existing: local.duels,
          questionCount: duelBankSize()
        }));
      }
    } catch (err) {
      console.error("Дуэли:", err);
    } finally {
      duelEnsureBusy = false;
    }
  })();
}

// Пишет обновлённое состояние документа и перерисовывает вид сразу.
// Пока запись идёт, новые действия ведущего не стартуют: состояние
// документа обновит снапшот.
async function writeDuels(payload) {
  if (duelWriteBusy) return;
  duelWriteBusy = true;
  try {
    await updateDuelsDoc(local.code, payload);
  } finally {
    duelWriteBusy = false;
  }
  lastSignature = null;
  scheduleRender(null);
}

// Свежая группа из снапшота (кнопка несёт снимок группы на момент рендера).
function freshDuelGroup(group) {
  return (local.duels?.groups || []).find(g => g?.id === group?.id) || group;
}

async function duelOpenRound(group) {
  const fresh = freshDuelGroup(group);
  if (fresh.currentQid != null) return; // раунд уже открыт
  const next = openDuelRound(fresh, duelBankSize());
  if (!next) {
    toast("Вопросы дуэли закончились — используйте решение преподавателя.", "info");
    return;
  }
  try {
    await writeDuels(withGroup(local.duels, fresh.id, next, boardData()));
  } catch (err) {
    console.error("Раунд дуэли:", err);
    toast("Не удалось открыть раунд (нет сети?)", "error");
  }
}

// Закрытие раунда: ответы раунда читаются из Firestore, вердикты считает
// ведущий по ключам теста; участник без ответа — пропуск (null).
async function duelCloseRound(group) {
  const fresh = freshDuelGroup(group);
  if (fresh.currentQid == null) return; // раунд уже закрыт
  if (!local.keysReady) {
    toast("Ключи теста не загружены: закрыть раунд нельзя.", "error");
    return;
  }
  try {
    const answers = await readDuelAnswers(local.code);
    const keys = duelKeys();
    const prefix = `${fresh.id}__${fresh.currentRound}__`;
    const verdicts = {};
    for (const uid of fresh.uids) {
      const answer = answers[`${prefix}${uid}`];
      const key = keys[String(fresh.currentQid)] || null;
      verdicts[uid] = answer == null ? null : isCorrect(key, answer);
    }
    const played = applyRound(fresh, fresh.currentQid, verdicts);
    await writeDuels(withGroup(local.duels, fresh.id, settleGroup(played, duelBankSize()), boardData()));
  } catch (err) {
    console.error("Закрытие раунда дуэли:", err);
    toast("Не удалось закрыть раунд (нет сети?)", "error");
  }
}

// Остановка серии: участник не может продолжить. Победителя не назначаем.
async function duelStop(group) {
  const fresh = freshDuelGroup(group);
  if (fresh.status === "resolved") return;
  const stopped = stopGroup(fresh);
  try {
    await writeDuels(withGroup(local.duels, fresh.id, settleGroup(stopped, duelBankSize()), boardData()));
  } catch (err) {
    console.error("Остановка дуэли:", err);
    toast("Не удалось остановить дуэль (нет сети?)", "error");
  }
}

// Явное решение преподавателя: порядок неразрешённых участников,
// причина и автор сохраняются в документе — победитель не назначается
// скрытым правилом.
async function duelDecide(group, order, reason) {
  const fresh = freshDuelGroup(group);
  if (fresh.status === "resolved") return;
  const check = validateDecision({
    pendingUids: pendingUidsFor(fresh, duelBankSize()),
    order,
    reason,
    authorUid: State.user?.uid
  });
  if (check.error) { toast(check.error, "error"); return; }
  const decided = applyDecision(fresh, {
    order,
    reason,
    authorUid: State.user?.uid,
    authorName: local.room?.hostName || "",
    at: Date.now()
  }, duelBankSize());
  try {
    await writeDuels(withGroup(local.duels, fresh.id, decided, boardData()));
    toast("Решение сохранено", "success");
  } catch (err) {
    console.error("Решение по дуэли:", err);
    toast("Не удалось сохранить решение (нет сети?)", "error");
  }
}

// История раунда строкой: «Раунд 2 · вопрос 3 — победа: Имя» / «— ничья».
function duelRoundText(group, round) {
  const winner = round.winner ? group.names?.[round.winner] || "участник" : null;
  return `Раунд ${round.n} · вопрос ${Number(round.qid) + 1} — ${winner ? `победа: ${winner}` : "ничья"}`;
}

// Панель разрешения ничьих: список групп, очки серий, история раундов,
// кнопки проведения раундов и форма решения преподавателя для pending.
function duelsPanel() {
  if (role() !== "host") return null;
  const doc = local.duels;
  if (!doc) return null;
  const bankSize = duelBankSize();

  const groupBlock = (group, index) => {
    const title = `Дуэль ${index + 1}`;
    const body = h("div", { class: "panel-body" });
    const names = group.uids
      .map(uid => `${group.names?.[uid] || "Участник"} — ${group.tally?.[uid] || 0}`);
    body.appendChild(h("p", { class: "muted" },
      group.status === "pending"
        ? `Победителя не назначаем автоматически. Участники: ${names.join("; ")}.`
        : `Участники: ${names.join("; ")}.`));
    if (group.stoppedReason) {
      body.appendChild(h("p", { class: "form-error" }, `Серия остановлена: ${group.stoppedReason}`));
    }
    if ((group.rounds || []).length) {
      body.appendChild(h("ul", { class: "live-accuracy" },
        group.rounds.map(round => h("li", {}, duelRoundText(group, round)))));
    }

    if (group.status === "resolved") {
      const orderNames = (group.order || [])
        .map(uid => group.names?.[uid] || uid).join(" → ");
      body.appendChild(h("p", { class: "form-hint" },
        group.decision
          ? `Порядок по решению преподавателя: ${orderNames}. Причина: ${group.decision.reason}`
          : `Порядок по дуэли: ${orderNames}.`));
      return h("section", { class: "panel" },
        h("div", { class: "panel-head" },
          h("h3", {}, title),
          h("span", { class: "badge badge-success" }, "разрешена")),
        body);
    }

    if (group.status === "running" && group.currentQid != null) {
      const question = (local.test?.questions || [])[Number(group.currentQid)];
      body.appendChild(h("div", { class: "btn-row" },
        h("button", {
          type: "button", class: "btn primary",
          onclick: () => duelCloseRound(group)
        }, "Закрыть раунд"),
        h("button", {
          type: "button", class: "btn secondary",
          onclick: () => duelStop(group)
        }, "Остановить серию")));
      body.appendChild(h("p", { class: "form-hint" },
        `Раунд ${group.currentRound}: ${question?.text || `вопрос ${Number(group.currentQid) + 1}`} — вопрос видят участники дуэли. Без ответа раунд засчитывается как пропуск.`));
      return h("section", { class: "panel" },
        h("div", { class: "panel-head" },
          h("h3", {}, title),
          h("span", { class: "badge badge-neutral" }, `раунд ${group.currentRound}`)),
        body);
    }

    // running без открытого раунда или pending: кнопки продолжения и
    // форма решения.
    const canContinue = group.status === "running" && bankSize - (group.usedQids || []).length > 0;
    body.appendChild(h("div", { class: "btn-row" },
      canContinue
        ? h("button", {
            type: "button", class: "btn primary",
            onclick: () => duelOpenRound(group)
          }, "Показать раунд")
        : null,
      group.status === "running"
        ? h("button", {
            type: "button", class: "btn secondary",
            onclick: () => duelStop(group)
          }, "Остановить серию")
        : null));

    if (canContinue) {
      body.appendChild(h("p", { class: "form-hint" },
        `Осталось вопросов в банке: ${bankSize - group.usedQids.length}. Раунды можно прекратить в любой момент и решить порядок явно.`));
    }

    // Решение преподавателя доступно в любой момент: до исчерпания
    // банка, после него или после остановки серии.
    const pending = pendingUidsFor(group, bankSize);
    if (pending.length) {
      body.appendChild(duelDecisionForm(group, pending));
    }
    return h("section", { class: "panel" },
      h("div", { class: "panel-head" },
        h("h3", {}, title),
        h("span", {
          class: `badge ${group.status === "pending" ? "badge-danger" : "badge-neutral"}`
        }, group.status === "pending" ? "требуется решение" : "идёт")),
      body);
  };

  const groups = (doc.groups || []).map(groupBlock);
  return h("section", { class: "panel duels-panel" },
    h("div", { class: "panel-head" },
      h("h2", {}, "Разрешение ничьих"),
      h("span", {
        class: `badge ${doc.status === "resolved" ? "badge-success" : "badge-neutral"}`
      }, doc.status === "resolved" ? "места распределены"
        : doc.status === "pending" ? "есть неразрешённые" : "идут дуэли")),
    h("div", { class: "panel-body" },
      h("p", { class: "muted" },
        doc.status === "resolved"
          ? "Все ничьи разрешены: итоговые места уникальны."
          : "Раунд — вопрос из теста, на который участники дуэли отвечают заново. Если вопросы закончились или участник не может продолжить, порядок принимает преподаватель явно.")),
    ...groups);
}

// Форма решения преподавателя: по селекту места на каждого
// неразрешённого участника + причина.
function duelDecisionForm(group, pendingUids) {
  const selects = new Map();
  const reasonInput = h("input", {
    class: "form-control", type: "text",
    placeholder: "Причина: например, дополнительное задание проведено"
  });
  const errLine = h("p", { class: "form-error", hidden: true });
  const form = h("div", { class: "duel-decision" },
    h("p", { class: "form-hint" },
      "Порядок не определён дуэлью. Назначьте места явно — решение сохранится с причиной и автором."),
    pendingUids.map(uid => {
      const select = h("select", { class: "form-control", "aria-label": `Место для ${group.names?.[uid] || uid}` },
        pendingUids.map((_, i) => h("option", { value: String(i + 1) }, `${i + 1} место`)));
      selects.set(uid, select);
      return h("label", { class: "field" },
        h("span", { class: "muted" }, group.names?.[uid] || "Участник"), select);
    }),
    h("label", { class: "field" },
      h("span", { class: "muted" }, "Причина"), reasonInput),
    errLine,
    h("div", { class: "btn-row" },
      h("button", {
        type: "button", class: "btn primary",
        onclick: () => {
          const order = [...pendingUids].sort((a, b) =>
            Number(selects.get(a).value) - Number(selects.get(b).value));
          const ranks = pendingUids.map(uid => Number(selects.get(uid).value));
          if (new Set(ranks).size !== pendingUids.length) {
            errLine.textContent = "Каждому участнику — своё место: значения не должны повторяться.";
            errLine.hidden = false;
            return;
          }
          errLine.hidden = true;
          duelDecide(group, order, reasonInput.value);
        }
      }, "Записать решение")));
  return form;
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
    ),
    h("div", { class: "room-head-tools" }, themeToggle())
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
    const duelWidget = duelPlayerWidget();
    if (duelWidget) wrap.appendChild(duelWidget);
    return wrap;
  }

  if (!question) {
    const playersCount = local.players.filter(p => !p.observer).length;
    const inviteBox = h("div", { class: "panel" },
      h("div", { class: "empty-state" },
        h("div", { class: "empty-state-icon", innerHTML: icons.clock }),
        h("h2", {}, lt("room.waitStart")),
        h("p", { class: "muted" }, `Ведущий: ${room.hostName || "Преподаватель"} · Участников в лобби: `,
          h("b", { "data-people-count": "participants" }, String(playersCount)),
          ". Скоро запустится первый вопрос."),
        playersListWidget(),
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
  // Нет книги у теста или читать нельзя (гость): кнопку не показываем.
  if (!local.hasMaterial || State.user?.isAnonymous) return null;
  // Добровольное чтение (#material/<id>/free/<код>): выйти можно в любой
  // момент, «К тесту» возвращает обратно в эту комнату.
  const href = `#material/${encodeURIComponent(room.testId || "")}/free/${encodeURIComponent(room.code || local.code || "")}`;
  return h("div", { class: "panel room-material-cta" },
    h("div", { class: "room-material-cta-text" },
      h("b", {}, lt("room.waitRead")),
      h("span", { class: "muted" }, "Откроется читалка, из неё можно вернуться в комнату.")),
    h("a", { class: "btn primary", href }, lt("room.readMaterial")));
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
  const total = questionTotalMs();
  const wrap = h("div", { class: "panel" });
  // Круговой таймер вокруг вопроса вместо цифр: дуга убывает плавно,
  // в последние 5 секунд кольцо краснеет и пульсирует в такт тику.
  wrap.appendChild(h("div", { class: "panel-head question-head" },
    h("h2", {}, question.text || "Вопрос без текста"),
    left && left > 0
      ? (total ? ringTimer({ totalMs: total, leftMs: left })
        : h("span", { class: "timer badge badge-neutral", "data-live-clock": "1" }, formatClock(left)))
      : null
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
        h("h2", {}, lt("room.waitStart")),
        h("p", { class: "muted" }, `Ведущий: ${room.hostName || "Преподаватель"} · Участников в лобби: `,
          h("b", { "data-people-count": "participants" }, String(playersCount)),
          ". Вы в режиме наблюдателя."),
        playersListWidget()
      )
    );
    wrap.appendChild(observerLobby);
    wrap.appendChild(h("div", { "data-live-podium": "1" }));
  } else if (reveal) {
    wrap.appendChild(revealPanel(reveal, question, { mine: null }));
    wrap.appendChild(h("div", { "data-live-podium": "1" }));
  } else {
    wrap.appendChild(questionPanel(question, {}));
    wrap.appendChild(h("div", { "data-live-podium": "1" }));
    wrap.appendChild(h("div", { class: "panel" },
      h("div", { class: "panel-head" },
        h("h2", {}, "Ответили"),
        h("span", { class: "badge badge-neutral", "data-answered": "1" },
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
      ? h("div", { class: "screen-timer-box" },
        questionTotalMs() ? ringTimer({ totalMs: questionTotalMs(), leftMs: left }) : null,
        h("div", { class: "screen-timer", "data-live-clock": "1" }, formatClock(left)))
      : h("div", { class: "screen-timer screen-timer-empty" }, "")
  ));

  if (finishedRoom) {
    const podium = finalSequence({ projector: true });
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

  // Табло: рейтинг крупными карточками в стиле вокзального табло.
  // Контейнер с точечным обновлением: updateScreenBoard перерисовывает
  // топ-8 только при изменении очков/мест, без пересборки вида.
  if (!finishedRoom) {
    wrap.appendChild(h("div", { class: "screen-board-wrap", "data-screen-board": "1" }));
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

// Общий рейтинг карточками: место, аватар, ФИО, баллы, % верных, число
// вопросов, статус; своя строка подсвечена, у серии — значок огня/молнии.
// Содержимое собирает updateRatingPanels: рейтинг меняется при каждом
// пересчёте очков, поэтому он точечный, без пересборки вида.
function ratingPanel({ title = "Общий рейтинг", limit = null } = {}) {
  // Один и тот же DOM-узел переезжает в новый вид: карточки остаются на
  // месте, поэтому места меняются плавно (FLIP), а не пересоздаются.
  const key = `${title}|${limit || 0}`;
  const kept = ratingNodes.get(key);
  if (kept) return kept;
  const node = buildRatingPanel({ title, limit });
  ratingNodes.set(key, node);
  return node;
}

function buildRatingPanel({ title, limit }) {
  return h("section", {
    class: "panel live-rating",
    "aria-label": title,
    "data-rating-limit": limit ? String(limit) : ""
  },
    h("div", { class: "panel-head" },
      h("h2", {}, title),
      h("span", { class: "badge badge-neutral", "data-rating-count": "1" }, "")));
}

function progressPanel(li, room) {
  const total = room.questionCount || 0;
  const label = li.lifecycle === "waiting" ? lt("room.notStarted")
    : li.lifecycle === "in_progress"
      ? (li.phase === "question" ? `Вопрос ${li.position + 1} из ${total}`
        : li.position + 1 >= total ? "Последний вопрос завершён"
        : `Пауза перед вопросом ${li.position + 2} из ${total}`)
      : lt("room.finished");
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

function peopleChips(kind, emptyText) {
  return peopleBox(kind, emptyText);
}

function settingsSummary(room) {
  const order = room.shuffleQuestions ? "случайный" : "последовательный";
  const totalMin = Math.round(((room.questionCount || 0) * ((room.questionSec || 0) + (room.gapSec || 0))) / 60);
  return `Вопросов: ${room.questionCount || 0} · ${room.questionSec} с на вопрос + пауза ${room.gapSec} с · порядок: ${order} · бонус за скорость: ${room.speedBonus === false ? "нет" : "да"} · ≈ ${totalMin} мин`;
}

// Данные для оценок и подробного отчёта: только реальные сохранённые ответы
// и ключи теста (не строки рейтинга, где есть бонусы за скорость и серию).
function liveReportInput() {
  const room = local.room;
  const li = liveInfo();
  const plan = li.plan;
  const keysByPos = local.keysReady ? keysByPosition(local.keys, room) : [];
  const positions = plan
    ? finishedPositions(plan, serverNowMs())
    : Object.keys(local.reveals || {}).map(Number).sort((a, b) => a - b);
  const questions = keysByPos.map((_, position) =>
    local.test?.questions?.[questionIndexAt(room, position)] || null);
  const starts = plan ? autoQStarts(plan) : qStartsMs(room);
  const players = local.players.map(raw => {
    const times = normalizePlayerTimes(raw).times || {};
    const durations = {};
    for (const qid of Object.keys(times)) {
      const start = starts[qid] ?? toMs(raw.shown?.[qid]);
      if (typeof times[qid] === "number" && start) durations[qid] = Math.max(0, times[qid] - start);
    }
    return { ...raw, durations };
  });
  return { players, keysByPos, questions, positions };
}

// ---------- Единый итоговый экран Live с вкладками ----------
// Один постоянный узел (переживает перерисовку вида, как рейтинг).
// Вкладки переключают готовые панели без пересборки страницы и без
// повторной загрузки комнаты: смена вкладки двигает кэшированный узел,
// данные пересчитываются только при реальном изменении ответов/дуэлей
// (подпись finalDockSig). Активная вкладка сохраняется между кадрами.
const FINAL_TABS = [
  { id: "overview", label: "Обзор" },
  { id: "rating", label: "Рейтинг" },
  { id: "stats", label: "Статистика" },
  { id: "students", label: "Участники" },
  { id: "journal", label: "Журнал" },
  { id: "recs", label: "Рекомендации" }
];

function finalDockNode() {
  if (!finalDock) {
    const tablist = h("div", { class: "final-tabs", role: "tablist", "aria-label": "Вкладки итогов" },
      FINAL_TABS.map(t => h("button", {
        type: "button", class: "final-tab", role: "tab",
        "data-tab": t.id,
        "aria-controls": `final-pane-${t.id}`,
        onclick: () => { finalTab = t.id; renderFinalTab(); }
      }, t.label)));
    // Клавиатура: ← и → переключают вкладки, как требуют табы ARIA.
    tablist.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const ids = FINAL_TABS.map(t => t.id);
      const idx = Math.max(0, ids.indexOf(finalTab));
      const next = e.key === "ArrowRight" ? (idx + 1) % ids.length : (idx - 1 + ids.length) % ids.length;
      finalTab = ids[next];
      renderFinalTab();
      finalDock.querySelector(`[data-tab="${finalTab}"]`)?.focus();
    });
    finalDock = h("section", { class: "panel live-final", "aria-label": "Итоги Live" },
      tablist,
      h("div", { class: "final-pane", role: "tabpanel", "data-final-pane": "1" }));
    finalDockSig = "";
  }
  updateFinalDock();
  return finalDock;
}

// Данные итогового экрана: оценки и отчёт строятся один раз на изменение.
function finalData() {
  const input = liveReportInput();
  const grades = gradeRoster(input);
  return { input, grades, report: buildLiveReport(input) };
}

// ---------- История завершённых комнат (снимок итогов) ----------
// При завершении комнаты ведущий один раз сохраняет снимок отчёта в
// roomHistory/{код}. Идемпотентность: код = id документа (второй документ
// невозможен), клиент пишет только если документа ещё нет; повторная
// отправка события завершения (возврат на страницу, перезагрузка) не
// создаёт дубликат и не меняет уже сохранённый снимок — «exists»
// считается успехом. Ошибки сети не глушатся: попытка повторится на
// следующем кадре scheduleRender.
function manageHistorySave() {
  if (historySaveBusy || historySavedCode === local.code) return;
  const room = local.room;
  if (!room || role() !== "host" || !local.keysReady) return;
  const done = room.status === "closed"
    || liveInfo().lifecycle === "completed"
    || liveInfo().lifecycle === "closed";
  if (!done) return;
  historySaveBusy = true;
  (async () => {
    const { input, grades, report } = finalData();
    const snapshot = buildRoomHistorySnapshot({
      room,
      test: local.test,
      players: local.players,
      scores: local.scores,
      duels: local.duels,
      keysByPos: input.keysByPos,
      questions: input.questions,
      positions: input.positions,
      grades,
      report,
      meta: finalMeta
    });
    const result = await saveRoomHistory(snapshot);
    if (result.saved || result.reason === "exists") {
      historySavedCode = room.code;
    }
  })().catch(err => {
    console.error("История Live-комнат:", err);
  }).finally(() => {
    historySaveBusy = false;
  });
}

// Панель вкладки. Каждый случай собирается из существующих модулей:
// готовые графики/таблицы не переписываются. Рейтинг и дуэли — живые
// узлы (обновляются сами), отчёт и журнал — по данным итога.
function buildFinalPane(id, { grades, report } = {}) {
  const room = local.room;
  switch (id) {
    case "overview":
      return overviewPanel({
        title: room?.testTitle || "Итоги Live",
        subject: finalMeta.subject,
        topic: finalMeta.topic,
        finishedLabel: finalFinishedLabel(room),
        participants: local.players.filter(p => roleOfPlayer(p) !== ROLE_OBSERVER).length,
        observers: local.players.filter(p => roleOfPlayer(p) === ROLE_OBSERVER).length,
        group: report?.group,
        verdict: report?.verdict
      });
    case "rating": {
      const stack = h("div", { class: "final-pane-stack" });
      stack.appendChild(ratingPanel({ title: "Полный рейтинг участников" }));
      const duels = duelsPanel();
      if (duels) stack.appendChild(duels);
      return stack;
    }
    case "stats":
      return reportSection(report, { title: "Статистика", sections: ["group", "questions"] });
    case "students":
      return studentsPanel(report, grades);
    case "journal":
      return journalPanel(journalRows(grades), {
        grades,
        export: {
          title: room?.testTitle || "",
          dateMs: finalFinishedMs(room)
        }
      });
    case "recs":
      return recommendationsPanel(report);
    default:
      return h("div", { class: "muted" }, "Вкладка недоступна.");
  }
}

// Дата завершения: метка досрочного/автоматического конца или закрытия
// комнаты. Нет метки — «—», дату не выдумываем.
function finalFinishedMs(room) {
  return toMs(room?.autoEndedAt) || toMs(room?.closedAt) || toMs(room?.updatedAt) || null;
}

function finalFinishedLabel(room) {
  const ms = finalFinishedMs(room);
  if (!ms) return "—";
  return new Date(ms).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

// Показ активной вкладки: панель берётся из кэша, переключение не
// пересобирает её; aria-атрибуты синхронизируются с ARIA-табами.
function renderFinalTab() {
  if (!finalDock || !local.keysReady) return;
  for (const btn of finalDock.querySelectorAll(".final-tab")) {
    const active = btn.dataset.tab === finalTab;
    btn.classList.toggle("active", active);
    if (active) btn.setAttribute("aria-selected", "true");
    else btn.setAttribute("aria-selected", "false");
    btn.tabIndex = active ? 0 : -1;
  }
  const paneHost = finalDock.querySelector("[data-final-pane]");
  if (!paneHost) return;
  let pane = finalTabPanes.get(finalTab);
  if (!pane) {
    pane = buildFinalPane(finalTab, finalData());
    finalTabPanes.set(finalTab, pane);
  }
  pane.id = `final-pane-${finalTab}`;
  pane.setAttribute("aria-labelledby", `final-tab-${finalTab}`);
  paneHost.replaceChildren(pane);
}

function updateFinalDock() {
  if (!finalDock || !local.keysReady) return;
  const input = liveReportInput();
  // Подпись данных: ответы и проведённые вопросы, дуэли (панель в
  // вкладке «Рейтинг»), предмет/тема (подгружаются асинхронно), название.
  const sig = [
    input.positions.join(","),
    input.players.map(p => `${p.uid}:${p.role || ""}:${JSON.stringify(p.answers || {})}`).sort().join("|"),
    duelSig(),
    local.room?.testTitle || "",
    finalMeta.subject,
    finalMeta.topic
  ].join("#");
  const scrollY = window.scrollY;
  if (sig !== finalDockSig) {
    finalDockSig = sig;
    // Данные изменились — кэш панелей недействителен: активная панель
    // пересобирается сейчас, остальные лениво при переключении.
    finalTabPanes.clear();
  }
  renderFinalTab();
  if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
}

// Предмет и тема для «Обзора»: имена по id теста, один раз, необязательно.
// Нет доступа или полей — вкладка показывает «не указаны», ошибок нет.
async function resolveFinalMeta(test) {
  const subjectId = typeof test?.subjectId === "string" ? test.subjectId : "";
  const topicId = typeof test?.topicId === "string" ? test.topicId : "";
  if (!subjectId && !topicId) return;
  try {
    const [subject, topic] = await Promise.all([
      subjectId ? getSubject(subjectId).catch(() => null) : Promise.resolve(null),
      topicId ? getTopic(topicId).catch(() => null) : Promise.resolve(null)
    ]);
    const next = {
      subject: subject?.title || "",
      topic: topic?.title || ""
    };
    if (next.subject !== finalMeta.subject || next.topic !== finalMeta.topic) {
      finalMeta = next;
      if (finalDock?.isConnected) updateFinalDock();
    }
  } catch (err) {
    console.error("Предмет/тема теста:", err);
  }
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
      lt("room.start"));
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
        toast(tr("room.startedAuto"), "success");
      } catch (err) {
        console.error("Запуск теста:", err);
        toast(err?.message || tr("room.startFailed"), "error");
        startBtn.disabled = false;
        startBtn.textContent = tr("room.start");
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
        h("h3", {}, "Участники (", h("span", { "data-people-count": "participants" }, String(playersCount)), ")"),
        peopleChips("participants", "Пока никто не вошёл — покажите QR или код."),
        h("h3", {}, "Наблюдатели (", h("span", { "data-people-count": "observers" }, String(observersCount)), ")"),
        peopleChips("observers", "Наблюдателей нет."),
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
        toast(tr("room.finishedEarly"), "success");
      } catch (err) {
        toast(err?.message || tr("room.finishFailed"), "error");
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
        h("span", { class: "badge badge-neutral" },
          "ответили ",
          h("span", { "data-answered": "1" }, `${answered} из ${playersCount}`))),
      h("div", { class: "panel-body" },
        h("div", { class: "btn-row" }, finishBtn, regBtn),
        h("p", { class: "form-hint" },
          "Вопросы идут автоматически по расписанию. Эту страницу лучше держать открытой: она раскрывает ответы и считает баллы."))));
    wrap.appendChild(ratingPanel());
  } else {
    // completed / closed. Единый итоговый экран: название теста → подиум →
    // экран с вкладками (Обзор · Рейтинг · Статистика · Участники ·
    // Журнал · Рекомендации). Вкладки переключаются без пересборки вида.
    wrap.appendChild(h("div", { class: "final-title" },
      h("h2", {}, room.testTitle || "Итоги Live"),
      h("p", { class: "muted" }, "Итоги Live-тестирования")));
    wrap.appendChild(progressPanel(li, room));
    const hostSeq = finalSequence();
    if (hostSeq) wrap.appendChild(hostSeq);
    wrap.appendChild(finalDockNode());
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
      h("p", { class: "page-sub" }, `Код комнаты: ${room.code || room.id}`)),
    h("div", { class: "room-head-tools" }, themeToggle()));
}

function lobbyPanel(room, who) {
  const text = who === "observer"
    ? "Вы подключены как наблюдатель. Рейтинг и ход теста появятся после старта."
    : "Вы подключены. Тест начнётся, когда ведущий нажмёт «" + tr("room.start") + "» — вопросы пойдут сами.";
  return h("div", { class: "panel" },
    h("div", { class: "empty-state" },
      h("div", { class: "empty-state-icon", innerHTML: icons.clock }),
      h("h2", {}, "Вы в комнате — ожидаем начала"),
      h("p", { class: "muted" }, text),
      h("p", { class: "muted" }, "Ведущий: ", `${room.hostName || "Преподаватель"} · Участников: `,
        h("b", { "data-people-count": "participants" }, "")),
      local.playersLoaded && !local.errors.players
        ? peopleChips("participants", "")
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

// Мои результаты по закрытым вопросам с разбивкой очков по единой формуле
// (core/rooms-logic.js): «Верно: 10 · Серия ×1.2 · Скорость +4 = 16 б.».
function myResults() {
  const me = myPlayer();
  if (!me) return [];
  const li = liveInfo();
  const times = normalizePlayerTimes(me).times || {};
  const starts = li.plan ? autoQStarts(li.plan) : qStartsMs(local.room);
  const duration = li.plan ? li.plan.questionSec : questionDurationSec(local.test, local.room?.settings);
  const speedOn = local.room?.speedBonus !== false;
  const ids = Object.keys(local.reveals || {}).sort((a, b) => Number(a) - Number(b));
  let streak = 0;
  return ids.map(qid => {
    const reveal = local.reveals[qid];
    const answer = me.answers?.[qid];
    if (answer == null) { streak = 0; return { qid, answered: false, correct: false, breakdown: null }; }
    if (myAnswerVerdict(reveal, answer) !== true) { streak = 0; return { qid, answered: true, correct: false, breakdown: null }; }
    streak += 1;
    const speed = speedOn && duration && starts[qid] && typeof times[qid] === "number"
      ? speedRatio(duration, times[qid] - starts[qid]) : 0;
    const base = reveal.reveal?.points || reveal.points || 1;
    return { qid, answered: true, correct: true, breakdown: scoreBreakdown(base, { streak, speed }) };
  });
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
      h("p", { class: "gap-breakdown", "data-breakdown": "1" }, (() => {
        const mine = myResults().find(r => r.qid === String(li.qid));
        return mine ? formatBreakdown(mine) : "";
      })()),
      gapCountdown({ label: last ? "Результаты появятся через" : "Следующий вопрос через", msLeft: li.msLeft || 0 })));
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

// ---------- Дуэли за места (участник) ----------
// Участник группы ничьей получает вопрос раунда здесь же, на итоговом
// экране, и отвечает один раз; результат появится после закрытия раунда.

function duelAnswerId(group) {
  return `${group.id}__${group.currentRound}__${State.user?.uid}`;
}

// Свой ответ на открытый раунд: правила отдают участнику только его
// документ; проверяем один раз на пару (группа, раунд).
function ensureMyDuelAnswerKnown(answerId) {
  if (duelAnswerKnown.has(answerId)) return;
  duelAnswerKnown.set(answerId, false);
  getDoc(doc(db, "rooms", local.code, "duels", "final", "answers", answerId))
    .then(snap => {
      if (snap.exists()) {
        duelAnswerKnown.set(answerId, true);
        lastSignature = null;
        scheduleRender(null);
      }
    })
    .catch(err => console.warn("Ответ дуэли:", err?.code || err));
}

// Форма ответа на раунд дуэли: тот же состав полей, что в answerForm,
// но запись идёт в answers дуэли и не влияет на основной тест.
function duelAnswerForm(group, question) {
  const answerId = duelAnswerId(group);
  ensureMyDuelAnswerKnown(answerId);

  const head = h("div", { class: "panel-head" },
    h("h2", {}, "Дуэль за место"),
    h("span", { class: "badge badge-neutral" }, `раунд ${group.currentRound} · ${question.points || 1} б.`));
  const panel = h("section", { class: "panel" }, head);

  if (duelAnswerKnown.get(answerId) === true) {
    return h("section", { class: "panel" }, head,
      h("div", { class: "panel-body" },
        h("p", { class: "form-hint" }, "Ответ принят — ждём закрытия раунда.")));
  }

  const submitBtn = h("button", { type: "button", class: "btn primary btn-block" }, "Ответить");
  const message = h("div", { class: "form-hint", role: "status" });
  const name = `duel-q-${group.id}-${question.type || "single"}`;

  const submit = async (value, successNote) => {
    message.textContent = "";
    message.className = "form-hint";
    submitBtn.disabled = true;
    try {
      await saveDuelAnswer(local.code, answerId, value);
      duelAnswerKnown.set(answerId, true);
      toast(successNote, "success");
      lastSignature = null;
      scheduleRender(null);
    } catch (err) {
      console.error("Ответ дуэли:", err);
      message.textContent = err?.code === "permission-denied"
        ? "Ответ уже принят или раунд закрыт."
        : "Не удалось отправить ответ (нет сети?)";
      message.className = "form-error";
      submitBtn.disabled = false;
    }
  };

  if (question.type === "short") {
    const input = h("input", { class: "form-control", type: "text", "aria-label": "Ответ" });
    panel.appendChild(h("div", { class: "panel-body" },
      h("div", { class: "field" }, input), submitBtn, message));
    submitBtn.addEventListener("click", () => {
      const value = input.value.trim();
      if (!value) { message.textContent = "Введите ответ."; message.className = "form-error"; return; }
      submit(value, "Ответ на раунд принят");
    });
  } else if (question.type === "multiple") {
    const checkboxes = [];
    panel.appendChild(h("div", { class: "panel-body" },
      h("div", { class: "options" },
        (question.options || []).map((option, index) => {
          const cb = h("input", { type: "checkbox", id: `${name}-${index}`, value: String(index) });
          checkboxes.push(cb);
          return h("label", { class: "option", for: `${name}-${index}` }, cb, option.text || "—");
        })),
      submitBtn, message));
    submitBtn.addEventListener("click", () => {
      const value = checkboxes.filter(cb => cb.checked).map(cb => Number(cb.value));
      if (!value.length) { message.textContent = "Отметьте хотя бы один вариант."; message.className = "form-error"; return; }
      submit(value, "Ответ на раунд принят");
    });
  } else {
    const radios = [];
    panel.appendChild(h("div", { class: "panel-body" },
      h("div", { class: "options" },
        (question.options || []).map((option, index) => {
          const rb = h("input", { type: "radio", name, id: `${name}-${index}`, value: String(index) });
          radios.push(rb);
          return h("label", { class: "option", for: `${name}-${index}` }, rb, option.text || "—");
        })),
      submitBtn, message));
    submitBtn.addEventListener("click", () => {
      const checked = radios.find(rb => rb.checked);
      if (!checked) { message.textContent = "Выберите вариант."; message.className = "form-error"; return; }
      submit(Number(checked.value), "Ответ на раунд принят");
    });
  }

  // Текст вопроса — над формой ответа.
  panel.insertBefore(questionPanel(question), panel.querySelector(".panel-body"));
  return panel;
}

// Блок дуэли в итоговом виде участника: вопрос раунда, статусы групп,
// решение преподавателя. Участники без ничьей блок не получают.
function duelPlayerWidget() {
  const doc = local.duels;
  const uid = State.user?.uid;
  if (!doc || !uid) return null;
  const group = (doc.groups || []).find(g => (g.uids || []).includes(uid));
  if (!group) return null;
  if (group.status === "resolved") {
    return h("p", { class: "form-hint" },
      group.decision
        ? "Ваше место определено решением преподавателя."
        : "Ваше место определено дуэлью.");
  }
  if (group.status === "pending") {
    return h("div", { class: "panel" },
      h("div", { class: "panel-body" },
        h("h3", {}, "Место ещё не определено"),
        h("p", { class: "muted" },
          "Дуэль не дала перевеса — ведущий примет решение. Итоговый рейтинг обновится автоматически.")));
  }
  if (group.currentQid != null) {
    const question = (local.test?.questions || [])[Number(group.currentQid)];
    if (question) return duelAnswerForm(group, question);
    return h("div", { class: "panel" },
      h("div", { class: "panel-body" }, h("p", { class: "muted" }, "Загружаем вопрос дуэли…")));
  }
  return h("div", { class: "panel" },
    h("div", { class: "panel-body" },
      h("h3", {}, "Дуэль за место"),
      h("p", { class: "muted" },
        "Вы претендуете на одно место с другим участником. Ведущий проводит раунды — вопрос появится здесь.")));
}

function finishedPlayerView(wrap, room, li) {
  const rows = ratingSource();
  wrap.appendChild(h("div", { class: "final-title" },
    h("h2", {}, room.testTitle || "Итоги Live"),
    h("p", { class: "muted" }, "Итоги Live-тестирования")));
  const seq = finalSequence();
  if (seq) wrap.appendChild(seq);
  const mine = rows.find(r => r.uid === State.user?.uid);
  wrap.appendChild(h("section", { class: "panel" },
    h("div", { class: "panel-head" },
      h("h2", {}, li.lifecycle === "closed" ? "Комната закрыта — ваш результат" : lt("room.finished"))),
    h("div", { class: "panel-body" },
      mine
        ? h("div", { class: "quick-actions" },
            h("div", { class: "quick-action" }, h("b", {}, `${mine.place}`), h("span", {}, "место")),
            h("div", { class: "quick-action" }, h("b", {}, `${mine.score}`), h("span", {}, "баллов")),
            h("div", { class: "quick-action" }, h("b", {}, `${mine.percent}%`), h("span", {}, "верных"))) 
        : h("p", { class: "muted" }, "Ваш результат появится, как только ведущий подведёт итоги."),
      mine ? h("p", { class: "muted" }, `Верных ответов: ${mine.correctCount} из ${room.questionCount || 0}`) : null)));
  const results = myResults();
  if (results.length) {
    wrap.appendChild(h("section", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Как считались баллы")),
      h("ol", { class: "live-accuracy" },
        results.map((r, i) => h("li", {}, `Вопрос ${i + 1}: ${formatBreakdown(r)}`)))));
  }
  const duelWidget = duelPlayerWidget();
  if (duelWidget) wrap.appendChild(duelWidget);
  wrap.appendChild(ratingPanel({ title: "Итоговый рейтинг" }));
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
    h("div", { class: "quick-action" },
      h("b", { "data-people-count": "participants" }, String(participants.length)), h("span", {}, "участников")),
    h("div", { class: "quick-action" },
      h("b", { "data-people-count": "observers" }, String(observers)), h("span", {}, "наблюдателей")),
    h("div", { class: "quick-action" },
      h("b", {}, `${Math.max(0, li.lifecycle === "waiting" ? 0 : li.position + (li.phase === "gap" || li.phase === "done" ? 1 : 0))}/${room.questionCount || 0}`),
      h("span", {}, "вопросов пройдено"))));
  if (li.lifecycle === "waiting") {
    wrap.appendChild(lobbyPanel(room, "observer"));
  } else {
    wrap.appendChild(progressPanel(li, room));
  }
  if (li.lifecycle === "completed" || li.lifecycle === "closed") {
    const obsSeq = finalSequence();
    if (obsSeq) wrap.appendChild(obsSeq);
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

function skeletonPanel() {
  return h("div", { class: "room-view" },
    h("div", { class: "panel" },
      h("div", { class: "skeleton" },
        h("div", { class: "skeleton-line", style: "width: 60%; margin-bottom: 1rem" }),
        h("div", { class: "skeleton-line", style: "width: 80%; margin-bottom: 1rem" }),
        h("div", { class: "skeleton-line", style: "width: 70%; margin-bottom: 1rem" }),
        h("div", { class: "skeleton-line", style: "width: 50%; margin-bottom: 1rem" }),
        h("div", { class: "skeleton-line", style: "width: 90%; margin-bottom: 1rem" }),
        h("div", { class: "skeleton-line", style: "width: 60%; margin-bottom: 1rem" }))
    )
  );
}

// connecting: идёт проверка членства и загрузка комнаты. Тупика здесь нет:
// по ошибке или через 15 секунд клиент уходит в connection_error с кнопкой.
function connectingPanel(code, showRetry = false) {
  const retry = h("button", { type: "button", class: "btn primary btn-block", style: showRetry ? "" : "display:none" }, "Повторить");
  retry.addEventListener("click", () => { router(); });
  return h("div", { class: "room-view" },
    h("div", { class: "panel" },
      h("div", { class: "empty-state" },
        emptyIcon("users"),
        h("h2", {}, "Подключаемся к комнате…"),
        h("p", { class: "muted" }, `Код ${code}.`),
        showRetry ? h("p", { class: "muted" }, "Подключение занимает больше времени, чем обычно. Проверьте интернет или попробуйте позже.") : null,
        retry
      )
    )
  );
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
