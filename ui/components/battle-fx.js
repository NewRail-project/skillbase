// ui/components/battle-fx.js — визуальные эффекты начисления очков Battle:
// «+N» вылетает из панели команды к её счётчику, команда коротко подсвечивается,
// решающее начисление получает усиленный эффект.
//
// Механику очков не трогает: число на счётчике по-прежнему меняет
// animateNumber в battle-screen.js, а список эффектов даёт core/score-fx.js
// (с защитой от повторов). Здесь только отрисовка.
//
// prefers-reduced-motion: ничего не летит и не масштабируется — только
// короткая статичная подсветка (рамка/фон) и текст «+N» у счётчика.
import { h } from "../../shared/dom.js";

const defaultReduced = () => typeof matchMedia === "function"
  && matchMedia("(prefers-reduced-motion: reduce)").matches;

const fmt = (n) => String(Math.round((Number(n) || 0) * 100) / 100);
const center = (el, base) => {
  const r = el?.getBoundingClientRect?.();
  if (!r || (!r.width && !r.height)) return null;
  const b = base?.getBoundingClientRect?.() || { left: 0, top: 0 };
  return { x: r.left - b.left + r.width / 2, y: r.top - b.top + r.height / 2 };
};

// layer — контейнер поверх экрана; scoreOf/panelOf(team) → DOM-узлы.
export function createScoreFxPlayer({
  layer, scoreOf, panelOf, hitTargets = null,
  reduced = defaultReduced,
  schedule = (fn, ms) => setTimeout(fn, ms),
  clear = (id) => clearTimeout(id),
  gapMs = 320
} = {}) {
  const timers = new Set();
  const hitTimers = new Map();
  let destroyed = false;

  const later = (fn, ms) => {
    const id = schedule(() => { timers.delete(id); if (!destroyed) fn(); }, ms);
    timers.add(id);
    return id;
  };

  // Подсветка команды: на счётчике и на панели, затем снимается.
  function hit(team, level) {
    const targets = hitTargets ? hitTargets(team) : [scoreOf(team), panelOf(team)];
    for (const el of targets.filter(Boolean)) {
      el.setAttribute("data-hit", String(level));
      if (hitTimers.has(el)) clear(hitTimers.get(el));
      hitTimers.set(el, schedule(() => { el.removeAttribute("data-hit"); hitTimers.delete(el); }, level === 2 ? 1500 : 900));
    }
  }

  function show(effect) {
    const level = effect.decisive ? 2 : 1;
    const chip = h("span", {
      class: "bs-fx", "data-team": effect.team, "data-level": String(level),
      "data-fx-key": effect.key, "aria-hidden": "true"
    }, `+${fmt(effect.points)}`);
    layer.appendChild(chip);
    const done = () => { chip.remove(); };

    if (reduced()) {
      // Без движения: «+N» остаётся у счётчика на мгновение, команда подсвечена.
      chip.setAttribute("data-static", "1");
      hit(effect.team, level);
      later(done, 1200);
      return;
    }
    const from = center(panelOf(effect.team), layer);
    const to = center(scoreOf(effect.team), layer);
    if (!from || !to || typeof chip.animate !== "function") {
      hit(effect.team, level);
      later(done, 900);
      return;
    }
    chip.style.left = `${from.x}px`;
    chip.style.top = `${from.y}px`;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const big = effect.decisive ? 1.6 : 1.1;
    const anim = chip.animate([
      { transform: `translate(-50%, -50%) scale(.6)`, opacity: 0 },
      { transform: `translate(-50%, -50%) scale(${big})`, opacity: 1, offset: 0.25 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.7)`, opacity: 0.95 }
    ], { duration: effect.decisive ? 1200 : 850, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" });
    const landed = () => { hit(effect.team, level); done(); };
    anim.onfinish = landed;
    anim.oncancel = done;
  }

  return {
    // Показывает пачку по очереди — быстрые подряд изменения не накладываются.
    play(effects) {
      (effects || []).forEach((effect, i) => later(() => show(effect), i * gapMs));
    },
    destroy() {
      destroyed = true;
      timers.forEach(clear);
      timers.clear();
      hitTimers.forEach(clear);
      hitTimers.clear();
      layer?.replaceChildren?.();
    }
  };
}
