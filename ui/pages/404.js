import { h } from "../../shared/dom.js";
import { icons } from "../../shared/icons.js";

export default function NotFoundComponent() {
  return h("div", { class: "empty-state" },
    h("div", { class: "empty-state-icon", innerHTML: icons.book }),
    h("h2", {}, "404"),
    h("p", {}, "Страница не найдена"),
    h("a", { class: "btn primary", href: "#/" }, "Вернуться на главную")
  );
}