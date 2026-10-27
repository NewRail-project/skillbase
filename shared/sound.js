// shared/sound.js — звуки Live-комнат на Web Audio API, без файлов.
// AudioContext создаётся/возобновляется по первому жесту пользователя
// (требование браузеров). Каждый звук 80–400 мс, пиковая громкость ≤ 0.2,
// не чаще одного звука на событие за 150 мс. Вибрация navigator.vibrate
// срабатывает, только если поддерживается и звук не выключен вручную.

const STORAGE_KEY = "skillbase.sound";

// Описание звуков. kind: "tone" (одна частота) | "sweep" (скольжение).
export const SOUND_DEFS = {
  // Вход в комнату.
  join: { kind: "sweep", from: 392, to: 587, dur: 180, wave: "sine", gain: 0.14 },
  // Начало вопроса.
  start: { kind: "sweep", from: 330, to: 880, dur: 300, wave: "triangle", gain: 0.15 },
  // Тик последних 5 секунд.
  tick: { kind: "tone", freq: 940, dur: 80, wave: "square", gain: 0.1 },
  // Верный ответ: вверх.
  correct: { kind: "sweep", from: 523, to: 659, dur: 250, wave: "sine", gain: 0.16 },
  // Неверно: вниз.
  wrong: { kind: "sweep", from: 300, to: 170, dur: 220, wave: "sawtooth", gain: 0.12 },
  // Смена места вверх в таблице.
  up: { kind: "sweep", from: 523, to: 1046, dur: 150, wave: "sine", gain: 0.13 },
  // Финал: аккорд-арпеджио из трёх нот в тех же 400 мс.
  final: {
    kind: "tone", dur: 400, wave: "sine", gain: 0.14,
    chord: [784, 988, 1175]
  }
};

// Паттерны вибрации.
export const VIBRATION_DEFS = {
  correct: [30],
  wrong: [60, 40, 60]
};

const GATE_MS = 150;

// Чистый слой: описание звука ограничено 80–400 мс и громкостью ≤ 0.2 —
// проверяется юнит-тестами, чтобы характеристика не «уплыла».
export const SOUND_LIMITS = { durMin: 80, durMax: 400, gainMax: 0.2, gateMs: GATE_MS };

let lastPlayedMs = {};
let ctx = null;
let gestureBound = false;

export function soundEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch (err) {
    return true;
  }
}

export function setSoundEnabled(value) {
  const on = Boolean(value);
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch (err) {
    // Локальное состояние достаточно и без хранилища.
  }
  return on;
}

// AudioContext по первому жесту: браузер требует пользовательского
// события прежде, чем звук пойдёт в выход.
export function ensureAudio() {
  if (!soundEnabled()) return null;
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = ctx || new Ctor();
    if (ctx.state === "suspended") {
      try { ctx.resume(); } catch (err) { /* resume может отклониться */ }
    }
  } catch (err) {
    ctx = null;
  }
  return ctx;
}

// Один раз вешаем жест на весь документ (только в браузере).
function bindGesture() {
  if (gestureBound) return;
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  gestureBound = true;
  const wake = () => { ensureAudio(); };
  for (const event of ["pointerdown", "keydown", "touchstart"]) {
    window.addEventListener(event, wake, { once: true, passive: true });
  }
}
bindGesture();

// Гейт: не чаще одного звука на событие за 150 мс. Чистая — проверяется
// юнит-тестами (lastMs — карта «событие → миллисекунда прошлого раза»).
export function canPlay(name, nowMs, lastMs = lastPlayedMs, gap = GATE_MS) {
  const def = SOUND_DEFS[name];
  if (!def) return false;
  const last = lastMs[name];
  return typeof last !== "number" || nowMs - last >= gap;
}

export function play(name) {
  if (!soundEnabled()) return false;
  const def = SOUND_DEFS[name];
  if (!def) return false;
  const audio = ensureAudio();
  if (!audio) return false;
  const nowMs = typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
  if (!canPlay(name, nowMs, lastPlayedMs)) return false;
  lastPlayedMs[name] = nowMs;
  try {
    const gain = audio.createGain();
    const start = audio.currentTime;
    const peak = Math.min(def.gain, SOUND_LIMITS.gainMax);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(peak, start + Math.min(def.dur * 0.2, 30) / 1000);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + def.dur / 1000);
    gain.connect(audio.destination);

    const nodes = [];
    if (Array.isArray(def.chord)) {
      def.chord.forEach(freq => {
        nodes.push(makeOscillator(audio, def, { freq, gainNode: gain }));
      });
    } else if (def.kind === "tone") {
      nodes.push(makeOscillator(audio, def, { freq: def.freq, gainNode: gain }));
    } else {
      nodes.push(makeOscillator(audio, def, { startFreq: def.from, endFreq: def.to, gainNode: gain }));
    }
    const stopAt = start + def.dur / 1000 + 0.05;
    nodes.forEach(node => {
      try { node.start(start); node.stop(stopAt); } catch (err) { /* уже остановлен */ }
    });
    return true;
  } catch (err) {
    return false;
  }
}

function makeOscillator(audio, def, opts) {
  const osc = audio.createOscillator();
  osc.type = def.wave || "sine";
  if (typeof opts.startFreq === "number") {
    osc.frequency.setValueAtTime(opts.startFreq, audio.currentTime);
    osc.frequency.linearRampToValueAtTime(opts.endFreq, audio.currentTime + def.dur / 1000);
  } else {
    osc.frequency.setValueAtTime(opts.freq, audio.currentTime);
  }
  osc.connect(opts.gainNode);
  return osc;
}

// Для тестов: сброс дедупликации между «событиями».
export function resetGate() {
  lastPlayedMs = {};
}

// Вибрация: верный [30], неверный [60,40,60] — только если поддерживается
// и звук не выключен вручную (в тихом режиме без вибрации).
export function vibrate(kind) {
  if (!soundEnabled()) return false;
  const pattern = VIBRATION_DEFS[kind];
  if (!pattern || typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return false;
  }
  try {
    navigator.vibrate(pattern);
    return true;
  } catch (err) {
    return false;
  }
}
