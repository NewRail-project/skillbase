// core/scenario-player.js — проигрыватель сценария: настройки, шкала времени,
// пауза, сброс, живой рейтинг и «дуэль только для показа».
//
// Чистая логика без DOM, таймеров и Firestore: время подаёт вызывающий через
// tick(dtMs). Поэтому поведение полностью проверяется тестами в Node.
// Ничего не пишет в базу — модуль её даже не импортирует.
import { runScenario, rankBoard, botUid, POINTS_PER_CORRECT } from "./scenario-sim.js";
import { botNames, BOT_LIMITS, seededRandom } from "./bots-plan.js";
import { createDuelGroup, openDuelRound, applyRound, settleGroup, pendingUidsFor } from "./duel-logic.js";

export const SPEEDS = Object.freeze([1, 2, 5, 10]);
export const SETTING_LIMITS = Object.freeze({
  botCount: Object.freeze({ min: 2, max: BOT_LIMITS.maxBots }),
  questionCount: Object.freeze({ min: 1, max: BOT_LIMITS.maxQuestions }),
  accuracyPct: Object.freeze({ min: 0, max: 100 })
});
export const DEFAULT_SETTINGS = Object.freeze({
  botCount: 10, questionCount: 10, accuracyPct: 60, seed: 1, speed: 1
});

const FIELD_NAMES = {
  botCount: "Ботов",
  questionCount: "Вопросов",
  accuracyPct: "Точность, %"
};

function toNumber(value) {
  if (typeof value === "string" && value.trim() === "") return NaN;
  return Number(value);
}

// Приводит ввод к допустимым значениям. notes — понятные русские пояснения,
// что именно и почему поправлено (для role="status" на экране).
export function clampSettings(raw = {}) {
  const notes = [];
  const settings = {};
  for (const key of ["botCount", "questionCount", "accuracyPct"]) {
    const { min, max } = SETTING_LIMITS[key];
    const n = toNumber(raw[key]);
    let value;
    if (raw[key] === undefined) {
      value = DEFAULT_SETTINGS[key];
    } else if (!Number.isFinite(n)) {
      value = DEFAULT_SETTINGS[key];
      notes.push(`Поле «${FIELD_NAMES[key]}»: нужно число от ${min} до ${max}, подставлено ${value}.`);
    } else {
      value = Math.round(n);
      if (value < min || value > max) {
        value = Math.min(max, Math.max(min, value));
        notes.push(`Поле «${FIELD_NAMES[key]}»: допустимо от ${min} до ${max}, подставлено ${value}.`);
      }
    }
    settings[key] = value;
  }
  const seed = toNumber(raw.seed);
  if (raw.seed === undefined) settings.seed = DEFAULT_SETTINGS.seed;
  else if (!Number.isFinite(seed)) {
    settings.seed = DEFAULT_SETTINGS.seed;
    notes.push(`Поле «Seed»: нужно целое число, подставлено ${settings.seed}.`);
  } else settings.seed = Math.trunc(seed);
  const speed = toNumber(raw.speed);
  settings.speed = SPEEDS.includes(speed) ? speed : DEFAULT_SETTINGS.speed;
  return { settings, notes };
}

// Новый seed: от 1 до 999999. Источник случайности подставляется (для тестов).
export function randomSeed(random = Math.random) {
  return 1 + Math.floor(random() * 999999);
}

// mm:ss
export function formatClock(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// Размер банка дополнительных вопросов дуэли в показе (в настоящей комнате
// банк задаёт тест; здесь он фиксирован, чтобы показ был воспроизводим).
export const DUEL_PREVIEW_BANK = 5;

// Дуэль «только показ»: играет ничью по тем же чистым правилам, что и настоящая
// дуэль (createDuelGroup → openDuelRound → applyRound → settleGroup), на
// дополнительных вопросах. Ответы «дуэлянтов» берутся из seed сценария, поэтому
// показ воспроизводим. Ничего не сохраняет и не пишет в базу.
export function duelPreview(tie, { accuracy = 0.6, seed = 1, index = 0, bankSize = DUEL_PREVIEW_BANK } = {}) {
  const members = (tie.members || []).map(m => ({ name: m.name ?? m }))
    .map(m => ({ ...m, uid: botUid(m.name) }));
  const nameOf = Object.fromEntries(members.map(m => [m.uid, m.name]));
  const random = seededRandom((Math.trunc(Number(seed)) || 0) * 7919 + index + 1);
  let group = createDuelGroup(members, index);
  let guard = 0;
  while (group.status === "running" && guard++ < bankSize + 1) {
    const opened = openDuelRound(group, bankSize);
    if (!opened) break;
    const verdicts = {};
    for (const m of members) verdicts[m.uid] = random() < accuracy;
    group = settleGroup(applyRound(opened, opened.currentQid, verdicts), bankSize);
  }
  const rounds = group.rounds.map(r => ({
    n: r.n,
    marks: Object.fromEntries(Object.entries(r.verdicts).map(([uid, v]) => [nameOf[uid], v])),
    winner: r.winner ? nameOf[r.winner] : null
  }));
  const tally = Object.fromEntries(Object.entries(group.tally).map(([uid, v]) => [nameOf[uid], v]));
  const resolved = group.status === "resolved";
  return {
    members: members.map(m => m.name),
    rounds,
    tally,
    status: group.status, // resolved | pending
    order: resolved ? group.order.map(uid => nameOf[uid]) : null,
    pending: resolved ? [] : pendingUidsFor(group, bankSize).map(uid => nameOf[uid])
  };
}

export function createScenarioPlayer(rawSettings = {}) {
  let settings = clampSettings(rawSettings).settings;
  let notes = clampSettings(rawSettings).notes;
  let status = "idle"; // idle | running | paused | done
  let result = null;
  let elapsedMs = 0;
  let cursor = 0;
  let feed = [];
  let lastProgress = 0;
  let stats = new Map();
  let liveBoard = [];
  let ties = [];
  let finalBoard = null;

  const names = () => botNames(settings.botCount);

  function freshBoard() {
    stats = new Map(names().map(name => [name, 0]));
    liveBoard = rankBoard([...stats.entries()].map(([name, correctCount]) => ({
      uid: botUid(name), name, score: correctCount * POINTS_PER_CORRECT, correctCount
    })));
  }

  function rerank() {
    liveBoard = rankBoard([...stats.entries()].map(([name, correctCount]) => ({
      uid: botUid(name), name, score: correctCount * POINTS_PER_CORRECT, correctCount
    })));
  }

  function resetState() {
    status = "idle";
    result = null;
    elapsedMs = 0;
    cursor = 0;
    feed = [];
    lastProgress = 0;
    ties = [];
    finalBoard = null;
    freshBoard();
  }
  freshBoard();

  function release(upTo) {
    const out = [];
    while (cursor < result.events.length && result.events[cursor].t <= upTo) {
      const event = result.events[cursor++];
      out.push(event);
      if (event.type === "answer") {
        if (event.correct) stats.set(event.bot, (stats.get(event.bot) || 0) + 1);
        feed.push({ t: event.t, bot: event.bot, question: event.question, correct: event.correct });
        lastProgress = event.progress;
        rerank();
      } else if (event.type === "finish") {
        finalBoard = event.board.map(r => ({ ...r }));
        lastProgress = 1;
        status = "done";
        elapsedMs = event.t;
      } else if (event.type === "tie") {
        ties.push({ members: event.members.slice(), places: event.places.slice() });
      }
    }
    return out;
  }

  return {
    // Новые настройки принимаются только до запуска (или после сброса).
    configure(raw) {
      if (status === "running" || status === "paused") return { settings, notes: [] };
      const next = clampSettings({ ...settings, ...raw });
      settings = next.settings;
      notes = next.notes;
      resetState();
      return next;
    },
    // runScenario вызывается ровно один раз — здесь.
    start() {
      if (status === "running" || status === "paused") return false;
      resetState();
      result = runScenario({
        botCount: settings.botCount,
        questionCount: settings.questionCount,
        accuracy: settings.accuracyPct / 100,
        seed: settings.seed
      });
      status = "running";
      release(0);
      return true;
    },
    pause() { if (status !== "running") return false; status = "paused"; return true; },
    resume() { if (status !== "paused") return false; status = "running"; return true; },
    togglePause() {
      if (status === "running") return this.pause();
      if (status === "paused") return this.resume();
      return false;
    },
    reset() { resetState(); },
    setSpeed(value) {
      const n = Number(value);
      if (SPEEDS.includes(n)) settings = { ...settings, speed: n };
    },
    // dtMs — реальное время; в сценарии проходит dtMs × скорость.
    tick(dtMs) {
      if (status !== "running" || !result) return [];
      const dt = Math.max(0, Number(dtMs) || 0);
      elapsedMs += dt * settings.speed;
      return release(elapsedMs);
    },
    snapshot() {
      const totalMs = result ? result.events[result.events.length - 1].t : 0;
      return {
        status,
        settings: { ...settings },
        notes: notes.slice(),
        elapsedMs: Math.min(elapsedMs, totalMs || elapsedMs),
        totalMs,
        progress: status === "done" ? 1 : lastProgress,
        feed: feed.slice(),
        board: liveBoard.map(r => ({ ...r })),
        finalBoard: finalBoard ? finalBoard.map(r => ({ ...r })) : null,
        ties: ties.map(t => ({ members: t.members.slice(), places: t.places.slice() })),
        totalAnswers: result ? result.totalAnswers : 0,
        releasedAnswers: feed.length
      };
    },
    // Дуэль только для показа по ничьей с номером index.
    duel(index) {
      if (!result || status !== "done") return null;
      const group = result.ties[index];
      return group ? duelPreview(group, {
        accuracy: settings.accuracyPct / 100, seed: settings.seed, index
      }) : null;
    },
    result() { return result; }
  };
}
