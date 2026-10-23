// core/scoring.js — чистая логика проверки ответов и подсчёта баллов.
// Модуль не импортирует Firebase и DOM, поэтому его можно тестировать в Node.
//
// Формат ключа (testKeys.items[i]):
//   { type: "single",   points: 2, correct: [1] }
//   { type: "multiple", points: 3, correct: [0, 2] }
//   { type: "short",    points: 1, answer: "зелёный" }
//
// В старых документах поля points может не быть — тогда вес вопроса равен 1.

const norm = (value) => String(value ?? "")
  .trim()
  .toLowerCase()
  .replace(/ё/g, "е")
  .replace(/\s+/g, " ");

// Вес вопроса. Некорректные и отсутствующие значения трактуются как 1 балл,
// чтобы совместимые старые попытки можно было проверить.
export function questionPoints(key) {
  const points = key?.points;
  return typeof points === "number" && Number.isFinite(points) && points > 0
    ? points
    : 1;
}

// testKeys.items — объект {"0": key, "1": key}; попытка может хранить массив.
export function normalizeKeys(keys) {
  if (Array.isArray(keys)) return keys;
  if (!keys || typeof keys !== "object") return [];

  return Object.keys(keys)
    .sort((a, b) => {
      const left = Number(a);
      const right = Number(b);
      if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
      return String(a).localeCompare(String(b));
    })
    .map(index => keys[index]);
}

// Индекс варианта. Булевы значения и мусор не должны случайно совпасть с 0/1.
const toIndex = (value) => {
  if (typeof value === "number") return Number.isInteger(value) ? value : NaN;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : NaN;
  }
  return NaN;
};

// Совместимость: в опубликованных тестах индексы вариантов хранятся в correct,
// в старых ключах мог использоваться answer.
export function isCorrect(key, answer) {
  if (!key || answer === undefined || answer === null) return false;

  if (key.type === "short") {
    const expected = norm(key.answer);
    if (!expected) return false;
    return norm(answer) === expected;
  }

  if (Array.isArray(key.correct)) {
    const correct = key.correct
      .map(toIndex)
      .filter(Number.isInteger)
      .sort((a, b) => a - b);

    if (!correct.length) return false;

    const selected = (Array.isArray(answer) ? answer : [answer])
      .map(toIndex)
      .filter(Number.isInteger)
      .sort((a, b) => a - b);

    if (key.type === "multiple") {
      return selected.length === correct.length &&
        selected.every((value, i) => value === correct[i]);
    }

    return correct.length === 1 && selected.length === 1 &&
      selected[0] === correct[0];
  }

  // Старый формат: несколько ответов текстом.
  if (key.type === "multiple") {
    const selected = (Array.isArray(answer) ? answer : []).map(String).sort();
    const expected = (Array.isArray(key.answer) ? key.answer : []).map(String).sort();

    return expected.length > 0 &&
      selected.length === expected.length &&
      selected.every((value, i) => value === expected[i]);
  }

  return answer === key.answer;
}

const roundPoints = (value) => Math.round(value * 100) / 100;

// Возвращает { score, total, percent }.
// answers — объект {"0": ...} или массив; отсутствующие ответы считаются пустыми.
// decisions — необязательная карта {"2": true/false} для ручной проверки
// коротких ответов преподавателем. Для объективных вопросов её не используем.
export function scoreAttempt(keys, answers, { decisions = null } = {}) {
  const list = normalizeKeys(keys);
  const answersAreArray = Array.isArray(answers);

  let score = 0;
  let total = 0;

  list.forEach((key, index) => {
    const points = questionPoints(key);
    total += points;
    const answer = answersAreArray
      ? answers[index]
      : (answers && typeof answers === "object" ? answers[String(index)] : undefined);

    const decision = decisions && Object.prototype.hasOwnProperty.call(decisions, String(index))
      ? decisions[String(index)]
      : null;
    // Ручное решение преподавателя предусмотрено только для коротких
    // ответов. Объективные вопросы всегда проверяются по ключу.
    const correct = key?.type === "short" && typeof decision === "boolean"
      ? decision
      : isCorrect(key, answer);

    if (correct) score += points;
  });

  score = roundPoints(score);
  total = roundPoints(total);

  return {
    score,
    total,
    percent: total > 0 ? Math.round((score / total) * 100) : 0
  };
}
