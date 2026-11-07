// ui/components/skin-switch.js — переключатель скина интерфейса.
// Работает без входа: выбор хранится на устройстве (shared/theme.js, sb-ui).
// Используется в шапке, на экранах входа и в гостевой форме.
import { h } from "../../shared/dom.js";
import { SKINS, getSkin, setSkin, subscribeSkin } from "../../shared/theme.js";

export function skinSwitch({ className = "" } = {}) {
  const wrap = h("div", {
    class: `skin-switch ${className}`.trim(),
    role: "group",
    "aria-label": "Стиль интерфейса"
  });
  const buttons = SKINS.map(([id, label, title]) => {
    const b = h("button", {
      type: "button",
      class: "skin-switch-btn",
      title,
      "aria-label": title,
      onclick: () => setSkin(id)
    }, label);
    b.dataset.skin = id;
    wrap.appendChild(b);
    return b;
  });
  const paint = () => {
    const cur = getSkin();
    buttons.forEach(b => {
      const on = b.dataset.skin === cur;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  };
  paint();
  let seen = false;
  const unsubscribe = subscribeSkin(() => {
    if (wrap.isConnected) seen = true;
    else if (seen) { unsubscribe(); return; }
    paint();
  });
  return wrap;
}
