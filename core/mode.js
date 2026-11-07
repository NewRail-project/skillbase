// core/mode.js — режим интерфейса: Education (колледжи и вузы) или Workforce
// (профессиональное обучение сотрудников предприятий).
//
// ВАЖНО: режим — только внешний вид и терминология. Он не меняет роль
// пользователя, не участвует в запросах к Firestore и не влияет на доступ.
//
// Хранение: localStorage (ключ sb-mode). Выбор переживает выход из аккаунта
// и повторный вход на этом устройстве. По умолчанию — Education.
//
// В DOM режим отражается двумя атрибутами на <html>:
//   data-mode = "education" | "workforce"   — режим (для текстов и CSS-правил режима)
//   data-ui   = скин оформления:
//       Workforce -> "workforce" (фиксированный строгий корпоративный скин);
//       Education -> выбранный ранее скин (education | operations | depot),
//                    по умолчанию "education" — существующий дизайн без изменений.
//
// Смена режима шлёт событие sb:modechange; «живые» тексты (shared/live.js)
// пересчитываются на месте, страница не перерисовывается.

import { MODE_EVENT } from "../shared/live.js";

const STORAGE_KEY = "sb-mode";

export const MODES = {
  EDUCATION: "education",
  WORKFORCE: "workforce"
};

export const DEFAULT_MODE = MODES.EDUCATION;
export const EDU_SKINS = ["education", "operations", "depot"];

const VALID = Object.values(MODES);

// Скин Education, который нужно вернуть при обратном переключении.
let eduUi = "education";

export function isValidMode(value) {
  return VALID.includes(value);
}

/** Режим, сохранённый на устройстве; при отсутствии или порче — Education. */
export function readStoredMode() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isValidMode(stored) ? stored : DEFAULT_MODE;
  } catch (_) {
    return DEFAULT_MODE;
  }
}

/** Текущий применённый режим (источник правды — атрибут data-mode). */
export function getMode() {
  if (typeof document !== "undefined") {
    const attr = document.documentElement?.getAttribute?.("data-mode");
    if (isValidMode(attr)) return attr;
  }
  return readStoredMode();
}

export function isWorkforce() {
  return getMode() === MODES.WORKFORCE;
}

/** Какой скин соответствует режиму. */
export function resolveUi(mode, preferredEduUi = eduUi) {
  if (mode === MODES.WORKFORCE) return "workforce";
  return EDU_SKINS.includes(preferredEduUi) ? preferredEduUi : "education";
}

function paintMeta(mode) {
  const meta = document.querySelector?.('meta[name="theme-color"]');
  if (!meta) return;
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const color = mode === MODES.WORKFORCE
    ? (dark ? "#0B1220" : "#0F1A2E")
    : (dark ? "#0D1218" : "#F5F3EF");
  meta.setAttribute("content", color);
}

/**
 * Применяет скин Education (выбор пользователя). В режиме Workforce выбор
 * запоминается, но на экране остаётся скин Workforce до возврата в Education.
 */
export function applyUi(preferredEduUi) {
  if (EDU_SKINS.includes(preferredEduUi)) eduUi = preferredEduUi;
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-ui", resolveUi(getMode()));
}

function applyToDom(mode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-mode", mode);
  root.setAttribute("data-ui", resolveUi(mode));
  paintMeta(mode);
}

/**
 * Устанавливает режим. Ничего не перезагружает: только атрибуты <html>,
 * сохранение и событие. Возвращает применённый режим.
 */
export function setMode(mode, { persist = true } = {}) {
  if (!isValidMode(mode)) return getMode();
  const changed = mode !== getMode();
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, mode); } catch (_) { /* приватный режим */ }
  }
  applyToDom(mode);
  if (changed || !persist) {
    window.dispatchEvent(new CustomEvent(MODE_EVENT, { detail: { mode } }));
  }
  return mode;
}

export function toggleMode() {
  return setMode(getMode() === MODES.EDUCATION ? MODES.WORKFORCE : MODES.EDUCATION);
}

/** Подписка на смену режима. Возвращает функцию отписки. */
export function subscribeMode(fn) {
  const handler = (e) => fn(e.detail.mode);
  window.addEventListener(MODE_EVENT, handler);
  return () => window.removeEventListener(MODE_EVENT, handler);
}

/** Старт приложения: применить сохранённый режим (событие не шлём). */
export function initMode() {
  // Скин Education, выбранный ранее на этом устройстве.
  try {
    const saved = localStorage.getItem("sb-ui");
    if (EDU_SKINS.includes(saved)) eduUi = saved;
  } catch (_) { /* без хранилища остаётся education */ }
  const mode = readStoredMode();
  applyToDom(mode);
  return mode;
}

// Синхронизация между вкладками: режим, выбранный в одной вкладке, подхватывается в другой.
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY && isValidMode(e.newValue) && e.newValue !== getMode()) {
      setMode(e.newValue, { persist: false });
    }
  });
}
