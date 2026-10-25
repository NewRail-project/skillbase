import { h } from "../../shared/dom.js";

export function skeleton() {
  return h("div", { class: "card skeleton-card", "aria-hidden": "true" },
    h("div", { class: "skeleton", style: "height: 24px; width: 60%; margin-bottom: 12px;" }),
    h("div", { class: "skeleton", style: "height: 16px; width: 100%; margin-bottom: 8px;" }),
    h("div", { class: "skeleton", style: "height: 16px; width: 80%;" })
  );
}