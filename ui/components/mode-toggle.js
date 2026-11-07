// ui/components/mode-toggle.js — переключатель режима Education / Workforce.
//
// Меняет только внешний вид и терминологию (core/mode.js). Роль пользователя,
// авторизация, запросы к Firestore и права доступа от режима не зависят.
// Страница не перезагружается и не перерисовывается: введённые данные,
// открытые разделы и прокрутка сохраняются.
import { h } from "../../shared/dom.js";
import { MODES, getMode, setMode, subscribeMode } from "../../core/mode.js";
import { t } from "../../core/i18n.js";

const OPTIONS = [
  [MODES.EDUCATION, "mode.education", "mode.educationTitle"],
  [MODES.WORKFORCE, "mode.workforce", "mode.workforceTitle"]
];

/**
 * @param {{ className?: string }} [opts]
 * @returns {HTMLElement}
 */
export function modeToggle({ className = "" } = {}) {
  const wrap = h("div", {
    class: `mode-toggle ${className}`.trim(),
    role: "group",
    "aria-label": () => t("mode.label")
  });

  // Скрытая «живая область»: вспомогательные технологии озвучивают смену режима.
  const status = h("span", { class: "sr-only", role: "status", "aria-live": "polite" });

  const buttons = OPTIONS.map(([id, labelKey, titleKey]) => {
    const b = h("button", {
      type: "button",
      class: "mode-toggle-btn",
      title: () => t(titleKey),
      "aria-label": () => t(titleKey),
      onclick: () => {
        if (getMode() === id) return;
        setMode(id);
        status.textContent = t(`mode.switched.${id}`);
      }
    }, h("span", { class: "mode-toggle-text" }, () => t(labelKey)));
    b.dataset.mode = id;
    wrap.appendChild(b);
    return b;
  });
  wrap.appendChild(status);

  const paint = () => {
    const cur = getMode();
    buttons.forEach(b => {
      const on = b.dataset.mode === cur;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  };
  paint();

  // Отписываемся, когда переключатель убран со страницы (после того, как он был в DOM).
  let seen = false;
  const unsubscribe = subscribeMode(() => {
    if (wrap.isConnected) seen = true;
    else if (seen) { unsubscribe(); return; }
    paint();
  });
  return wrap;
}
