// core/battle-set.js — вопросы, подготовленные заранее вместе с тестом:
//   · основные вопросы Battle (свой банк, число вопросов, порядок, время);
//   · дополнительные вопросы для ничьей за 1-е, 2-е и 3-е место.
// Чистый модуль: без DOM и Firebase, проверяется в Node.
//
// Где хранится. Тексты и правильные ответы лежат в закрытом документе
// testKeys/{testId}__battle — читают только сотрудники организации (студент и
// гость правилами не допускаются: id документа не совпадает с id теста).
// Участникам вопрос попадает только в момент проведения, БЕЗ правильного
// ответа: в публичный документ битвы / группу дуэли.
//
// Формат вопроса при подготовке — тот же, что у основного теста (parseQuiz):
//   «1. Текст», варианты «A) …», верный отмечен [+] или *. Поддерживаются
//   «один ответ» и «несколько ответов»; короткий ответ в Battle не нужен.
import { parseQuiz } from "./import/parser.js";

export const SET_VERSION = 1;
export const PLACES = [1, 2, 3];
export const MAX_MAIN = 100;       // основных вопросов Battle
export const MAX_PER_PLACE = 20;   // дополнительных вопросов на каждое место
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 10;

import { TEAMS, normalizeTask, validateTask, encodeTask, decodeTask } from "./practical.js";

export const battleSetDocId = (testId) => `${testId}__battle`;

export function emptyBattleSet() {
  return {
    version: SET_VERSION,
    main: { questions: [], count: null, order: "set", questionSeconds: null },
    placeTies: { 1: [], 2: [], 3: [] },
    // Таблица-задание после Battle: по одной на команду (null — не задана).
    // Заголовки и названия строк задаются здесь; в комнате команда вводит только значения.
    tables: { a: null, b: null }
  };
}

// ---------- нормализация ----------

function normalizeQuestion(raw) {
  if (!raw || typeof raw !== "object") return null;
  const text = String(raw.text ?? "").trim();
  const options = (Array.isArray(raw.options) ? raw.options : [])
    .map((o) => ({ text: String(o?.text ?? o ?? "").trim(), correct: o?.correct === true }))
    .filter((o) => o.text);
  const correctCount = options.filter((o) => o.correct).length;
  // Тип выводится из отметок: больше одного верного — множественный выбор.
  const type = correctCount > 1 ? "multiple" : "single";
  return { type, text, options };
}

const list = (value) => (Array.isArray(value) ? value : []).map(normalizeQuestion).filter(Boolean);
const posInt = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

// Безопасное приведение прочитанного из Firestore к известной форме.
export function normalizeBattleSet(raw) {
  const base = emptyBattleSet();
  if (!raw || typeof raw !== "object") return base;
  const main = raw.main && typeof raw.main === "object" ? raw.main : {};
  return {
    version: SET_VERSION,
    main: {
      questions: list(main.questions),
      count: posInt(main.count),
      order: main.order === "random" ? "random" : "set",
      questionSeconds: posInt(main.questionSeconds)
    },
    placeTies: Object.fromEntries(PLACES.map((p) => [p, list(raw.placeTies?.[p] ?? raw.placeTies?.[String(p)])])),
    tables: Object.fromEntries(TEAMS.map((t) => [t, raw.tables?.[t] && typeof raw.tables[t] === "object" ? normalizeTask(raw.tables[t]) : null]))
  };
}

// ---------- разбор текста ----------

// parseBattleText(raw) → { questions, errors }.
export function parseBattleText(raw) {
  const text = String(raw ?? "");
  if (!text.trim()) return { questions: [], errors: [] };
  let parsed;
  try { parsed = parseQuiz(text); } catch { return { questions: [], errors: ["Не удалось разобрать вопросы."] }; }
  const errors = [];
  for (const e of parsed.structuredErrors || []) if (e.severity === "error") errors.push(e.message);
  const questions = [];
  (parsed.questions || []).forEach((q, i) => {
    if (q.type === "short") { errors.push(`Вопрос ${i + 1}: короткий ответ не поддерживается — нужны варианты.`); return; }
    const n = normalizeQuestion(q);
    if (n) questions.push(n);
  });
  return { questions, errors: [...new Set(errors)] };
}

// ---------- проверка ----------

export function validateQuestion(q, label) {
  const errors = [];
  if (!q.text) errors.push(`${label}: нет текста вопроса.`);
  if (q.options.length < MIN_OPTIONS) errors.push(`${label}: нужно минимум два варианта.`);
  if (q.options.length > MAX_OPTIONS) errors.push(`${label}: не больше ${MAX_OPTIONS} вариантов.`);
  const correct = q.options.filter((o) => o.correct).length;
  if (correct === 0) errors.push(`${label}: не отмечен верный ответ.`);
  if (correct === q.options.length && q.options.length >= MIN_OPTIONS) errors.push(`${label}: верными не могут быть все варианты.`);
  return errors;
}

export function validateBattleSet(set) {
  const s = normalizeBattleSet(set);
  const errors = [];
  if (s.main.questions.length > MAX_MAIN) errors.push(`Основных вопросов Battle не больше ${MAX_MAIN}.`);
  s.main.questions.forEach((q, i) => errors.push(...validateQuestion(q, `Battle, вопрос ${i + 1}`)));
  if (s.main.count && s.main.questions.length && s.main.count > s.main.questions.length) {
    errors.push(`Число вопросов Battle (${s.main.count}) больше подготовленных (${s.main.questions.length}).`);
  }
  for (const p of PLACES) {
    const qs = s.placeTies[p];
    if (qs.length > MAX_PER_PLACE) errors.push(`Для ${p}-го места не больше ${MAX_PER_PLACE} вопросов.`);
    qs.forEach((q, i) => errors.push(...validateQuestion(q, `${p}-е место, вопрос ${i + 1}`)));
  }
  errors.push(...validateTables(s.tables));
  return errors;
}

// Таблицы после Battle: либо обе команды, либо ни одной. Проверка автоматическая
// (ведущий сверяет ответы по ключам), поэтому ячейки «вручную» не допускаются.
export function validateTables(tables) {
  const a = tables?.a || null;
  const b = tables?.b || null;
  if (!a && !b) return [];
  const errors = [];
  if (!a || !b) errors.push("Таблица после Battle: задайте её для обеих команд (можно скопировать).");
  for (const team of TEAMS) {
    const task = tables[team];
    if (!task) continue;
    errors.push(...validateTask(task, { team }));
    const manual = (task.rows || []).some((row) => (row || []).some((cell) => cell?.t === "answer" && cell.mode === "manual"));
    if (manual) errors.push(`Задание команды ${team === "a" ? "А" : "Б"}: проверка вручную в Battle недоступна — задайте ожидаемые ответы.`);
  }
  return errors;
}

export const hasTables = (set) => {
  const t = normalizeBattleSet(set).tables;
  return Boolean(t.a && t.b);
};

export const countMain = (set) => normalizeBattleSet(set).main.questions.length;
export const countForPlace = (set, place) => normalizeBattleSet(set).placeTies[place]?.length || 0;
export const isEmptySet = (set) => {
  const s = normalizeBattleSet(set);
  return !s.main.questions.length && PLACES.every((p) => !s.placeTies[p].length) && !s.tables.a && !s.tables.b;
};

// ---------- сериализация ----------

// Для Firestore: ключи placeTies — строки, без undefined.
export function toStoredSet(set) {
  const s = normalizeBattleSet(set);
  return {
    version: SET_VERSION,
    main: { ...s.main, count: s.main.count ?? null, questionSeconds: s.main.questionSeconds ?? null },
    placeTies: Object.fromEntries(PLACES.map((p) => [String(p), s.placeTies[p]])),
    // Строки таблицы кодируются (Firestore не принимает массив в массиве).
    tables: Object.fromEntries(TEAMS.map((t) => [t, s.tables[t] ? encodeTask(s.tables[t]) : null]))
  };
}

// Вопрос → текст в формате редактора (для повторного редактирования).
export function questionsToText(questions) {
  return (questions || []).map((q, i) => {
    const lines = [`${i + 1}. ${q.text}`];
    q.options.forEach((o, j) => lines.push(`${String.fromCharCode(65 + j)}) ${o.text}${o.correct ? " [+]" : ""}`));
    return lines.join("\n");
  }).join("\n\n");
}

// ---------- публичная и закрытая части ----------

const optionTexts = (q) => q.options.map((o) => o.text);
const correctIdx = (q) => q.options.map((o, i) => (o.correct ? i : -1)).filter((i) => i >= 0);

// То, что можно показывать участникам: без правильных ответов.
export function publicOf(q) {
  return { type: q.type, text: q.text, options: optionTexts(q) };
}

// Ключ в формате ключей теста (его понимает isCorrect дуэлей).
export function keyOf(q) {
  return { type: q.type, points: 1, correct: correctIdx(q) };
}

// ---------- запуск Battle ----------

function shuffled(items, rng) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Основные вопросы для запуска: { id, type, optionCount, correct, text, options }.
// count/order из настроек запуска имеют приоритет над сохранёнными в наборе.
export function mainQuestionsForLaunch(set, { count = null, order = null, rng = Math.random } = {}) {
  const s = normalizeBattleSet(set);
  const errors = validateBattleSet({ ...s, placeTies: emptyBattleSet().placeTies });
  if (!s.main.questions.length) return { questions: [], errors: [], used: false };
  if (errors.length) return { questions: [], errors, used: true };
  let picked = s.main.questions.map((q, i) => ({ q, i }));
  const how = order || s.main.order;
  if (how === "random") picked = shuffled(picked, rng);
  const n = posInt(count) ?? s.main.count;
  if (n) picked = picked.slice(0, n);
  return {
    used: true,
    errors: [],
    questions: picked.map(({ q, i }) => ({
      id: `m${i}`, type: q.type, optionCount: q.options.length, correct: correctIdx(q),
      text: q.text, options: optionTexts(q)
    }))
  };
}

// Решающие вопросы капитанов при ничьей в Battle — набор «1-е место».
// Если он пуст, вызывающий код продолжает старым способом (банк основных).
export function extraQuestionsForBattle(set) {
  const s = normalizeBattleSet(set);
  const qs = s.placeTies[1];
  if (!qs.length || validateBattleSet({ ...s, main: emptyBattleSet().main, placeTies: { 1: qs, 2: [], 3: [] } }).length) return [];
  return qs.map((q, i) => ({
    id: `x${i}`, type: q.type, optionCount: q.options.length, correct: correctIdx(q),
    text: q.text, options: optionTexts(q)
  }));
}

// ---------- ничьи в итоговом рейтинге Live (дуэли) ----------

// Банк для группы, делящей место `place`. 1/2/3 — подготовленные вопросы
// соответствующего набора; иначе (или если набор пуст) — null: вызывающий код
// использует прежний банк вопросов теста.
// Возвращает [{ qid, question(public), key }] с qid вида "t1:0".
export function duelBankForPlace(set, place) {
  if (!PLACES.includes(place)) return null;
  const s = normalizeBattleSet(set);
  const qs = s.placeTies[place];
  if (!qs.length) return null;
  if (qs.some((q, i) => validateQuestion(q, `${place}-е место, вопрос ${i + 1}`).length)) return null;
  return qs.map((q, i) => ({ qid: `t${place}:${i}`, question: { type: q.type, text: q.text, options: q.options.map((o) => ({ text: o.text })) }, key: keyOf(q) }));
}

export const isPreparedQid = (qid) => /^t[123]:\d+$/.test(String(qid ?? ""));
