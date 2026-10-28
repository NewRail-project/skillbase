// shared/reactions.js — пресеты эмодзи-реакций Live-комнат.
// Здесь только константы и чистая нормализация: модуль проверяется
// юнит-тестами в Node. Список REACTIONS синхронизирован с правилом
// REACTIONS_HAS у REACTIONS в firestore.rules.

export const REACTIONS = ["👍", "🔥", "😂", "😮", "🎉", "💯", "🚀", "✨"];

export function normalizeReaction(emoji) {
  return REACTIONS.includes(emoji) ? emoji : null;
}
