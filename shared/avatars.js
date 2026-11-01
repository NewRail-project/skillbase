// shared/avatars.js — пресеты аватаров Live-комнат и профилей.
// Только пресеты, без загрузки файлов. Основной набор — ЖД-тематика,
// нарисованная кодом (inline SVG): тепловоз, вагон, семафор, стрелка,
// рельсы, фонарь, каска, путевой знак. Прежние эмодзи-пресеты оставлены
// ради уже сохранённых аватаров (publicProfiles, players).
// В publicProfiles.avatar хранится строка "preset:<id>"; правило
// Firestore допускает null или ^preset:[a-z0-9-]{1,20}$.

export const AVATAR_PATTERN = /^preset:[a-z0-9-]{1,20}$/;

export const AVATAR_CATEGORIES = {
  rail: { label: "Железная дорога", ids: [] }, // заполняется ниже из RAIL_AVATARS
  animals: { label: "Животные", ids: ["eagle", "wolf", "fox", "tiger", "owl", "turtle", "dolphin", "penguin", "parrot", "bee", "butterfly", "koala", "panda", "lion", "whale", "unicorn", "dragon"] },
  nature: { label: "Природа и элементы", ids: ["bolt", "fire", "rocket", "dart", "clover", "sail", "sun"] }
};

export const AVATAR_PRESETS = [
  { id: "eagle", emoji: "🦅", bg: "#D84315" },
  { id: "wolf", emoji: "🐺", bg: "#455A64" },
  { id: "fox", emoji: "🦊", bg: "#EF6C00" },
  { id: "tiger", emoji: "🐯", bg: "#F9A825" },
  { id: "owl", emoji: "🦉", bg: "#6D4C41" },
  { id: "turtle", emoji: "🐢", bg: "#2E7D32" },
  { id: "dolphin", emoji: "🐬", bg: "#039BE5" },
  { id: "penguin", emoji: "🐧", bg: "#263238" },
  { id: "parrot", emoji: "🦜", bg: "#00897B" },
  { id: "bee", emoji: "🐝", bg: "#FBC02D" },
  { id: "butterfly", emoji: "🦋", bg: "#7B1FA2" },
  { id: "koala", emoji: "🐨", bg: "#546E7A" },
  { id: "panda", emoji: "🐼", bg: "#37474F" },
  { id: "lion", emoji: "🦁", bg: "#C2185B" },
  { id: "whale", emoji: "🐳", bg: "#0277BD" },
  { id: "unicorn", emoji: "🦄", bg: "#8E24AA" },
  { id: "dragon", emoji: "🐲", bg: "#1565C0" },
  { id: "bolt", emoji: "⚡", bg: "#FBC02D" },
  { id: "fire", emoji: "🔥", bg: "#D32F2F" },
  { id: "rocket", emoji: "🚀", bg: "#3F51B5" },
  { id: "dart", emoji: "🎯", bg: "#C62828" },
  { id: "clover", emoji: "🍀", bg: "#2E7D32" },
  { id: "sail", emoji: "⛵", bg: "#01579B" },
  { id: "sun", emoji: "🌞", bg: "#F57F17" }
];

// ---------- ЖД-аватары (inline SVG, viewBox 48×48) ----------
// Каждый аватар — фиксированный набор параметров: фигура, цвет фона,
// цвет акцента. Значение хранится как "preset:<id>" — как и раньше,
// поэтому правила Firestore (^preset:[a-z0-9-]{1,20}$) менять не нужно.
const FG = "#FFFFFF";

// Внутренность SVG для каждой фигуры. bg нужен для «вырезов» (окна, колёса).
const RAIL_SHAPES = {
  // Тепловоз: капот, кабина, окно, полоса, колёса.
  loco: (bg, ac) =>
    `<rect x="6" y="20" width="36" height="14" rx="2" fill="${FG}"/>` +
    `<rect x="6" y="15" width="17" height="6" rx="1.5" fill="${FG}"/>` +
    `<rect x="26" y="11" width="14" height="11" rx="2" fill="${FG}"/>` +
    `<rect x="30" y="14" width="6" height="5" rx="1" fill="${bg}"/>` +
    `<rect x="6" y="27" width="36" height="3" fill="${ac}"/>` +
    `<circle cx="8" cy="24" r="1.6" fill="${ac}"/>` +
    `<circle cx="14" cy="36" r="3" fill="${FG}"/><circle cx="24" cy="36" r="3" fill="${FG}"/><circle cx="34" cy="36" r="3" fill="${FG}"/>` +
    `<circle cx="14" cy="36" r="1" fill="${bg}"/><circle cx="24" cy="36" r="1" fill="${bg}"/><circle cx="34" cy="36" r="1" fill="${bg}"/>` +
    `<rect x="3" y="40" width="42" height="2" rx="1" fill="${ac}"/>`,
  // Вагон: корпус, три окна, полоса, колёса.
  wagon: (bg, ac) =>
    `<rect x="5" y="11" width="38" height="23" rx="3" fill="${FG}"/>` +
    `<rect x="9" y="15" width="7" height="7" rx="1" fill="${bg}"/><rect x="20.5" y="15" width="7" height="7" rx="1" fill="${bg}"/><rect x="32" y="15" width="7" height="7" rx="1" fill="${bg}"/>` +
    `<rect x="5" y="26" width="38" height="3.5" fill="${ac}"/>` +
    `<circle cx="14" cy="36" r="3" fill="${FG}"/><circle cx="34" cy="36" r="3" fill="${FG}"/>` +
    `<circle cx="14" cy="36" r="1" fill="${bg}"/><circle cx="34" cy="36" r="1" fill="${bg}"/>` +
    `<rect x="3" y="40" width="42" height="2" rx="1" fill="${ac}"/>`,
  // Семафор: мачта, крыло с фонарём, основание.
  semaphore: (bg, ac) =>
    `<rect x="22" y="7" width="4" height="33" rx="1" fill="${FG}"/>` +
    `<rect x="16" y="38" width="16" height="3.5" rx="1" fill="${FG}"/>` +
    `<g transform="rotate(-24 24 15)"><rect x="24" y="12.5" width="17" height="5" rx="1" fill="${ac}"/><rect x="36" y="11" width="3" height="8" fill="${FG}"/></g>` +
    `<circle cx="24" cy="24" r="3.2" fill="${ac}"/><circle cx="24" cy="24" r="1.2" fill="${bg}"/>`,
  // Стрелка: ответвление пути и перевод.
  switch: (bg, ac) =>
    `<path d="M24 41 V27 M24 27 L13 8 M24 27 L35 8" fill="none" stroke="${FG}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M20 37 H28 M21 32 H27 M17.5 17 L22 14.5 M30.5 14.5 L26 17" stroke="${ac}" stroke-width="2.2" stroke-linecap="round"/>` +
    `<path d="M24 27 L36 35" stroke="${ac}" stroke-width="2.4" stroke-linecap="round"/><circle cx="37" cy="36" r="3" fill="${ac}"/>`,
  // Рельсы: уходящая вдаль колея со шпалами.
  rails: (bg, ac) =>
    `<path d="M10 42 L20 7 M38 42 L28 7" fill="none" stroke="${FG}" stroke-width="3.2" stroke-linecap="round"/>` +
    `<path d="M12 36 H36 M14 30 H34 M16 24.5 H32 M17.8 19 H30.2 M19.2 14 H28.8" stroke="${ac}" stroke-width="2.4" stroke-linecap="round"/>`,
  // Фонарь: ручка, колпак, стекло с огнём, основание.
  lantern: (bg, ac) =>
    `<path d="M16.5 15 Q24 3 31.5 15" fill="none" stroke="${FG}" stroke-width="3" stroke-linecap="round"/>` +
    `<rect x="16" y="14" width="16" height="4" rx="1.5" fill="${FG}"/>` +
    `<rect x="17.5" y="18" width="13" height="16" rx="2" fill="${ac}"/>` +
    `<circle cx="24" cy="26" r="3.4" fill="${FG}"/>` +
    `<path d="M20 18 V34 M28 18 V34" stroke="${bg}" stroke-width="1" opacity=".35"/>` +
    `<rect x="15" y="34" width="18" height="4.5" rx="1.5" fill="${FG}"/>`,
  // Каска: купол, козырёк, полоса.
  helmet: (bg, ac) =>
    `<path d="M9 31 A15 15 0 0 1 39 31 Z" fill="${FG}"/>` +
    `<rect x="6" y="30" width="36" height="4.5" rx="2.2" fill="${FG}"/>` +
    `<rect x="21.5" y="16" width="5" height="15" rx="1.5" fill="${ac}"/>` +
    `<rect x="13" y="35.5" width="22" height="2.5" rx="1.2" fill="${ac}"/>`,
  // Путевой знак: столб и табличка с полосами.
  sign: (bg, ac) =>
    `<rect x="22" y="22" width="4" height="19" rx="1" fill="${FG}"/>` +
    `<rect x="9" y="8" width="30" height="17" rx="2.5" fill="${FG}"/>` +
    `<rect x="11.8" y="10.8" width="24.4" height="11.4" rx="1.2" fill="none" stroke="${ac}" stroke-width="1.6"/>` +
    `<rect x="15" y="14" width="18" height="2.6" rx="1" fill="${ac}"/><rect x="15" y="18" width="11" height="2" rx="1" fill="${ac}"/>` +
    `<rect x="16" y="40" width="16" height="2.5" rx="1" fill="${FG}"/>`
};

export const RAIL_SHAPE_LABELS = {
  loco: "Тепловоз", wagon: "Вагон", semaphore: "Семафор", switch: "Стрелка",
  rails: "Рельсы", lantern: "Фонарь", helmet: "Каска", sign: "Путевой знак"
};

// Две цветовые схемы на каждую фигуру: фон тёмный, акцент яркий.
const RAIL_COLORWAYS = [
  { n: "1", bg: "#1B3A57", accent: "#F2B233" },
  { n: "2", bg: "#3A2A1F", accent: "#E5533D" }
];

export const RAIL_AVATARS = Object.keys(RAIL_SHAPES).flatMap(shape =>
  RAIL_COLORWAYS.map(c => ({
    id: `${shape}-${c.n}`,
    shape,
    bg: c.bg,
    accent: c.accent,
    label: RAIL_SHAPE_LABELS[shape]
  })));

AVATAR_CATEGORIES.rail.ids = RAIL_AVATARS.map(a => a.id);

// Готовая строка <svg> для пресета (ЖД-фигура или эмодзи-пресет — тогда null).
export function avatarSvg(preset, size = 48) {
  if (!preset || !preset.shape || !RAIL_SHAPES[preset.shape]) return null;
  const px = Number(size) > 0 ? Number(size) : 48;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${px}" height="${px}" ` +
    `role="img" aria-hidden="true" focusable="false">` +
    `<rect width="48" height="48" fill="${preset.bg}"/>` +
    RAIL_SHAPES[preset.shape](preset.bg, preset.accent) + `</svg>`;
}

// Пресеты для выбора в формах: только ЖД-набор (эмодзи остаются для
// уже выбранных ранее аватаров).
export const PICKER_PRESETS = RAIL_AVATARS;
export const DEFAULT_AVATAR_VALUE = `preset:${RAIL_AVATARS[0].id}`;

export function avatarPreset(value) {
  if (typeof value !== "string" || !AVATAR_PATTERN.test(value)) return null;
  const id = value.slice("preset:".length);
  return RAIL_AVATARS.find(preset => preset.id === id)
    || AVATAR_PRESETS.find(preset => preset.id === id) || null;
}

export function isValidAvatarValue(value) {
  return value == null || (typeof value === "string" && AVATAR_PATTERN.test(value));
}
