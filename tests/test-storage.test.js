import test from "node:test";
import assert from "node:assert/strict";
import { splitForStorage, mergeKeys } from "../core/test-storage.js";

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
