// core/battle-launch.js — сборка плана запуска битвы (чистый модуль, без Firebase).
//
// План описывает ровно те записи, которые battle.js launchBattle() делает
// одним батчем:
//   rooms/{code}                 { mode: "battle" }
//   rooms/{code}/battle/state    публичный документ: состав, вопросы БЕЗ ключей
//   rooms/{code}/battleKeys/{q}  правильные варианты — только ведущему
//   rooms/{code}/players/{uid}   teamId, isCaptain, isReserve (капитаны и команды)
//
// Ключи в публичный документ не попадают (ТЗ §21.1). Проверки здесь — до записи,
// чтобы битва не запускалась на неверных данных.
import { normalizeSettings, RESERVE, TEAM_IDS, QUESTION_TYPE_SINGLE, QUESTION_TYPE_MULTIPLE } from "./battle-logic.js";

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export function validateQuestions(questions = []) {
  const errors = [];
  if (!Array.isArray(questions) || questions.length === 0) return ["Нужен хотя бы один вопрос для битвы."];
  const seen = new Set();
  questions.forEach((q, i) => {
    const n = i + 1;
    if (!q || !ID_RE.test(String(q.id ?? ""))) { errors.push(`Вопрос ${n}: некорректный идентификатор.`); return; }
    if (seen.has(q.id)) errors.push(`Вопрос ${n}: идентификатор повторяется.`);
    seen.add(q.id);
    if (q.type !== QUESTION_TYPE_SINGLE && q.type !== QUESTION_TYPE_MULTIPLE) {
      errors.push(`Вопрос ${n}: в битве поддерживаются только выбор одного и нескольких вариантов.`);
      return;
    }
    if (!Number.isInteger(q.optionCount) || q.optionCount < 2) { errors.push(`Вопрос ${n}: нужно минимум два варианта.`); return; }
    const c = q.correct;
    if (!Array.isArray(c) || c.length === 0 || new Set(c).size !== c.length
      || c.some((x) => !Number.isInteger(x) || x < 0 || x >= q.optionCount)) {
      errors.push(`Вопрос ${n}: не задан корректный ответ.`);
      return;
    }
    if (q.type === QUESTION_TYPE_SINGLE && c.length !== 1) errors.push(`Вопрос ${n}: у вопроса с одним ответом должен быть один верный вариант.`);
  });
  return errors;
}

export function validateRoster(roster) {
  const errors = [];
  if (!roster?.captains?.a || !roster?.captains?.b || roster.captains.a === roster.captains.b) return ["Нужны два разных капитана."];
  if (roster.teams?.a?.length !== roster.teams?.b?.length) errors.push("Команды должны быть одинакового размера.");
  if (!roster.teams.a.includes(roster.captains.a) || !roster.teams.b.includes(roster.captains.b)) errors.push("Капитан не состоит в своей команде.");
  const all = [...roster.teams.a, ...roster.teams.b, ...roster.reserve];
  if (new Set(all).size !== all.length) errors.push("Участник указан в составе дважды.");
  return errors;
}

// buildLaunchPlan({ roster, questions, settings, hostId, testId, orgId })
// Возвращает { errors } либо { plan }.
export function buildLaunchPlan({ roster, questions, extraQuestions = [], settings = {}, hostId, testId, orgId } = {}) {
  const { settings: s, errors: sErrors } = normalizeSettings(settings);
  const errors = [...sErrors, ...validateRoster(roster), ...validateQuestions(questions)];
  // Решающие вопросы необязательны: пустой список — прежнее поведение.
  const extras = Array.isArray(extraQuestions) ? extraQuestions : [];
  if (extras.length) {
    const used = new Set((questions || []).map((q) => q?.id));
    for (const msg of validateQuestions(extras)) errors.push(`Решающие вопросы: ${msg}`);
    if (extras.some((q) => used.has(q?.id))) errors.push("Решающие вопросы: идентификатор совпадает с основным вопросом.");
  }
  if (!hostId) errors.push("Не указан ведущий.");
  if (!testId) errors.push("Не указан тест.");
  if (errors.length) return { errors };

  // Публичная часть вопроса: без правильных ответов. src — номер вопроса в
  // исходном тесте (клиенты берут текст и варианты из него); у подготовленных
  // заранее вопросов текст и варианты лежат прямо здесь.
  const toPublic = (q) => ({
    id: q.id, type: q.type, optionCount: q.optionCount,
    ...(Number.isInteger(q.src) ? { src: q.src } : {}),
    ...(typeof q.text === "string" && Array.isArray(q.options) ? { text: q.text, options: q.options.map(String) } : {})
  });
  const publicQuestions = questions.map(toPublic);
  const publicExtras = extras.map(toPublic);
  const playerFields = {};
  for (const uid of TEAM_IDS.flatMap((t) => roster.teams[t])) {
    playerFields[uid] = {
      teamId: roster.teams.a.includes(uid) ? "a" : "b",
      isCaptain: roster.captains.a === uid || roster.captains.b === uid,
      isReserve: false
    };
  }
  for (const uid of roster.reserve) playerFields[uid] = { teamId: RESERVE, isCaptain: false, isReserve: true };

  return {
    plan: {
      room: { mode: "battle" },
      battle: {
        phase: "battle_ready",
        testId,
        orgId: orgId ?? null,
        hostId,
        settings: s,
        questions: publicQuestions,
        extraQuestions: publicExtras,
        captains: { a: roster.captains.a, b: roster.captains.b },
        teams: { a: [...roster.teams.a], b: [...roster.teams.b] },
        reserve: [...roster.reserve],
        substituted: [],
        eliminated: [],
        availableFrom: {},
        availableTo: {},
        scores: { a: 0, b: 0 },
        bonuses: { a: 0, b: 0 },
        rounds: [],
        currentRound: null,
        winner: null,
        finishedEarly: false
      },
      keys: [...questions, ...extras].map((q) => ({ id: q.id, correct: [...q.correct] })),
      playerFields
    }
  };
}

// toBattleQuestions({ questions, keys, count, order, rng })
// Берёт вопросы существующего Live-теста и ключи (keys[i] для questions[i]).
// Поддерживаются только single/multiple: short и вопросы без ключа пропускаются
// с ошибкой, чтобы ведущий увидел, что не так. Порядок: "set" — как в тесте,
// "random" — перемешивание по rng.
export function toBattleQuestions({ questions = [], keys = [], count = null, order = "set", rng = Math.random } = {}) {
  const errors = [];
  const all = [];
  questions.forEach((q, i) => {
    const key = keys[i];
    const n = i + 1;
    if (!key || (key.type !== QUESTION_TYPE_SINGLE && key.type !== QUESTION_TYPE_MULTIPLE)) {
      errors.push(`Вопрос ${n}: в битве только выбор одного или нескольких вариантов.`);
      return;
    }
    if (!Array.isArray(q.options) || q.options.length < 2) {
      errors.push(`Вопрос ${n}: нет вариантов ответа.`);
      return;
    }
    all.push({ id: `q${i}`, src: i, type: key.type, optionCount: q.options.length, correct: Array.isArray(key.correct) ? [...key.correct] : [] });
  });
  let picked = all;
  if (order === "random") {
    picked = [...all];
    for (let i = picked.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [picked[i], picked[j]] = [picked[j], picked[i]];
    }
  }
  if (Number.isInteger(count) && count > 0) picked = picked.slice(0, count);
  return { questions: picked, errors };
}
