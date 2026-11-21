// ui/components/actions-menu.js — меню «Ещё» для второстепенных действий.
//
// Зачем: в списках дисциплин и тем рядом с безопасными кнопками стояли
// опасные («В архив», «Удалить»), а на телефоне ряд из 4–8 кнопок превращался
// в стену. Меню собирает всё, что не является главным действием строки:
// порядок внутри — от безопасного к опасному, опасные помечаются tone: "danger".
//
// Поведение: раскрытие кнопкой (aria-expanded/aria-haspopup), закрытие по
// Escape, по клику вне меню и после выбора пункта; фокус возвращается на
// кнопку. На узком экране список раскрывается прямо под кнопкой (без
// абсолютного позиционирования — не уходит за край экрана).
import { h } from "../../shared/dom.js";

function contains(root, node) {
  for (let el = node; el; el = el.parentNode) {
    if (el === root) return true;
  }
  return false;
}

// actionsMenu({ label, items, align }) → элемент-обёртка.
// items: [{ label, onClick, tone: "danger" | undefined, disabled }]
export function actionsMenu({ label = "Ещё", items = [], align = "end" } = {}) {
  const root = h("div", { class: `actions-menu actions-menu-${align}` });
  const toggle = h("button", {
    type: "button",
    class: "btn secondary actions-menu-toggle",
    "aria-haspopup": "menu",
    "aria-expanded": "false"
  }, label);
  const pop = h("div", { class: "actions-menu-pop", role: "menu", hidden: "hidden" });

  const isOpen = () => toggle.getAttribute("aria-expanded") === "true";

  function close({ refocus = false } = {}) {
    if (!isOpen()) return;
    toggle.setAttribute("aria-expanded", "false");
    pop.hidden = true;
    document.removeEventListener("click", onOutside, true);
    document.removeEventListener("keydown", onKeydown, true);
    if (refocus && typeof toggle.focus === "function") toggle.focus();
  }

  function open() {
    toggle.setAttribute("aria-expanded", "true");
    pop.hidden = false;
    document.addEventListener("click", onOutside, true);
    document.addEventListener("keydown", onKeydown, true);
  }

  function onOutside(event) {
    if (!contains(root, event?.target)) close();
  }

  function onKeydown(event) {
    if (event?.key === "Escape") {
      event.preventDefault?.();
      close({ refocus: true });
    }
  }

  toggle.addEventListener("click", () => (isOpen() ? close() : open()));

  for (const item of items) {
    if (!item) continue;
    const attrs = {
      type: "button",
      class: `actions-menu-item${item.tone === "danger" ? " danger-text" : ""}`,
      role: "menuitem",
      onclick: () => {
        close();
        item.onClick?.();
      }
    };
    if (item.disabled) attrs.disabled = "disabled";
    pop.appendChild(h("button", attrs, item.label));
  }

  root.append(toggle, pop);
  return root;
}

export default actionsMenu;
