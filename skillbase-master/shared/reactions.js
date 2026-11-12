// shared/reactions.js — пресеты реакций Live-комнат.
// Здесь только константы и чистая нормализация: модуль проверяется
// юнит-тестами в Node. Список RULES_REACTIONS ОБЯЗАН совпадать с
// reactionsList() в firestore.rules (это проверяет tests/reactions.test.js).
//
// Реакции двух видов:
//   • ЖД-тематика — значок рисуется кодом (ui/components/reaction-icons.js);
//     в Firestore хранится ключ: "signal" | "horn" | "bell" | "star";
//   • эмодзи — как раньше.

export const RAIL_REACTION_IDS = ["signal", "horn", "bell", "star"];

export const REACTION_LABELS = {
  signal: "Сигнал",
  horn: "Гудок",
  bell: "Колокол",
  star: "Звезда",
  "👍": "Класс",
  "🎉": "Ура",
  "🔥": "Огонь",
  "😮": "Ого"
};

// Панель реакций (порядок на экране): сначала ЖД, затем эмодзи.
export const REACTIONS = [...RAIL_REACTION_IDS, "👍", "🎉", "🔥", "😮"];

// Всё, что разрешено правилами Firestore (включая прежние эмодзи).
export const RULES_REACTIONS = [...RAIL_REACTION_IDS, "👍", "🔥", "😂", "😮", "🎉"];

// Клиентский троттлинг: правила требуют паузу больше 1 с между записями.
export const REACTION_COOLDOWN_MS = 1100;

export function normalizeReaction(value) {
  return RULES_REACTIONS.includes(value) ? value : null;
}

export function isRailReaction(value) {
  return RAIL_REACTION_IDS.includes(value);
}

// Чистый троттлинг: можно ли отправить реакцию сейчас.
export function canSendReaction(lastSentMs, nowMs, cooldown = REACTION_COOLDOWN_MS) {
  return typeof lastSentMs !== "number" || nowMs - lastSentMs >= cooldown;
}
