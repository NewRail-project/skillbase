// ui/components/podium.js — подиум с поочерёдным подъёмом мест 3 → 2 → 1.
// Очки «набегают» до итогового значения; на 1 месте — конфетти и звук.
// Узел создаётся один раз и переиспользуется при перерисовках страницы:
// состояние «показано» хранится в классах, а не в анимации.
import { h } from "../../shared/dom.js";
import { animateNumber } from "./leaderboard.js";

const MEDAL = { 1: "🥇", 2: "🥈", 3: "🥉" };
const NAMES = { 1: "первое место", 2: "второе место", 3: "третье место" };
export const STEP_MS = 1100;

function reduced() {
  return typeof window !== "undefined" && window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Порядок подъёма: третье, второе, первое (только существующие места).
export function podiumOrder(count) {
  return [3, 2, 1].filter(rank => rank <= Math.min(3, count));
}

// Визуальный порядок колонок: 2 · 1 · 3.
export function podiumLayout(count) {
  return [2, 1, 3].filter(rank => rank <= Math.min(3, count));
}

export function buildPodium(rows, { avatar } = {}) {
  const top = (rows || []).slice(0, 3);
  const cols = podiumLayout(top.length).map(rank => {
    const row = top[rank - 1];
    return h("div", { class: `pod-col pod-rank-${rank} pod-hidden`, "data-rank": String(rank), "data-uid": row.uid },
      h("div", { class: "pod-person" },
        h("div", { class: "pod-medal", "aria-hidden": "true" }, MEDAL[rank]),
        avatar ? avatar(row) : null,
        h("div", { class: "pod-name" }, row.name || "Участник"),
        h("div", { class: "pod-score", "data-final": String(row.score ?? 0), "aria-label": `${row.score ?? 0} баллов` },
          h("span", { class: "pod-score-num" }, String(row.score ?? 0)), " б.")),
      h("div", { class: "pod-block", role: "img", "aria-label": NAMES[rank] }, String(row.place || rank)));
  });
  const node = h("div", { class: "pod-stage", role: "group", "aria-label": "Подиум" }, cols);
  node.__rows = top;
  return node;
}

function reveal(col, instant) {
  col.classList.remove("pod-hidden");
  col.classList.add("pod-in");
  const num = col.querySelector(".pod-score-num");
  const final = Number(col.querySelector(".pod-score")?.dataset.final || 0);
  if (num) { if (instant) num.textContent = String(final); else animateNumber(num, 0, final, { dur: 900 }); }
}

// Мгновенно показать итог (повторные перерисовки, reduced motion).
export function showPodiumNow(node) {
  node.querySelectorAll(".pod-col").forEach(col => reveal(col, true));
  node.dataset.played = "1";
}

// Запуск: onStep(rank) на каждом месте, onFirst() — на первом.
export function playPodium(node, { onStep, onFirst, stepMs = STEP_MS } = {}) {
  if (node.dataset.played) return () => {};
  node.dataset.played = "1";
  if (reduced()) { showPodiumNow(node); onFirst?.(); return () => {}; }
  const timers = [];
  podiumOrder(node.__rows?.length || 0).forEach((rank, i) => {
    timers.push(setTimeout(() => {
      const col = node.querySelector(`.pod-rank-${rank}`);
      if (col) reveal(col, false);
      if (rank === 1) { node.classList.add("pod-finished"); onFirst?.(); } else onStep?.(rank);
    }, 400 + i * stepMs));
  });
  return () => timers.forEach(clearTimeout);
}
