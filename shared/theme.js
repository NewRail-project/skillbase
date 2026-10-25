// shared/theme.js — единая система светлой и тёмной темы.
//
// Контракт:
//   getThemeMode()   -> "light" | "dark" | "system"   (сохранённый выбор пользователя)
//   getTheme()       -> "light" | "dark"              (фактически применённая тема)
//   setThemeMode(v)  -> сохраняет выбор, применяет тему, шлёт событие "sb:themechange"
//   toggleTheme()    -> light <-> dark (из "system" переключает на противоположную системной)
//   initTheme()      -> применяет сохранённый выбор и следит за системной темой
//   onThemeChange(fn)-> подписка, возвращает функцию отписки
//
// Единственный источник правды — атрибут data-theme на <html>.
// CSS-скины (data-ui: education/operations/depot) не должны хранить собственные
// переключатели светлого/тёмного: они обязаны реагировать на data-theme.

const STORAGE_KEY = "sb-theme";
const EVENT = "sb:themechange";
const VALID = ["light", "dark", "system"];

let mediaQuery = null;

function systemTheme() {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getThemeMode() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return VALID.includes(stored) ? stored : "system";
  } catch (_) {
    return "system";
  }
}

export function resolveTheme(mode) {
  return mode === "system" ? systemTheme() : mode;
}

export function getTheme() {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") || systemTheme();
}

function applyResolved(theme) {
  const root = document.documentElement;
  if (root.getAttribute("data-theme") !== theme) {
    root.setAttribute("data-theme", theme);
  }
  // Нативная прокрутка, поля ввода и полосы прокрутки подстраиваются под тему.
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0D1218" : "#F5F3EF");
}

function emit(theme, mode) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { theme, mode } }));
}

export function applyThemeMode(mode) {
  const resolvedMode = VALID.includes(mode) ? mode : "system";
  const theme = resolveTheme(resolvedMode);
  applyResolved(theme);
  emit(theme, resolvedMode);
  return theme;
}

export function setThemeMode(mode) {
  const resolvedMode = VALID.includes(mode) ? mode : "system";
  try {
    localStorage.setItem(STORAGE_KEY, resolvedMode);
  } catch (_) {
    // Приватный режим: тема применится, но не сохранится.
  }
  return applyThemeMode(resolvedMode);
}

export function toggleTheme() {
  const current = getTheme();
  const next = current === "dark" ? "light" : "dark";
  setThemeMode(next);
  return next;
}

export function subscribeTheme(fn) {
  const handler = (e) => fn(e.detail.theme, e.detail.mode);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

export function initTheme() {
  if (typeof window === "undefined") return;
  applyThemeMode(getThemeMode());

  if (!mediaQuery && window.matchMedia) {
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      // Системная тема подхватывается, только пока выбран режим "system".
      if (getThemeMode() === "system") applyThemeMode("system");
    };
    if (mediaQuery.addEventListener) mediaQuery.addEventListener("change", onChange);
    else if (mediaQuery.addListener) mediaQuery.addListener(onChange);
  }
}
