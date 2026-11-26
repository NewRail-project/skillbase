// ui/components/battle-timer.js — таймер раунда «Командной битвы» для всех
// видов: экран наблюдателя/проектора (.bs), обычный режим комнаты (участник)
// и панель ведущего. Одна реализация на все — ничего не дублируется.
//
// Источник времени — только дедлайн раунда из данных (startedAt /
// tiebreakStartedAt + durationSec), тот же, что у игрового таймера ведущего
// (core/battle-game.js, autoStep): параллельного времени здесь нет.
//
// Поведение:
//   · цифры остатка и кольцо-прогресс (--p);
//   · «тик» — короткая анимация только при смене цифр;
//   · цвет цифр по порогам отсчёта: обычный → warn (последняя треть) →
//     crit (последние 10 %), переход плавный (CSS transition);
//   · звук окончания ровно один раз на раунд; уважает mute и autoplay
//     (shared/sound.js).
//
// createBattleTimer({ now, playSound, className }) → { el, update(state) }
//   state = { round, settings, status, phase }
//     round    — раунд (или null);
//     settings — settings битвы (questionSeconds, captainTiebreakSeconds);
//     status   — статус раунда, если он задан иначе, чем round.status
//                (у ведущего статус выводится из фазы);
//     phase    — фаза битвы; "finished" прячет таймер.
import { h } from "../../shared/dom.js";
import { play } from "../../shared/sound.js";

const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const setVar = (el, k, v) => { if (el.style?.setProperty) el.style.setProperty(k, v); else if (el.style) el.style[k] = v; };

// Остаток текущего отсчёта (основное время раунда или спор капитанов).
export function roundClock({ round, settings, status, phase, now }) {
  if (!round || phase === "finished") return null;
  const st = status || round.status || "open";
  const tie = st === "tiebreak";
  const dur = round.durationSec ?? settings?.questionSeconds ?? 0;
  const total = tie ? (settings?.captainTiebreakSeconds ?? 15) : dur;
  if (!(total > 0)) return null;
  const ms = tie && round.tiebreakStartedAt
    ? round.tiebreakStartedAt + total * 1000 - now()
    : round.startedAt + dur * 1000 - now();
  return { ms, total, status: st, tie: Boolean(tie && round.tiebreakStartedAt) };
}

// Пороги по длительности отсчёта (сама длительность не меняется):
//   обычный — больше последней трети;
//   warn    — последняя треть, но не дольше 30 с;
//   crit    — последние 10 %, но не дольше 5 с и не выше порога warn.
export function timerLevel(ms, total) {
  const warn = Math.min((total * 1000) / 3, 30000);
  const crit = Math.min((total * 1000) / 10, 5000, warn);
  if (ms <= crit) return "crit";
  if (ms <= warn) return "warn";
  return "";
}

export function createBattleTimer({ now = () => Date.now(), playSound = play, className = "bs-timer" } = {}) {
  const num = h("div", { class: "bs-timer-num" }, "");
  // role="timer" + aria-live="off": цифры не озвучиваются каждую секунду.
  const el = h("div", { class: className, role: "timer", "aria-live": "off" }, num);
  // Текущий отсчёт и его состояние: "watch" — ждём ноль, "done" — звук сыгран,
  // "skip" — раунд закончился до нуля (все ответили) — тишина.
  let episodeKey = null;
  let endState = "watch";
  let ringValue = null;   // последнее значение кольца (без лишних перерисовок)
  let levelValue = null;  // последний уровень цвета цифр

  // Анимация «тика»: короткий всплеск масштаба при каждой смене цифр.
  // Один кадр на секунду и только transform — на телефоне не греет экран и
  // не мерцает; при prefers-reduced-motion и без WAAPI её нет.
  function pulseDigits() {
    if (reducedMotion()) return;
    if (typeof num.animate !== "function") return;
    try {
      num.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.14)", offset: 0.35 }, { transform: "scale(1)" }],
        { duration: 320, easing: "ease-out" }
      );
    } catch { /* браузер без анимаций — цифры просто меняются */ }
  }

  function setDigits(text) {
    if (num.textContent === text) return;
    num.textContent = text;
    if (text) pulseDigits();
  }

  function setRing(value) {
    if (ringValue === value) return;
    ringValue = value;
    setVar(el, "--p", value);
  }

  function setLevel(level) {
    if (level === levelValue) return;
    levelValue = level;
    if (level) el.setAttribute("data-level", level);
    else el.removeAttribute("data-level");
  }

  function update({ round = null, settings = null, status = null, phase = null } = {}) {
    const clock = roundClock({ round, settings, status, phase, now });
    // Ключ отсчёта: новый раунд (или новое время спора капитанов) сбрасывает
    // и звук, и показ. Промежуточные обновления состояния ключ не меняют,
    // поэтому звук окончания не повторяется. Пропавший раунд (round: null)
    // ключ не затирает — возврат того же раунда звук не сыграет снова.
    const key = clock
      ? `${round.index}|${round.kind || "main"}|${round.questionId ?? round.question?.id ?? ""}|${round.startedAt}|${clock.tie ? round.tiebreakStartedAt : ""}`
      : null;
    if (key && key !== episodeKey) { episodeKey = key; endState = "watch"; ringValue = null; }

    const open = Boolean(clock) && clock.status !== "closed";
    if (!open) {
      setDigits("");
      setRing("0");
      setLevel("");
    } else {
      setDigits(fmtClock(clock.ms));
      setRing(String(Math.max(0, Math.min(100, Math.round((clock.ms / (clock.total * 1000)) * 100)))));
      setLevel(timerLevel(clock.ms, clock.total));
    }

    // Конец отсчёта — один звук на раунд: и пока раунд открыт, и когда его
    // успели закрыть раньше нашего тика. Повторные update() молчат.
    // Если браузер без autoplay и жеста ещё не было, play вернёт false.
    if (clock && endState === "watch") {
      if (clock.ms <= 0) {
        endState = "done";
        try { playSound("roundEnd"); } catch { /* звук не критичен для игры */ }
      } else if (clock.status === "closed") {
        endState = "skip";
      }
    }
  }

  return { el, update };
}
