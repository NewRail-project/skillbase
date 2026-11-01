// ui/components/reaction-icons.js — ЖД-значки реакций, нарисованные кодом:
// сигнал (светофор), гудок (рожок), колокол, звезда. Эмодзи показываются как есть.
import { h } from "../../shared/dom.js";
import { isRailReaction, REACTION_LABELS } from "../../shared/reactions.js";

const ICONS = {
  signal:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="7" y="2" width="10" height="17" rx="3" class="ri-body"/>' +
    '<circle cx="12" cy="6.5" r="2" class="ri-red"/><circle cx="12" cy="11" r="2" class="ri-yel"/><circle cx="12" cy="15.5" r="2" class="ri-grn"/>' +
    '<rect x="11" y="19" width="2" height="3" class="ri-body"/></svg>',
  horn:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="ri-body" d="M3 9.5h4.2L15 4.5v15l-7.8-5H3z"/>' +
    '<path class="ri-line" d="M18 8.5a5 5 0 0 1 0 7M20.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke-width="1.8" stroke-linecap="round"/></svg>',
  bell:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="ri-body" d="M12 2.5a1.4 1.4 0 0 1 1.4 1.4v.7A6 6 0 0 1 18 10.5V15l2 2.5v1H4v-1L6 15v-4.5a6 6 0 0 1 4.6-5.9v-.7A1.4 1.4 0 0 1 12 2.5z"/>' +
    '<path class="ri-yel" d="M9.5 20h5a2.5 2.5 0 0 1-5 0z"/></svg>',
  star:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="ri-yel" d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/></svg>'
};

export function reactionLabel(value) {
  return REACTION_LABELS[value] || String(value);
}

// Содержимое кнопки или «летающего» значка.
export function reactionGlyph(value, className = "") {
  if (isRailReaction(value)) {
    const span = h("span", { class: `reaction-glyph reaction-${value} ${className}`.trim(), "aria-hidden": "true" });
    span.innerHTML = ICONS[value]; // статичный SVG из констант
    return span;
  }
  return h("span", { class: `reaction-glyph reaction-emoji ${className}`.trim(), "aria-hidden": "true" }, String(value));
}
