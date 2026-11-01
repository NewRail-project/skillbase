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
// Палитра (скин интерфейса: education / operations / depot) хранится рядом:
//   getPalette()      -> "education" | "operations" | "depot"  (выбор на устройстве)
//   setPalette(v)     -> сохраняет выбор (ключ sb-palette), применяет data-ui,
//                        шлёт событие "sb:palettechange"
//   applyPalette(v)   -> только применяет (без записи) — для профиля, который
//                        приходит из Firestore
//   subscribePalette(fn)
// Гость выбирает палитру тут же, без профиля. У вошедшего пользователя
// источник правды — профиль (users/{uid}.ui), а localStorage зеркалит его
// на устройстве: при загрузке профиля auth.js вызывает setPalette(profile.ui),
// при выходе возвращается сохранённый выбор, а не жёсткий "education".
//
// Единственный источник правды по светлоте — атрибут data-theme на <html>,
// по палитре — data-ui. CSS-скины не должны хранить собственные
// переключатели светлого/тёмного: они обязаны реагировать на data-theme.

const STORAGE_KEY = "sb-theme";
const EVENT = "sb:themechange";
const VALID = ["light", "dark", "system"];

// Палитры. Список совпадает с VALID_UI из core/registration.js
// (это проверяет tests/theme.test.js).
export const PALETTES = Object.freeze(["education", "operations", "depot"]);
export const DEFAULT_PALETTE = "education";
export const PALETTE_STORAGE_KEY = "sb-palette";
const PALETTE_EVENT = "sb:palettechange";
// Название и «образец» цвета для переключателя (только декоративная точка;
// текст всегда берётся из подписи, не из цвета).
export const PALETTE_META = Object.freeze({
  education: { label: "Education", hint: "Просторный базовый стиль", dot: "#1B5A7A" },
  operations: { label: "Operations", hint: "Плотнее, для работы", dot: "#17565A" },
  depot: { label: "Depot", hint: "Индустриальный, строгий", dot: "#4F6B12" }
});

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
  // Гость и неавторизованный экран: палитра с устройства. Профиль, когда
  // загрузится, переопределит её через setPalette(profile.ui).
  const storedPalette = getStoredPalette();
  if (storedPalette) applyPalette(storedPalette);

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


// ---------- Палитра (скин) ----------

export function isValidPalette(value) {
  return PALETTES.includes(value);
}

// Сохранённый на устройстве выбор; без него — палитра по умолчанию.
export function getStoredPalette() {
  try {
    const stored = localStorage.getItem(PALETTE_STORAGE_KEY);
    return isValidPalette(stored) ? stored : null;
  } catch (_) {
    return null;
  }
}

// Фактически применённая палитра (атрибут data-ui), иначе сохранённая.
export function getPalette() {
  if (typeof document !== "undefined") {
    const applied = document.documentElement.getAttribute("data-ui");
    if (isValidPalette(applied)) return applied;
  }
  return getStoredPalette() || DEFAULT_PALETTE;
}

function emitPalette(palette) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PALETTE_EVENT, { detail: { palette } }));
}

// Применяет палитру, ничего не записывая. Светлая/тёмная тема не меняется.
export function applyPalette(value) {
  const palette = isValidPalette(value) ? value : (getStoredPalette() || DEFAULT_PALETTE);
  if (typeof document === "undefined") return palette;
  const root = document.documentElement;
  const changed = root.getAttribute("data-ui") !== palette;
  if (changed) root.setAttribute("data-ui", palette);
  if (changed) emitPalette(palette);
  return palette;
}

// Выбор палитры пользователем: запись на устройство + применение.
export function setPalette(value) {
  const palette = isValidPalette(value) ? value : DEFAULT_PALETTE;
  try {
    localStorage.setItem(PALETTE_STORAGE_KEY, palette);
  } catch (_) {
    // Приватный режим: палитра применится, но не сохранится.
  }
  return applyPalette(palette);
}

export function subscribePalette(fn) {
  const handler = (e) => fn(e.detail.palette);
  window.addEventListener(PALETTE_EVENT, handler);
  return () => window.removeEventListener(PALETTE_EVENT, handler);
}
