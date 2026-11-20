// ui/components/battle-rope.js — визуализация каната (ТЗ §12).
// position ∈ [-1..1]: >0 к команде A (влево), <0 к команде B (вправо).
// Обновляет только узел: перерисовки страницы не нужны, анимация — CSS transition.
import { h } from "../../shared/dom.js";
import { ropePercent } from "../../core/battle-logic.js";

export function buildRope(position = 0) {
  const knot = h("span", { class: "battle-rope-knot", "aria-hidden": "true" });
  const el = h("div", { class: "battle-rope", role: "img", "aria-label": "Канат" },
    h("span", { class: "battle-rope-line" }), h("span", { class: "battle-rope-center" }), knot);
  const api = {
    el,
    set(pos) {
      const p = Number.isFinite(pos) ? pos : 0;
      // Положительное значение — к A, а A слева: инвертируем для CSS left.
      const left = ropePercent(-p);
      knot.style.left = left + "%";
      const label = p === 0 ? "Канат в центре" : (p > 0 ? "Канат ближе к команде A" : "Канат ближе к команде B");
      el.setAttribute("aria-label", label);
    }
  };
  api.set(position);
  return api;
}
