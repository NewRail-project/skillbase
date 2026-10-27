// shared/avatars.js — пресеты аватаров Live-комнат и профилей.
// Только пресеты: эмодзи на цветном фоне, без загрузки файлов.
// В publicProfiles.avatar хранится строка "preset:<id>"; правило
// Firestore допускает null или ^preset:[a-z0-9-]{1,20}$.

export const AVATAR_PATTERN = /^preset:[a-z0-9-]{1,20}$/;

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

export function avatarPreset(value) {
  if (typeof value !== "string" || !AVATAR_PATTERN.test(value)) return null;
  const id = value.slice("preset:".length);
  return AVATAR_PRESETS.find(preset => preset.id === id) || null;
}

export function isValidAvatarValue(value) {
  return value == null || (typeof value === "string" && AVATAR_PATTERN.test(value));
}
