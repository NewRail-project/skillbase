// core/settings.js — настройки теста: значения по умолчанию, разбор формы,
// нормализация и разрешение противоречий. Чистый модуль без Firebase,
// проверяется в Node.
//
// Поля схемы (core/test-schema.js):
//   shuffleQuestions / shuffleOptions — перемешивание;
//   timePerQuestion / totalTime — таймеры (в секундах);
//   onQuestionTimeout — «next» (автопереход к следующему, текущий без
//     ответа) | «lock» (вопрос блокируется, ученик идёт дальше сам);
//     работает только при выставленном timePerQuestion;
//   onTotalTimeout — «submit» (автоотправка сохранённых ответов) |
//     «expire» (попытка помечается просроченной и не оценивается);
//   passScore — проходной балл, %;
//   attemptsLimit — лимит попыток (принудительно 1 при allowRetake=false);
//   allowRetake — разрешены ли повторные попытки;
//   answerPolicy — «changeable» (ответы можно менять, можно возвращаться) |
//     «final» (ответ фиксируется кнопкой, назад нельзя);
//   showCorrectAfterQuestion — показать верный ответ сразу после ответа;
//     доступно только при answerPolicy === «final». В live верный ответ
//     всегда показывается после закрытия вопроса независимо от настройки;
//   showLeaderboard — показывать ли таблицу участникам в live
//     (ведущему и наблюдателям она доступна всегда).

export const SETTINGS_DEFAULTS = Object.freeze({
  shuffleQuestions: true,
  shuffleOptions: true,
  timePerQuestion: null,
  totalTime: null,
  onQuestionTimeout: "lock",
  onTotalTimeout: "submit",
  passScore: null,
  attemptsLimit: 3,
  allowRetake: true,
  answerPolicy: "final",
  showLeaderboard: false,
  showCorrectAfterQuestion: false
});

export const ON_QUESTION_TIMEOUT_VALUES = ["next", "lock"];
export const ON_TOTAL_TIMEOUT_VALUES = ["submit", "expire"];
export const ANSWER_POLICY_VALUES = ["changeable", "final"];

// Миграция старых значений схемы: «skip» → «lock», «autosubmit» → «submit»,
// «never» → «final» (старое поведение «ответ фиксируется»).
const LEGACY_MAP = Object.freeze({
  skip: "lock",
  autosubmit: "submit",
  never: "final"
});

function intOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

function enumOrNull(value, allowed) {
  const raw = String(value ?? "").trim();
  const mapped = raw in LEGACY_MAP ? LEGACY_MAP[raw] : raw;
  return allowed.includes(mapped) ? mapped : null;
}

// Приводит сырые значения формы к виду, который хранится в Firestore.
// В результат попадают только явно переданные поля: mergeSettings не
// должен обнулять настройки, которых в конкретной форме не было.
export function settingsFromForm(form = {}) {
  const out = {};
  const put = (key, value, guardKey = key) => {
    if (form[guardKey] !== undefined) out[key] = value;
  };

  put("shuffleQuestions", form.shuffleQuestions === true);
  put("shuffleOptions", form.shuffleOptions === true);
  put("timePerQuestion", intOrNull(form.timePerQuestionSec), "timePerQuestionSec");
  put("totalTime", (() => {
    const minutes = intOrNull(form.totalTimeMin);
    return minutes === null || Number.isNaN(minutes) ? minutes : minutes * 60;
  })(), "totalTimeMin");
  put("onQuestionTimeout", form.onQuestionTimeout || SETTINGS_DEFAULTS.onQuestionTimeout);
  put("onTotalTimeout", form.onTotalTimeout || SETTINGS_DEFAULTS.onTotalTimeout);
  put("passScore", intOrNull(form.passScore));
  put("attemptsLimit", intOrNull(form.attemptsLimit) ?? SETTINGS_DEFAULTS.attemptsLimit);
  put("allowRetake", form.allowRetake !== false);
  put("answerPolicy", form.answerPolicy || SETTINGS_DEFAULTS.answerPolicy);
  put("showLeaderboard", form.showLeaderboard === true);
  put("showCorrectAfterQuestion", form.showCorrectAfterQuestion === true);
  return out;
}

// Значения формы из сохранённых настроек (обратное преобразование).
export function formFromSettings(settings = {}) {
  const s = normalizeSettings(settings);
  return {
    shuffleQuestions: s.shuffleQuestions === true,
    shuffleOptions: s.shuffleOptions === true,
    timePerQuestionSec: s.timePerQuestion == null ? "" : String(s.timePerQuestion),
    totalTimeMin: s.totalTime == null ? "" : String(Math.round(s.totalTime / 60)),
    onQuestionTimeout: s.onQuestionTimeout,
    onTotalTimeout: s.onTotalTimeout,
    passScore: s.passScore == null ? "" : String(s.passScore),
    attemptsLimit: String(s.attemptsLimit ?? SETTINGS_DEFAULTS.attemptsLimit),
    allowRetake: s.allowRetake === true,
    answerPolicy: s.answerPolicy,
    showLeaderboard: s.showLeaderboard === true,
    showCorrectAfterQuestion: s.showCorrectAfterQuestion === true
  };
}

// Нормализация + разрешение противоречий. Не выбрасывает: неизвестные
// значения заменяются дефолтами (enum-валидацию отдельно делает
// core/test-schema.js по этой же таблице).
export function normalizeSettings(raw = {}) {
  const s = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};

  const onQuestionTimeout =
    enumOrNull(s.onQuestionTimeout, ON_QUESTION_TIMEOUT_VALUES)
    ?? SETTINGS_DEFAULTS.onQuestionTimeout;
  const onTotalTimeout =
    enumOrNull(s.onTotalTimeout, ON_TOTAL_TIMEOUT_VALUES)
    ?? SETTINGS_DEFAULTS.onTotalTimeout;
  const answerPolicy =
    enumOrNull(s.answerPolicy, ANSWER_POLICY_VALUES)
    ?? SETTINGS_DEFAULTS.answerPolicy;

  const allowRetake = s.allowRetake !== false;

  let attemptsLimit = intOrNull(s.attemptsLimit);
  if (Number.isNaN(attemptsLimit)) attemptsLimit = SETTINGS_DEFAULTS.attemptsLimit;
  if (attemptsLimit == null || attemptsLimit < 1) attemptsLimit = SETTINGS_DEFAULTS.attemptsLimit;
  // allowRetake=false → попытка ровно одна, что бы ни было в attemptsLimit.
  if (!allowRetake) attemptsLimit = 1;

  // Правильный ответ сразу после вопроса — только при финальных ответах.
  const showCorrectAfterQuestion = s.showCorrectAfterQuestion === true
    && answerPolicy === "final";

  return {
    shuffleQuestions: s.shuffleQuestions !== false,
    shuffleOptions: s.shuffleOptions !== false,
    timePerQuestion: intOrNull(s.timePerQuestion),
    totalTime: intOrNull(s.totalTime),
    onQuestionTimeout,
    onTotalTimeout,
    passScore: intOrNull(s.passScore),
    attemptsLimit,
    allowRetake,
    answerPolicy,
    showLeaderboard: s.showLeaderboard === true,
    showCorrectAfterQuestion
  };
}

// Эффективные настройки теста — единая точка входа для рантайма.
export function effectiveSettings(test) {
  return normalizeSettings(test?.settings);
}

// Накладывает значения формы на существующие настройки, не теряя остальные поля.
export function mergeSettings(existing, form) {
  return { ...normalizeSettings(existing), ...settingsFromForm(form) };
}
