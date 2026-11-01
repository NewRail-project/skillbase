// ui/components/ring-timer.js — круговой таймер вопроса и индикатор паузы.
// Дуга убывает плавно (CSS-анимация с отрицательной задержкой: после
// перерисовки она продолжается с нужного места). В последние 5 секунд
// кольцо краснеет и пульсирует — пульс запускается тем же событием, что
// и звук «тик» (pulseRings вызывается из тика в room.js).
import { h } from "../../shared/dom.js";

const R = 34;
const C = 2 * Math.PI * R;
export const URGENT_MS = 5000;

function prefersReduced() {
  return typeof window !== "undefined" && window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Доля остатка 0..1 и «срочность» — чистые функции для тестов.
export function ringFraction(totalMs, leftMs) {
  if (!(totalMs > 0)) return 0;
  return Math.max(0, Math.min(1, leftMs / totalMs));
}
export function isUrgent(leftMs, urgentMs = URGENT_MS) {
  return typeof leftMs === "number" && leftMs > 0 && leftMs <= urgentMs;
}

export function ringTimer({ totalMs, leftMs, label = "Осталось времени" }) {
  const total = Math.max(1, Number(totalMs) || 1);
  const left = Math.max(0, Math.min(total, Number(leftMs) || 0));
  const el = h("div", { class: "ring-timer", role: "timer", "aria-label": label, "data-total": String(total) });
  const reduced = prefersReduced();
  const arcStyle = reduced
    ? `stroke-dashoffset:${(C * (1 - ringFraction(total, left))).toFixed(2)}`
    : `animation: sb-ring-drain ${total}ms linear ${-(total - left)}ms both`;
  // Статичная разметка без данных пользователя.
  el.innerHTML =
    '<svg viewBox="0 0 80 80" aria-hidden="true" focusable="false">' +
    '<circle class="ring-track" cx="40" cy="40" r="34"/>' +
    `<circle class="ring-arc" cx="40" cy="40" r="34" stroke-dasharray="${C.toFixed(2)}" style="${arcStyle}"/>` +
    '</svg><span class="ring-digit" aria-hidden="true"></span><span class="sr-only" data-ring-sr></span>';
  return el;
}

// Вызывается из updateLiveTexts (дважды в секунду).
export function updateRings(root, leftMs) {
  if (!root) return;
  root.querySelectorAll(".ring-timer").forEach(el => {
    const secs = Math.max(0, Math.ceil((leftMs ?? 0) / 1000));
    const urgent = isUrgent(leftMs);
    el.classList.toggle("is-urgent", urgent);
    const digit = el.querySelector(".ring-digit");
    if (digit) digit.textContent = urgent ? String(secs) : "";
    const sr = el.querySelector("[data-ring-sr]");
    if (sr && sr.dataset.secs !== String(secs)) { sr.dataset.secs = String(secs); sr.textContent = `${secs} с`; }
    if (prefersReduced()) {
      const arc = el.querySelector(".ring-arc");
      const total = Number(el.dataset.total) || 1;
      if (arc) arc.style.strokeDashoffset = (C * (1 - ringFraction(total, leftMs ?? 0))).toFixed(2);
    }
  });
}

// Пульс в такт звуку «тик».
export function pulseRings(root) {
  if (!root || prefersReduced()) return;
  root.querySelectorAll(".ring-timer.is-urgent").forEach(el => {
    el.classList.remove("beat");
    void el.offsetWidth; // перезапуск анимации
    el.classList.add("beat");
  });
}

// Пауза между вопросами: «Следующий вопрос через 3…2…1».
export function gapCountdown({ label = "Следующий вопрос через", msLeft = 0 } = {}) {
  const secs = Math.max(0, Math.ceil(msLeft / 1000));
  return h("div", { class: "gap-count", role: "timer", "aria-label": `${label} ${secs} с` },
    h("div", { class: "gap-label" }, label),
    h("div", { class: "gap-num", "data-gap-num": String(secs) }, String(secs)),
    h("div", { class: "gap-steps", "aria-hidden": "true" },
      [3, 2, 1].flatMap((n, i) => [
        h("span", { class: "gap-step", "data-step": String(n) }, String(n)),
        i < 2 ? h("span", { class: "gap-dots" }, "…") : null
      ])));
}

export function updateGap(root, msLeft) {
  if (!root) return;
  const secs = Math.max(0, Math.ceil((msLeft ?? 0) / 1000));
  root.querySelectorAll(".gap-count").forEach(el => {
    const num = el.querySelector(".gap-num");
    if (num && num.dataset.gapNum !== String(secs)) {
      num.dataset.gapNum = String(secs);
      num.textContent = String(secs);
      num.classList.remove("pop");
      void num.offsetWidth;
      num.classList.add("pop");
    }
    el.classList.toggle("is-final", secs > 0 && secs <= 3);
    el.querySelectorAll(".gap-step").forEach(step => {
      step.classList.toggle("on", Number(step.dataset.step) === secs);
      step.classList.toggle("done", Number(step.dataset.step) > secs && secs > 0 && secs <= 3);
    });
  });
}
