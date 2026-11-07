// ui/components/leaderboard.js — рейтинг карточками вместо таблицы.
// Карточка: место, аватар, ФИО, баллы, % верных, число вопросов, статус,
// значок серии и значок смены места (↑2 / ↓1). Фон и текст каждой
// карточки заданы парой токенов --row-* (см. themes/*.css), поэтому
// текст читаем в обеих темах. Плавное перемещение — FLIP на WAAPI.
import { h } from "../../shared/dom.js";
import { streakBadge } from "./streak.js";

function reduced() {
  return typeof window !== "undefined" && window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const MEDAL_CLASS = { 1: "lb-gold", 2: "lb-silver", 3: "lb-bronze" };
export const MOVE_VISIBLE_MS = 6000;

// Подпись смены места: ↑2 / ↓1 (чистая функция).
export function moveLabel(delta) {
  if (!delta) return "";
  return delta > 0 ? `↑${delta}` : `↓${-delta}`;
}

// Число «набегает» от from до to.
export function animateNumber(el, from, to, { dur = 700, format = (n) => String(n) } = {}) {
  if (reduced() || from === to || typeof requestAnimationFrame !== "function") {
    el.textContent = format(to);
    return;
  }
  el.textContent = format(from);
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(Math.round(from + (to - from) * eased));
    if (t < 1 && el.isConnected !== false) requestAnimationFrame(step);
    else el.textContent = format(to);
  };
  requestAnimationFrame(step);
}

// FLIP: запомнить позиции карточек до перерисовки…
export function captureRects(root) {
  const map = new Map();
  if (!root) return map;
  root.querySelectorAll("[data-uid]").forEach(el => {
    map.set(el.getAttribute("data-uid"), el.getBoundingClientRect().top);
  });
  return map;
}

// …и плавно доехать до новых после неё.
export function playFlip(root, oldTops, duration = 650) {
  if (!root || !oldTops?.size || reduced()) return;
  root.querySelectorAll("[data-uid]").forEach(el => {
    const before = oldTops.get(el.getAttribute("data-uid"));
    if (before == null || typeof el.animate !== "function") return;
    const dy = before - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) return;
    el.animate(
      [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
      { duration, easing: "cubic-bezier(.2,.7,.3,1)" }
    );
  });
}

// ctx: { avatar(row)->Node, me, moves:Map(uid->delta), prevScores:Map,
//        prevStreaks:Map, statusLabel:{}, board:boolean }
export function leaderCard(row, ctx = {}) {
  const isMe = ctx.me && row.uid === ctx.me;
  const medal = MEDAL_CLASS[row.place] || "";
  const prevScore = ctx.prevScores?.get(row.uid);
  const scoreEl = h("span", { class: "lb-score-num" }, String(row.score ?? 0));
  if (typeof prevScore === "number" && prevScore !== (row.score ?? 0)) {
    animateNumber(scoreEl, prevScore, row.score ?? 0);
  }
  const delta = ctx.moves?.get(row.uid) || 0;
  const moveEl = delta
    ? h("span", { class: `lb-move ${delta > 0 ? "up" : "down"}`, "aria-label": delta > 0 ? `поднялся на ${delta}` : `опустился на ${-delta}` }, moveLabel(delta))
    : null;
  if (moveEl) setTimeout(() => { if (moveEl.isConnected) moveEl.remove(); }, MOVE_VISIBLE_MS);

  const streak = streakBadge(row.streak ?? 0, ctx.prevStreaks?.get(row.uid) ?? null, { compact: true });
  const status = row.status
    ? h("span", { class: `lb-status lb-status-${row.status}` }, ctx.statusLabel?.[row.status] || row.status)
    : null;

  return h("li", {
    class: ["lb-card", medal, isMe ? "is-me" : "", delta > 0 ? "lb-rose" : ""].filter(Boolean).join(" "),
    "data-uid": row.uid,
    "aria-label": `${row.place} место, ${row.name}, ${row.score ?? 0} баллов${isMe ? ", это вы" : ""}`
  },
    h("span", { class: "lb-place" }, String(row.place ?? "")),
    ctx.avatar ? ctx.avatar(row) : null,
    h("div", { class: "lb-main" },
      h("b", { class: "lb-name" }, row.name || "Участник"),
      h("div", { class: "lb-meta" },
        h("span", {}, `${row.percent ?? 0}% верных`),
        h("span", {}, `вопросов: ${row.answered ?? 0} из ${row.finished ?? 0}`),
        status)),
    h("div", { class: "lb-side" },
      h("span", { class: "lb-score" }, scoreEl, h("span", { class: "lb-unit" }, " б.")),
      h("span", { class: "lb-badges" }, moveEl, streak)));
}

export function leaderList(rows, ctx = {}) {
  const cards = rows.map(row => {
    const card = leaderCard(row, ctx);
    card.dataset.sig = rowSignature(row, ctx);
    return card;
  });
  const ol = h("ol", { class: `lb-list${ctx.board ? " lb-board" : ""}` }, cards);
  // Каскадное появление карточек — только при первой сборке списка:
  // последующие обновления идут точечно и ничего не проигрывают заново.
  if (ctx.enter && !reduced()) {
    cards.forEach((card, i) => card.style.setProperty("--i", String(Math.min(i, 12))));
    ol.classList.add("lb-enter");
    setTimeout(() => ol.classList.remove("lb-enter"), 1600);
  }
  return ol;
}

// Подпись карточки: пока она не изменилась, DOM-узел не трогаем
// (аватар, анимации и фокус остаются на месте — нет мигания).
function rowSignature(row, ctx) {
  return [
    row.uid, row.place, row.score ?? 0, row.correctCount ?? 0, row.streak ?? 0,
    row.percent ?? 0, row.answered ?? 0, row.finished ?? 0, row.status || "",
    row.name || "", ctx.moves?.get(row.uid) || 0, ctx.me && row.uid === ctx.me ? 1 : 0
  ].join("|");
}

// Точечное обновление списка: меняются только изменившиеся карточки,
// остальные переставляются без пересоздания. Возвращает true, если был
// готовый список (его обновили), иначе false — тогда нужно собрать с нуля.
export function reconcileLeaderList(ol, rows, ctx = {}) {
  if (!ol || !ol.classList?.contains("lb-list")) return false;
  ol.classList.toggle("lb-board", Boolean(ctx.board));
  const existing = new Map();
  ol.querySelectorAll(":scope > [data-uid]").forEach(el => existing.set(el.getAttribute("data-uid"), el));
  rows.forEach((row, index) => {
    const sig = rowSignature(row, ctx);
    let el = existing.get(row.uid);
    existing.delete(row.uid);
    if (!el || el.dataset.sig !== sig) {
      const fresh = leaderCard(row, ctx);
      fresh.dataset.sig = sig;
      // Короткая подсветка изменившейся карточки (новые очки, место).
      if (el && !reduced()) {
        fresh.classList.add("lb-bump");
        setTimeout(() => fresh.classList.remove("lb-bump"), 1000);
      }
      if (el && el.parentNode === ol) ol.replaceChild(fresh, el);
      el = fresh;
    }
    const at = ol.children[index] || null;
    if (at !== el) ol.insertBefore(el, at);
  });
  existing.forEach(el => el.remove());
  return true;
}
