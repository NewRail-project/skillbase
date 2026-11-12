import test from "node:test";
import assert from "node:assert/strict";
import { splitForStorage, mergeKeys, sanitizePublicTest } from "../core/test-storage.js";
import { scoreAttempt } from "../core/scoring.js";

function sourceTest() {
  return {
    id: "test-1",
    title: "Сигналы",
    description: "",
    instructions: "",
    category: "",
    color: "",
    authorId: "teacher-1",
    orgId: "default-org",
    status: "draft",
    mode: "self",
    version: 1,
    settings: { passScore: null, attemptsLimit: 3 },
    questions: [
      {
        type: "single",
        text: "Разрешающий сигнал?",
        options: [
          { text: "Красный", correct: false },
          { text: "Зелёный", correct: true }
        ],
        points: 2
      },
      {
        type: "multiple",
        text: "Запрещающие сигналы?",
        options: [
          { text: "Красный", correct: true },
          { text: "Зелёный", correct: false },
          { text: "Синий", correct: true }
        ],
        points: 3
      },
      {
        type: "short",
        text: "Сколько рельсов?",
        answer: "два",
        points: 1
      }
    ]
  };
}

function collectUndefined(value, path = "root", found = []) {
  if (value === undefined) {
    found.push(path);
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUndefined(item, `${path}[${index}]`, found));
    return found;
  }
  if (value && typeof value === "object") {
    Object.keys(value).forEach(key => collectUndefined(value[key], `${path}.${key}`, found));
  }
  return found;
}

test("публичная часть не содержит правильных ответов", () => {
  const { publicTest } = splitForStorage(sourceTest());

  assert.equal(publicTest.questions.length, 3);
  assert.deepEqual(
    publicTest.questions.map(q => q.points),
    [2, 3, 1]
  );
  assert.equal(publicTest.questions[0].answer, undefined);
  assert.equal(publicTest.questions[0].options[1].correct, undefined);
  assert.equal(publicTest.questions[2].answer, undefined);

  const json = JSON.stringify(publicTest);
  assert.equal(json.includes("\"correct\""), false);
  assert.equal(json.includes("Зелёный\",\"correct"), false);
});

test("публичная часть не копирует лишние поля теста", () => {
  const source = sourceTest();
  source.answerKey = { "0": [1] };
  source.keys = { "0": { answer: "Зелёный" } };
  source.secret = "не для ученика";

  const { publicTest } = splitForStorage(source);
  assert.equal("answerKey" in publicTest, false);
  assert.equal("keys" in publicTest, false);
  assert.equal("secret" in publicTest, false);
});

test("sanitizePublicTest очищает старый документ от ключей", () => {
  const legacy = {
    id: "old",
    title: "Старый тест",
    status: "published",
    authorId: "teacher-1",
    orgId: "default-org",
    secret: "лишнее",
    questions: [
      {
        type: "single",
        text: "Вопрос",
        answer: "Зелёный",
        correct: [1],
        explanation: "подсказка",
        lineNumber: 1,
        options: [
          { text: "Красный", correct: false, hint: "нет" },
          { text: "Зелёный", correct: true }
        ],
        points: 2,
        required: true
      },
      {
        type: "short",
        text: "Короткий",
        answer: "два",
        explanation: "секрет",
        options: [{ text: "лишний", correct: true }],
        points: 1
      }
    ]
  };

  const clean = sanitizePublicTest(legacy);
  assert.equal(clean.id, "old");
  assert.equal(clean.title, "Старый тест");
  assert.equal("secret" in clean, false);
  assert.deepEqual(clean.questions[0], {
    type: "single",
    text: "Вопрос",
    options: [{ text: "Красный" }, { text: "Зелёный" }],
    points: 2,
    required: true
  });
  assert.deepEqual(clean.questions[1], {
    type: "short",
    text: "Короткий",
    options: [],
    points: 1,
    required: false
  });

  const json = JSON.stringify(clean);
  assert.equal(json.includes("\"correct\""), false);
  assert.equal(json.includes("\"answer\""), false);
  assert.equal(json.includes("подсказка"), false);
  assert.equal(json.includes("секрет"), false);
});

test("sanitizePublicTest не падает на пустые данные", () => {
  assert.deepEqual(sanitizePublicTest(null), { questions: [] });
  assert.deepEqual(sanitizePublicTest({ questions: "нет" }), { questions: [] });
});

test("ключи хранят индексы, ответы и баллы", () => {
  const { keys } = splitForStorage(sourceTest());

  assert.deepEqual(keys["0"], { type: "single", points: 2, correct: [1] });
  assert.deepEqual(keys["1"], { type: "multiple", points: 3, correct: [0, 2] });
  assert.deepEqual(keys["2"], { type: "short", points: 1, answer: "два" });
});

test("в публичном документе нет undefined (Firestore их не принимает)", () => {
  const { publicTest, keys } = splitForStorage(sourceTest());
  assert.deepEqual(collectUndefined(publicTest), []);
  assert.deepEqual(collectUndefined(keys), []);
});

test("необязательное изображение добавляется только при наличии", () => {
  const source = sourceTest();
  source.questions[0].image = "https://example.com/signal.png";
  const { publicTest } = splitForStorage(source);

  assert.equal(publicTest.questions[0].image, "https://example.com/signal.png");
  assert.equal("image" in publicTest.questions[1], false);
  assert.deepEqual(collectUndefined(publicTest), []);
});

test("пустой тест не падает и даёт пустые вопросы и ключи", () => {
  const { publicTest, keys } = splitForStorage({ title: "Пусто", questions: [] });
  assert.deepEqual(publicTest.questions, []);
  assert.deepEqual(keys, {});

  const empty = splitForStorage(undefined);
  assert.deepEqual(empty.publicTest.questions, []);
  assert.deepEqual(empty.keys, {});
});

test("mergeKeys возвращает автору правильные ответы", () => {
  const { publicTest, keys } = splitForStorage(sourceTest());
  const merged = mergeKeys(publicTest, keys);

  assert.equal(merged.questions[0].options[1].correct, true);
  assert.equal(merged.questions[0].options[0].correct, false);
  assert.equal(merged.questions[1].options[0].correct, true);
  assert.equal(merged.questions[1].options[2].correct, true);
  assert.equal(merged.questions[2].answer, "два");
});

test("mergeKeys без ключей оставляет публичную часть как есть", () => {
  const { publicTest } = splitForStorage(sourceTest());
  const merged = mergeKeys(publicTest, null);
  assert.deepEqual(merged, publicTest);
  assert.equal(merged.questions[0].options[1].correct, undefined);
});

test("пояснение хранится в ключах и не попадает в публичную часть", () => {
  const source = sourceTest();
  source.questions[0].explanation = "Зелёный разрешает движение.";
  source.questions[2].explanation = "Два рельса.";

  const { publicTest, keys } = splitForStorage(source);
  assert.equal(publicTest.questions[0].explanation, undefined);
  assert.equal(publicTest.questions[2].explanation, undefined);
  assert.equal(keys["0"].explanation, "Зелёный разрешает движение.");
  assert.equal(keys["2"].explanation, "Два рельса.");

  const merged = mergeKeys(publicTest, keys);
  assert.equal(merged.questions[0].explanation, "Зелёный разрешает движение.");
  assert.equal(merged.questions[2].explanation, "Два рельса.");
});

test("полный цикл: публичная часть, ключи и баллы для всех типов", () => {
  const source = sourceTest();
  const { publicTest, keys } = splitForStorage(source);

  // Ученик получает вопросы без ответов.
  assert.equal(JSON.stringify(publicTest).includes("\"correct\""), false);
  assert.equal(JSON.stringify(publicTest).includes("\"answer\""), false);

  // Автор после загрузки видит те же отметки и ответы.
  const merged = mergeKeys(publicTest, keys);
  assert.equal(merged.questions[0].options[1].correct, true);
  assert.equal(merged.questions[1].options[2].correct, true);
  assert.equal(merged.questions[2].answer, "два");

  // Подсчёт: single 2 б., multiple 3 б., short 1 б.
  assert.deepEqual(scoreAttempt(keys, { 0: 1, 1: [2, 0], 2: " Два " }), {
    score: 6,
    total: 6,
    percent: 100
  });
  assert.deepEqual(scoreAttempt(keys, { 0: 0, 1: [0], 2: "три" }), {
    score: 0,
    total: 6,
    percent: 0
  });
});
