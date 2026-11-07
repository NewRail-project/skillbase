// core/mode.js — управление режимами Education и Workforce.
//
// Режим Education (обучение студентов) — по умолчанию.
// Режим Workforce (корпоративное обучение работников) — альтернатива.
//
// Выбор сохраняется в localStorage и влияет на тексты и визуальную тему.

const STORAGE_KEY = "sb-mode";
const EVENT = "sb:modechange";
export const MODES = {
  EDUCATION: "education",
  WORKFORCE: "workforce"
};

/**
 * Возвращает текущий режим.
 * @returns {"education" | "workforce"}
 */
export function getMode() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return Object.values(MODES).includes(stored) ? stored : MODES.EDUCATION;
  } catch (_) {
    return MODES.EDUCATION;
  }
}

/**
 * Устанавливает текущий режим.
 * @param {"education" | "workforce"} mode
 */
export function setMode(mode) {
  if (!Object.values(MODES).includes(mode)) return;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch (_) {}
  
  // Применяем визуальный скин (data-ui). 
  // Education использует скин "education", Workforce — новый скин "workforce".
  const ui = mode === MODES.WORKFORCE ? "workforce" : "education";
  document.documentElement.setAttribute("data-ui", ui);
  
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { mode } }));
}

/**
 * Переключает режим между Education и Workforce.
 */
export function toggleMode() {
  const next = getMode() === MODES.EDUCATION ? MODES.WORKFORCE : MODES.EDUCATION;
  setMode(next);
  return next;
}

/**
 * Подписка на изменение режима.
 * @param {Function} fn (mode) => void
 * @returns {Function} отписка
 */
export function subscribeMode(fn) {
  const handler = (e) => fn(e.detail.mode);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/**
 * Инициализация режима при старте приложения.
 */
export function initMode() {
  setMode(getMode());
}
