// ui/components/theme-toggle.js — переключатель светлой/тёмной темы.
// Одинаковый для гостя и авторизованного: выбор хранится в localStorage
// устройства (shared/theme.js, ключ sb-theme) и не зависит от профиля.
// Используется на экране входа, в форме гостя и в шапке комнаты.
import { h } from "../../shared/dom.js";
import { getTheme, toggleTheme, subscribeTheme } from "../../shared/theme.js";
import { icons } from "../../shared/icons.js";

export function themeToggle({ withLabel = false, className = "" } = {}) {
  const btn = h("button", {
    type: "button",
    class: `theme-switch ${className}`.trim(),
    onclick: () => toggleTheme()
  });
  const paint = () => {
    const dark = getTheme() === "dark";
    btn.setAttribute("aria-label", dark ? "Включить светлую тему" : "Включить тёмную тему");
    btn.setAttribute("aria-pressed", String(dark));
    btn.dataset.theme = dark ? "dark" : "light";
    // Статичные иконки из shared/icons.js (без пользовательских данных).
    const icon = h("span", { class: "icon", "aria-hidden": "true" });
    icon.innerHTML = dark ? icons.sun : icons.moon;
    btn.textContent = "";
    btn.appendChild(icon);
    if (withLabel) btn.appendChild(h("span", { class: "theme-switch-label" }, dark ? "Светлая" : "Тёмная"));
  };
  paint();
  let seen = false;
  const unsubscribe = subscribeTheme(() => {
    // Кнопка убрана со страницы — отписываемся, чтобы не копить слушатели.
    if (btn.isConnected) seen = true;
    else if (seen) { unsubscribe(); return; }
    paint();
  });
  return btn;
}
