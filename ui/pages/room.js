// ui/pages/room.js — единый экран Live-комнат: host, player, observer
// и проектор (#room/CODE/screen — только ведущий).
// Перерисовка только при изменении сигнатуры (where правилом поля ввода
// участника не теряет фокус). Таблица лидеров живёт вне сменной
// перерисовки: так техника FLIP сравнивает позиции строк между кадрами.
import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import {
  subscribeRoom, openQuestion, closeQuestion, saveAnswer, closeRoom,
  questionDurationSec, sendReaction, subscribeReactions
} from "../../core/rooms.js";
import {
  questionTimeMs, answeredCount, myAnswerVerdict
} from "../../core/rooms-logic.js";
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
let autoTimer = null;   // автозакрытие у ведущего
let tickTimer = null;   // звук последних 5 секунд
let pageRef = null;
let leaderRef = null;
let reactionRef = null;
let floatsRef = null;
let confettiTimer = null;
const autoClosed = new Set();
let lastSignature = null;
let lastBoardSig = null;
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

function reset() {
  unsubs.forEach(fn => { try { fn(); } catch (e) { /* уже отписаны */ } });
  unsubs = [];
  stopInterval(autoTimer); autoTimer = null;
  stopInterval(tickTimer); tickTimer = null;
  if (confettiTimer) { clearTimeout(confettiTimer); confettiTimer = null; }
  autoClosed.clear();
  lastSignature = null;
  lastBoardSig = null;
  lastRanks = null;
  lastScores = null;
  shownReactions = new Map();
  prev = null;
  lastReactionTs = 0;
  profilesLoaded = false;
  pageRef = null;
  leaderRef = null;
  local = { room: null, players: [], scores: [], reveals: {}, reactions: [], profiles: new Map(), test: null, keys: null, receivedMs: 0, code: "" };
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
  const players = (local.players || []).filter(p => !p.observer).length;
  if (!room || room.status !== "active") return;
  if (room.playersCount != null && room.playersCount === players) return;
  updateDoc(doc(db, "rooms", local.code), {
    playersCount: players,
    updatedAt: serverTimestamp()
  }).catch(err => console.error("playersCount:", err));
}

function role() {
  if (!local.room) return null;
  if (isStaff() && local.room.hostId === State.user?.uid) return "host";
  const me = local.players.find(p => p.uid === State.user?.uid);
  if (me) return me.observer ? "observer" : "player";
  return null;
}

function myPlayer() {
  return local.players.find(p => p.uid === State.user?.uid) || null;
}

function signature() {
  const room = local.room;
  const my = myPlayer();
  const myAnswer = room?.phase === "opened" && room?.currentQuestionId
    ? my?.answers?.[String(room.currentQuestionId)]
    : null;
  const revealId = room?.phase === "closed" && room?.currentQuestionId
    ? (local.reveals?.[String(room.currentQuestionId)] ? "on" : "off")
    : "-";
  const answers = (local.players || [])
    .filter(p => !p.observer)
    .map(p => `${String(p.uid).slice(0, 6)}:${Object.keys(p.answers || {}).length}`)
    .sort()
    .join(",");
  const ids = (local.players || []).map(p => String(p.uid).slice(0, 6)).sort().join(",");
  return [
    room ? room.status : "no-room",
    String(room?.currentQuestionId ?? ""),
    String(room?.phase ?? ""),
    String(room?.qStartedMs ?? ""),
    String(local.players.length),
    `ids=${ids}`,
    `answers=${answers}`,
    `reveal=${revealId}`,
    `me=${myAnswer != null ? 1 : 0}`,
    `role=${role()}`,
    `test=${local.test ? 1 : 0}`
  ].join("~");
}

// Оставшееся время открытого вопроса в мс (или null, если не ограничено).
function openMsLeft() {
  const room = local.room;
  if (!room || room.phase !== "opened") return null;
  const started = questionTimeMs(room.qStartedMs, local.receivedMs);
  const duration = questionDurationSec(local.test, room.settings);
  if (!duration) return null;
  return started + duration * 1000 - Date.now();
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
      return data.items || data.keys || {};
    }
  } catch (err) {
    console.error("testKeys:", err);
  }
  return {};
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

export default async function RoomPage() {
  const rawRoute = decodeURIComponent((State.routeParam || ""));
  const parts = rawRoute.split("/");
  const codeRaw = parts[0] || "";
  const isScreen = parts[1] === "screen";
  const page = h("div", {
    class: "page room-page" + (isScreen ? " room-screen-page" : "")
  });

  let code = "";
  try {
    const probe = await probeRoom(codeRaw);
    if (!probe) {
      page.appendChild(notFoundPanel());
      return page;
    }
    code = probe.id;
    local.code = code;
    local.room = { ...probe, id: probe.id };
    local.test = await loadTestPublic(probe.testId);
    if (probe.hostId === State.user.uid && isStaff()) {
      local.keys = await loadKeys(probe.testId);
    }
  } catch (err) {
    console.error("Комната:", err);
    page.appendChild(errorPanel(err));
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

  // Подписки. Каждый снапшот обновляет состояние и дергает wake():
  // сначала события звуков, затем перерисовка по сигнатуре.
  const wake = () => { onStateUpdate(page, isScreen); };
  unsubs.push(subscribeRoom(code, {
    onRoom: room => {
      local.room = room ? { ...room, qStartedMs: toMs(room.qStartedAt) } : null;
      local.receivedMs = Date.now();
      wake();
    },
    onPlayers: players => {
      local.players = players;
      loadProfiles().catch(err => console.error(err));
      wake();
      publishCounter();
    },
    onError: error => console.error("Комната snapshot:", error)
  }));

  unsubs.push(onSnapshot(
    collection(db, "rooms", code, "scores"),
    snapshot => {
      local.scores = snapshot.docs.map(item => ({ uid: item.id, ...item.data() }));
      wake();
    },
    error => console.error("scores snapshot:", error)
  ));

  unsubs.push(onSnapshot(
    collection(db, "rooms", code, "reveals"),
    snapshot => {
      local.reveals = {};
      snapshot.docs.forEach(item => { local.reveals[item.id] = item.data(); });
      wake();
    },
    error => console.error("reveals snapshot:", error)
  ));

  // Реакции: свои шлём кнопками, чужие показываем всплывающими эмодзи.
  unsubs.push(subscribeReactions(
    code,
    reactions => { local.reactions = reactions; wake(); },
    error => console.error("reactions snapshot:", error)
  ));

  if (!isScreen) page.appendChild(statusBar());
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

// ---------- Каркас ----------

function statusBar() {
  const room = local.room;
  const text = !room
    ? "Ждём комнату…"
    : room.status === "closed"
      ? "Комната закрыта"
      : room.phase === "idle"
        ? "Ожидание первого вопроса"
        : room.phase === "opened"
          ? `Вопрос ${Number(room.currentQuestionId) + 1} из ${room.questionCount || "?"}`
          : "Вопрос закрыт";
  const me = myPlayer();
  const suffix = me ? me.observer ? " · вы наблюдатель" : " · вы участник" : "";
  const bar = h("div", { class: "room-status", role: "status" });
  bar.append(text + suffix, soundToggle());
  return bar;
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
  updateLeaderboard();
  updateReactionBar();
  showFloats();
  ensureTickTimer();
}

function renderPage(page) {
  const existing = page.querySelector(".room-view");
  const next = buildView();
  if (existing) existing.replaceWith(next);
  else page.insertBefore(next, page.querySelector(".room-leaderboard-host"));
  updateLeaderboard();
}

// Снапшоты → события (звуки, вибрация, вспышки) → реакция на статусы.
function onStateUpdate(page, isScreen) {
  const room = local.room;
  const now = { status: room?.status || "", phase: room?.phase || "", qid: room?.currentQuestionId || "" };
  const ids = (local.players || []).map(p => p.uid).sort().join(",");
  const myRank = rankOf(myPlayer()?.uid);
  const reveal = room?.phase === "closed" ? room && local.reveals?.[now.qid] : null;
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
    if (room?.status === "closed" && prev.status === "active") {
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

// Ссылка входа в комнату для участников: #join/<код> — гостевая форма
// с подставленным кодом (авторизованным — обычный вход). #room требует
// авторизации, по QR гость туда попасть не может.
function joinUrl(code) {
  return `${window.location.origin}${window.location.pathname}#join/${code}`;
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

// Рисует SVG QR-кода внутрь элемента.
function paintQR(box, code) {
  if (!box || !code) return;
  try {
    box.innerHTML = generateQRSvg(joinUrl(code), roomQROptions);
  } catch (err) {
    console.error("QR generation failed:", err);
  }
}

async function initRoomQR(room) {
  const qrWrapper = document.querySelector('.qr-wrapper');
  const copyBtn = document.getElementById('copy-link');
  const downloadBtn = document.getElementById('download-qr');

  if (!qrWrapper || !copyBtn || !downloadBtn) return;

  const url = joinUrl(room.code);
  paintQR(qrWrapper, room.code);

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

function errorPanel(err) {
  return h("div", { class: "panel room-view" },
    h("div", { class: "empty-state" },
      h("div", { class: "empty-state-icon", innerHTML: icons.users }),
      h("h2", {}, "Не удалось открыть комнату"),
      h("p", { class: "muted" }, err?.code === "permission-denied"
        ? "Правила Firestore не разрешают доступ."
        : "Проверьте подключение к сети и попробуйте снова."),
      h("a", { class: "btn secondary", href: "#join" }, "Вернуться к входу")
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
  if (local.room?.status !== "closed") return null;
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

function hostView() {
  const room = local.room;
  const test = local.test;
  const wrap = h("div", { class: "room-view" });

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
  // QR-код комнаты в фирменном стиле Skillbase.
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

  const playersCount = local.players.filter(p => !p.observer).length;
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

  // Инициализация QR-кода и копирования ссылки.
  initRoomQR(room);

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
    left && left > 0 ? h("span", { class: "timer badge badge-neutral" }, formatClock(left)) : null
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
      ? "Ответ отклонён (правила Firestore): ведущий мог уже закрыть вопрос или вы уже отвечали."
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

  const currentId = room?.phase === "opened" || room?.phase === "closed"
    ? String(room.currentQuestionId)
    : null;
  const question = currentId !== null ? questions[Number(currentId)] : null;
  const reveal = room?.phase === "closed" ? local.reveals?.[currentId] : null;
  const left = openMsLeft();

  wrap.appendChild(h("div", { class: "screen-top" },
    h("div", { class: "screen-title" },
      room?.status === "closed"
        ? "Итоги комнаты"
        : room?.testTitle || "Комната"),
    h("div", { class: "screen-code" }, room?.code || local.code || ""),
    left && left > 0
      ? h("div", { class: "screen-timer" }, formatClock(left))
      : h("div", { class: "screen-timer screen-timer-empty" }, "")
  ));

  if (room?.status === "closed") {
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

// ---------- Роутер вида ----------

function buildView() {
  // Проектор рисуется всё тем же buildView: разбор через локальную метку.
  const rawRoute = decodeURIComponent((State.routeParam || ""));
  if (rawRoute.split("/")[1] === "screen") return screenView();
  const current = role();
  if (current === "host") return hostView();
  if (current === "observer") return observerView();
  if (current === "player") return playerView();
  // Роль ещё не определена: вероятно, игрок не вошёл в комнату.
  return h("div", { class: "room-view" },
    h("div", { class: "panel" },
      h("div", { class: "empty-state" },
        h("div", { class: "empty-state-icon", innerHTML: icons.users }),
        h("h2", {}, "Вы не в этой комнате"),
        h("p", { class: "muted" }, `Войдите по коду ${local.room?.code || local.code || ""}.`),
        h("a", { class: "btn primary", href: `#join/${local.code || ""}` }, "Войти по коду")
      )
    )
  );
}
