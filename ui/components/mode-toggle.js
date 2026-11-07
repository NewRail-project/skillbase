import { h } from "../../shared/dom.js";
import { getMode, setMode, MODES, subscribeMode } from "../../core/mode.js";

/**
 * Переключатель режимов Education/Workforce.
 * @returns {HTMLElement}
 */
export function modeToggle() {
  const current = getMode();
  const toggle = h("button", {
    class: "mode-toggle",
    "aria-label": current === MODES.EDUCATION ? "Переключиться на корпоративный режим" : "Переключиться на режим обучения студентов",
    onclick: () => {
      setMode(current === MODES.EDUCATION ? MODES.WORKFORCE : MODES.EDUCATION);
    }
  });

  // Обновляем состояние переключателя при изменении режима
  const unsubscribe = subscribeMode((mode) => {
    toggle.setAttribute(
      "aria-label",
      mode === MODES.EDUCATION ? "Переключиться на корпоративный режим" : "Переключиться на режим обучения студентов"
    );
  });

  // Очистка подписки при удалении элемента
  toggle.addEventListener("DOMNodeRemoved", () => unsubscribe());

  return toggle;
}
