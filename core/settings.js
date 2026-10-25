// core/settings.js — настройки теста: значения по умолчанию, разбор формы и
// нормализация. Чистый модуль без Firebase, проверяется в Node.
//
// Здесь только те настройки, которые рантайм прохождения действительно
// применяет: перемешивание, таймеры, проходной балл, лимит попыток.
// Остальные поля схемы (answerPolicy, showLeaderboard и т.д.) сохраняются как
// есть и появятся в интерфейсе вместе с функциями, которые их используют.

export const SETTINGS_DEFAULTS = Object.freeze({
  shuffleQuestions: true,
  shuffleOptions: true,
  timePerQuestion: null,
  totalTime: null,
  passScore: null,
  attemptsLimit: 3
});

function intOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

// Приводит сырые значения формы к виду, который хранится в Firestore.
// Пустое поле числа — null (ограничение выключено). Нечисловое значение
// остаётся NaN, чтобы validateTest отклонил его с понятным сообщением.
export function settingsFromForm(form = {}) {
  return {
    shuffleQuestions: form.shuffleQuestions === true,
    shuffleOptions: form.shuffleOptions === true,
    timePerQuestion: intOrNull(form.timePerQuestionSec),
    totalTime: (() => {
      const minutes = intOrNull(form.totalTimeMin);
      return minutes === null || Number.isNaN(minutes) ? minutes : minutes * 60;
    })(),
    passScore: intOrNull(form.passScore),
    attemptsLimit: intOrNull(form.attemptsLimit) ?? SETTINGS_DEFAULTS.attemptsLimit
  };
}

// Значения формы из сохранённых настроек (обратное преобразование).
export function formFromSettings(settings = {}) {
  const s = { ...SETTINGS_DEFAULTS, ...(settings || {}) };
  return {
    shuffleQuestions: s.shuffleQuestions === true,
    shuffleOptions: s.shuffleOptions === true,
    timePerQuestionSec: s.timePerQuestion == null ? "" : String(s.timePerQuestion),
    totalTimeMin: s.totalTime == null ? "" : String(Math.round(s.totalTime / 60)),
    passScore: s.passScore == null ? "" : String(s.passScore),
    attemptsLimit: String(s.attemptsLimit ?? SETTINGS_DEFAULTS.attemptsLimit)
  };
}

// Накладывает значения формы на существующие настройки, не теряя остальные поля.
export function mergeSettings(existing, form) {
  return { ...(existing && typeof existing === "object" ? existing : {}), ...settingsFromForm(form) };
}
