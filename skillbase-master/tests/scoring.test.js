import test from "node:test";
import assert from "node:assert/strict";
import {
  isCorrect,
  normalizeKeys,
  questionPoints,
  sanitizeAnswers,
  scoreAttempt
} from "../core/scoring.js";

const single = (correct, points) => ({ type: "single", correct: [correct], points });
const multiple = (correct, points) => ({ type: "multiple", correct, points });
const short = (answer, points) => ({ type: "short", answer, points });

test("single: верный индекс, строка и массив из одного значения", () => {
  const key = single(1);
  assert.equal(isCorrect(key, 1), true);
  assert.equal(isCorrect(key, "1"), true);
  assert.equal(isCorrect(key, [1]), true);
  assert.equal(isCorrect(key, 0), false);
  assert.equal(isCorrect(key, [0, 1]), false);
});

test("multiple: нужен точный набор, порядок не важен", () => {
  const key = multiple([0, 2]);
  assert.equal(isCorrect(key, [0, 2]), true);
  assert.equal(isCorrect(key, [2, 0]), true);
  assert.equal(isCorrect(key, ["2", "0"]), true);
  assert.equal(isCorrect(key, [0]), false);
  assert.equal(isCorrect(key, [0, 1, 2]), false);
  assert.equal(isCorrect(key, []), false);
});

test("short: регистр, ё и лишние пробелы не важны", () => {
  const key = short("  Зелёный   сигнал ");
  assert.equal(isCorrect(key, "зеленый сигнал"), true);
  assert.equal(isCorrect(key, "ЗЕЛЁНЫЙ СИГНАЛ"), true);
  assert.equal(isCorrect(key, "жёлтый"), false);
  assert.equal(isCorrect(key, ""), false);
});

test("short: пустой ключ не считается правильным ответом", () => {
  assert.equal(isCorrect(short(""), ""), false);
  assert.equal(isCorrect(short("   "), ""), false);
});

test("scoreAttempt: ручное решение преподавателя перекрывает авто-проверку short", () => {
  const keys = [short("зелёный", 2), single(1, 3)];
  const answers = { 0: "жёлтый", 1: 1 };

  const automatic = scoreAttempt(keys, answers);
  assert.deepEqual(automatic, { score: 3, total: 5, percent: 60 });

  const manual = scoreAttempt(keys, answers, { decisions: { "0": true } });
  assert.deepEqual(manual, { score: 5, total: 5, percent: 100 });

  const rejected = scoreAttempt(keys, { 0: "зелёный", 1: 0 }, { decisions: { "0": false } });
  assert.deepEqual(rejected, { score: 0, total: 5, percent: 0 });
});

test("scoreAttempt: ручное решение не перекрывает объективный вопрос", () => {
  const keys = [single(1, 4)];
  const answers = { 0: 0 };
  const result = scoreAttempt(keys, answers, { decisions: { "0": true } });
  assert.deepEqual(result, { score: 0, total: 4, percent: 0 });
});


test("пустые и некорректные ключи не дают баллов", () => {
  assert.equal(isCorrect(null, 0), false);
  assert.equal(isCorrect(undefined, 0), false);
  assert.equal(isCorrect({ type: "single", correct: [] }, 0), false);
  assert.equal(isCorrect({ type: "multiple", correct: ["x"] }, [0]), false);
  assert.equal(isCorrect({ type: "single", correct: [0] }, null), false);
  assert.equal(isCorrect({ type: "single", correct: [0] }, undefined), false);
  // false/true не должны превращаться в 0/1
  assert.equal(isCorrect({ type: "single", correct: [0] }, false), false);
  assert.equal(isCorrect({ type: "single", correct: [1] }, true), false);
  assert.equal(isCorrect({ type: "single", correct: [0] }, [false]), false);
});

test("баллы взвешиваются по points вопроса", () => {
  const keys = [single(0, 2), multiple([0, 2], 3)];
  const result = scoreAttempt(keys, { 0: 0, 1: [0, 2] });
  assert.deepEqual(result, { score: 5, total: 5, percent: 100 });
});

test("частично верная работа: score и percent считаются от суммы баллов", () => {
  const keys = [single(0, 2), multiple([0, 2], 3)];
  const result = scoreAttempt(keys, { 0: 0, 1: [0] });
  assert.equal(result.score, 2);
  assert.equal(result.total, 5);
  assert.equal(result.percent, 40);
});

test("максимальный балл — сумма points, а не число вопросов", () => {
  const keys = [single(0, 4), short("да", 1), single(2, 5)];
  const result = scoreAttempt(keys, [0, "нет", 2]);
  assert.equal(result.total, 10);
  assert.equal(result.score, 9);
  assert.equal(result.percent, 90);
});

test("старые ключи без points считаются по 1 баллу", () => {
  const keys = [{ type: "single", correct: [0] }, { type: "single", correct: [1] }];
  const result = scoreAttempt(keys, { 0: 0, 1: 0 });
  assert.deepEqual(result, { score: 1, total: 2, percent: 50 });
});

test("некорректные points не увеличивают максимум", () => {
  for (const value of [0, -2, "abc", "2", NaN, Infinity, null, true]) {
    assert.equal(questionPoints({ points: value }), 1);
  }
  const keys = [single(0, 0), single(1, -3), single(2, "abc")];
  const result = scoreAttempt(keys, { 0: 0, 1: 1, 2: 2 });
  assert.deepEqual(result, { score: 3, total: 3, percent: 100 });
});

test("пустые данные и отсутствие ответов дают нули", () => {
  assert.deepEqual(scoreAttempt([], {}), { score: 0, total: 0, percent: 0 });
  assert.deepEqual(scoreAttempt(null, null), { score: 0, total: 0, percent: 0 });
  assert.deepEqual(scoreAttempt([single(0, 2)], null), { score: 0, total: 2, percent: 0 });
  assert.deepEqual(scoreAttempt([single(0, 2)], {}), { score: 0, total: 2, percent: 0 });
});

test("дробные баллы не дают плавающей погрешности", () => {
  const keys = [single(0, 0.5), single(1, 1.5)];
  const result = scoreAttempt(keys, { 0: 0, 1: 1 });
  assert.deepEqual(result, { score: 2, total: 2, percent: 100 });

  const half = scoreAttempt(keys, { 0: 0, 1: 9 });
  assert.deepEqual(half, { score: 0.5, total: 2, percent: 25 });
});

test("normalizeKeys принимает объект items и сортирует по индексу", () => {
  const items = {
    "2": single(0, 1),
    "0": single(0, 2),
    "1": multiple([0, 1], 3)
  };
  const result = scoreAttempt(items, { 0: 0, 1: [0, 1], 2: 0 });
  assert.deepEqual(result, { score: 6, total: 6, percent: 100 });
  assert.deepEqual(normalizeKeys(items).map(key => key.points), [2, 3, 1]);
  assert.deepEqual(normalizeKeys(null), []);
  assert.deepEqual(normalizeKeys("items"), []);
});

// Старые документы testKeys хранят массив keys: [{ type, answer }, ...]
// вместо карты items. Читается через items ?? keys (attempts.js, editor.js),
// дальше работает normalizeKeys и isCorrect (answer вместо correct).
test("normalizeKeys принимает массив старого формата keys", () => {
  const legacy = [
    { type: "single", answer: 1 },
    { type: "short", answer: "ответ" }
  ];
  assert.equal(normalizeKeys(legacy), legacy);
  assert.deepEqual(
    scoreAttempt(legacy, { 0: 1, 1: "ответ" }),
    { score: 2, total: 2, percent: 100 }
  );
});

test("sanitizeAnswers оставляет только допустимые ответы", () => {
  const clean = sanitizeAnswers({
    "0": 2,
    "1": [2, 0, 2, -1, "1", 1.5],
    "2": "  ответ  ",
    "3": true,
    "4": { nested: "нет" },
    "5": 1.5,
    "6": -1,
    "x": 1
  });

  assert.deepEqual(clean, {
    "0": 2,
    "1": [0, 1, 2],
    "2": "  ответ  "
  });
});

test("sanitizeAnswers ограничивает длину короткого ответа", () => {
  const long = "я".repeat(5000);
  const clean = sanitizeAnswers({ 0: long });
  assert.equal(clean[0].length, 4000);
  assert.deepEqual(sanitizeAnswers(null), {});
  assert.deepEqual(sanitizeAnswers("нет"), {});
});

test("дубликаты в multiple не делают верный набор неверным", () => {
  assert.equal(isCorrect(multiple([0, 2]), [2, 0, 2]), true);
  assert.equal(isCorrect({ type: "multiple", correct: [0, 0, 2] }, [0, 2]), true);
});
