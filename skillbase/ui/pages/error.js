import { h, esc } from "../../shared/dom.js";
import { icons } from "../../shared/icons.js";

export default function ErrorComponent({ message }) {
  return h("div", { class: "empty-state" },
    h("div", { class: "empty-state-icon", innerHTML: icons.warning }),
    h("h2", {}, "Ошибка"),
    h("p", {}, esc(message)),
    h("a", { class: "btn primary", href: "#/" }, "Вернуться на главную")
  );
}