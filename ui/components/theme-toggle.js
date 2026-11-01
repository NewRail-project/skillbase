// ui/components/theme-toggle.js — переключатели оформления.
//  • themeToggle()   — светлая/тёмная тема (localStorage, ключ sb-theme);
//  • paletteSwitch() — палитра (education / operations / depot), ключ sb-palette.
// Оба одинаковы для гостя и авторизованного: выбор хранится на устройстве
// (shared/theme.js) и не зависит от профиля. Вошедшему пользователю палитра
// дополнительно сохраняется в профиль — ту же настройку читает и пишет
// страница «Профиль», поэтому выбор нигде не дублируется.
// Используются на экране входа, в форме гостя, на странице входа в комнату
// и в шапке комнаты.
import { h } from "../../shared/dom.js";
import {
  getTheme, toggleTheme, subscribeTheme,
  PALETTES, PALETTE_META, getPalette, setPalette, subscribePalette
} from "../../shared/theme.js";
import { icons } from "../../shared/icons.js";
import { State, saveOwnProfile } from "../../core/auth.js";

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


// Палитра: три кнопки-образца (radiogroup). Подпись — текстом в aria-label и
// title, цвет — только декоративная точка. Меняет data-ui сразу, без
// перезагрузки страницы; вошедшему (не гостю) выбор уходит и в профиль.
export function paletteSwitch({ withLabel = false, className = "" } = {}) {
  const box = h("div", {
    class: `palette-switch ${className}`.trim(),
    role: "radiogroup",
    "aria-label": "Палитра интерфейса"
  });
  const buttons = new Map();

  const paint = () => {
    const current = getPalette();
    for (const [value, btn] of buttons) {
      const on = value === current;
      btn.setAttribute("aria-checked", String(on));
      btn.classList.toggle("is-on", on);
    }
  };

  for (const value of PALETTES) {
    const meta = PALETTE_META[value];
    const dot = h("span", { class: "palette-dot", "aria-hidden": "true" });
    dot.style.background = meta.dot;
    const btn = h("button", {
      type: "button",
      class: "palette-btn",
      role: "radio",
      "aria-checked": "false",
      "aria-label": `Палитра ${meta.label}: ${meta.hint}`,
      title: `${meta.label} — ${meta.hint}`,
      onclick: () => {
        setPalette(value);
        paint();
        const signedIn = State.user && State.user.isAnonymous !== true && State.profile;
        if (signedIn && State.profile.ui !== value) {
          saveOwnProfile({ ui: value }).catch(err => console.warn("Палитра не сохранена в профиль:", err?.code || err));
        }
      }
    }, dot, withLabel ? h("span", { class: "palette-name" }, meta.label) : null);
    buttons.set(value, btn);
    box.appendChild(btn);
  }
  paint();

  let seen = false;
  const unsubscribe = subscribePalette(() => {
    // Блок убран со страницы — отписываемся, чтобы не копить слушатели.
    if (box.isConnected) seen = true;
    else if (seen) { unsubscribe(); return; }
    paint();
  });
  return box;
}

// Оба переключателя в одной строке — для шапок гостя и комнаты.
export function appearanceTools({ withLabel = false } = {}) {
  return h("div", { class: "appearance-tools" },
    paletteSwitch({ withLabel }),
    themeToggle({ withLabel }));
}
