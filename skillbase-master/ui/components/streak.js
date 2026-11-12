// ui/components/streak.js — значок серии верных ответов.
// Огонь с 3 верных подряд, молния с 5. Новый верный ответ — вспышка и
// увеличение значка; ошибка или пропуск — значок гаснет и уменьшается.
import { h } from "../../shared/dom.js";
import { streakTier, streakEvent } from "../../core/rooms-logic.js";

// Рисунки рисуются кодом; цвета берутся из CSS-классов.
const FLAME_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path class="sk-flame-out" d="M12 1.5c.7 3.9 5.6 6.1 5.6 11.8a5.6 5.6 0 0 1-11.2 0c0-2.4 1.1-4 2.4-5.3.2 2 1.1 3 2.2 3.3C10.4 8 10.2 4.6 12 1.5z"/>' +
  '<path class="sk-flame-in" d="M12 22.2a3.3 3.3 0 0 1-3.3-3.3c0-1.8 1.5-2.6 2.2-4.4.7 1.3 1.5 1.8 2.2 2.7.7.9 0 1.8 0 2.8 0 1.2-.5 2.2-1.1 2.2z"/></svg>';
const BOLT_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path class="sk-bolt" d="M13.6 1.5 4.5 13.6h6.1l-1.4 8.9 9.3-12.6h-6.2z"/></svg>';

export function streakLabel(streak) {
  const tier = streakTier(streak);
  if (tier === "none") return streak > 0 ? `Серия ${streak}` : "";
  return `${tier === "bolt" ? "Молния" : "Огонь"}: серия ${streak} верных подряд`;
}

function iconFor(tier) {
  const span = h("span", { class: `streak-icon streak-icon-${tier}`, "aria-hidden": "true" });
  // Статичный SVG из констант выше, пользовательских данных нет.
  span.innerHTML = tier === "bolt" ? BOLT_SVG : FLAME_SVG;
  return span;
}

// Значок для рейтинга и счётчика. prevStreak — серия на прошлом кадре
// (для анимации); без него значок рисуется без эффектов.
export function streakBadge(streak, prevStreak = null, { compact = false } = {}) {
  const n = Number.isFinite(streak) ? streak : 0;
  const tier = streakTier(n);
  const event = prevStreak == null ? "same" : streakEvent(prevStreak, n);

  // Серия оборвалась: показываем гаснущий значок прежнего уровня и убираем.
  if (event === "break") {
    const prevTier = streakTier(prevStreak);
    const ghost = h("span", {
      class: `streak-badge streak-${prevTier} streak-broke${compact ? " is-compact" : ""}`,
      role: "img",
      "aria-label": "Серия прервана"
    }, iconFor(prevTier), h("span", { class: "streak-count" }, String(prevStreak)));
    setTimeout(() => { if (ghost.isConnected) ghost.remove(); }, 1500);
    return ghost;
  }
  if (tier === "none") {
    if (n < 1) return null;
    return h("span", { class: `streak-badge streak-mini${compact ? " is-compact" : ""}`, role: "img", "aria-label": streakLabel(n) },
      h("span", { class: "streak-count" }, `×${n}`));
  }
  const hit = event === "hit" || event === "tier";
  return h("span", {
    class: `streak-badge streak-${tier}${hit ? " streak-hit" : ""}${compact ? " is-compact" : ""}`,
    role: "img",
    "aria-label": streakLabel(n)
  }, iconFor(tier), h("span", { class: "streak-count" }, String(n)));
}

// Полоса над карточкой участника: «Серия 4» крупно.
export function streakMeter(streak, prevStreak = null) {
  const badge = streakBadge(streak, prevStreak);
  if (!badge) return null;
  const tier = streakTier(streak);
  const caption = tier === "bolt" ? "Молния!" : tier === "fire" ? "В огне!" : "Серия верных";
  const showCaption = badge.classList.contains("streak-broke") ? "Серия прервана" : caption;
  return h("div", { class: "streak-meter", role: "status" }, badge,
    h("span", { class: "streak-caption" }, showCaption));
}
