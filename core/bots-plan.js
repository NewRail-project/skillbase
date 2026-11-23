// core/bots-plan.js — план ответов ботов для проигрывания сценария.
// Чистая логика: без DOM, без Firestore, без Date.now()/Math.random().
// Весь «случай» идёт от seed, поэтому один seed даёт один и тот же план.

export const BOT_LIMITS = Object.freeze({
  maxBots: 30,
  maxQuestions: 50,
  minDelayMs: 800,
  maxDelayMs: 15000
});

// mulberry32: быстрый детерминированный генератор. Возвращает функцию,
// каждый вызов которой даёт число из [0, 1).
export function seededRandom(seed) {
  let a = (Number(seed) | 0) >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampInt(value, min, max) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

// Точность — доля 0..1. Значения больше 1 считаются процентами (60 → 0.6).
export function normalizeAccuracy(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const fraction = n > 1 ? n / 100 : n;
  return Math.min(1, Math.max(0, fraction));
}

// «Бот 01», «Бот 02», … — нули слева, чтобы имена сортировались как числа.
export function botNames(count) {
  const n = clampInt(count, 0, BOT_LIMITS.maxBots);
  return Array.from({ length: n }, (_, i) => `Бот ${String(i + 1).padStart(2, "0")}`);
}

// План: [{ bot: "Бот 01", answers: [{ question (с 1), correct, delayMs }] }].
// Порядок генерации фиксирован (бот за ботом, вопрос за вопросом).
export function planBotAnswers({ botCount = 0, questionCount = 0, accuracy = 0.6, seed = 1 } = {}) {
  const names = botNames(botCount);
  const questions = clampInt(questionCount, 0, BOT_LIMITS.maxQuestions);
  const chance = normalizeAccuracy(accuracy);
  const random = seededRandom(seed);
  const span = BOT_LIMITS.maxDelayMs - BOT_LIMITS.minDelayMs;
  return names.map(bot => ({
    bot,
    answers: Array.from({ length: questions }, (_, i) => ({
      question: i + 1,
      correct: random() < chance,
      delayMs: BOT_LIMITS.minDelayMs + Math.floor(random() * (span + 1))
    }))
  }));
}

// Короткая сводка плана для проверок и подписей.
export function summarizePlan(plan) {
  const list = Array.isArray(plan) ? plan : [];
  let totalAnswers = 0;
  let correct = 0;
  for (const entry of list) {
    for (const answer of entry.answers || []) {
      totalAnswers += 1;
      if (answer.correct) correct += 1;
    }
  }
  return {
    bots: list.length,
    questions: list.length ? (list[0].answers || []).length : 0,
    totalAnswers,
    correct,
    accuracy: totalAnswers ? correct / totalAnswers : 0
  };
}
