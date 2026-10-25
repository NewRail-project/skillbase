import test from "node:test";
import assert from "node:assert/strict";
import { serializeTest } from "../core/import/serializer.js";
import { parseQuiz } from "../core/import/parser.js";

test("serializeTest сохраняет типы, правильные ответы и баллы", () => {
  const test = {
    questions: [
      {
        type: "single",
        text: "Один?",
        options: [{ text: "A", correct: false }, { text: "B", correct: true }],
        points: 1
      },
      {
        type: "multiple",
        text: "Много?",
        options: [
          { text: "A", correct: true },
          { text: "B", correct: false },
          { text: "C", correct: true }
        ],
        points: 2,
        explanation: "Потому что"
      },
      {
        type: "short",
        text: "Коротко?",
        answer: "зелёный",
        points: 3
      }
    ]
  };

  const parsed = parseQuiz(serializeTest(test));

  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.questions.length, 3);
  assert.equal(parsed.questions[0].type, "single");
  assert.deepEqual(parsed.questions[0].options.map(o => o.correct), [false, true]);
  assert.equal(parsed.questions[1].type, "multiple");
  assert.deepEqual(parsed.questions[1].options.map(o => o.correct), [true, false, true]);
  assert.equal(parsed.questions[1].points, 2);
  assert.equal(parsed.questions[1].explanation, "Потому что");
  assert.equal(parsed.questions[2].type, "short");
  assert.equal(parsed.questions[2].answer, "зелёный");
  assert.equal(parsed.questions[2].points, 3);
});

test("serializeTest не роняет пустой тест", () => {
  assert.equal(serializeTest({}), "");
  assert.equal(serializeTest(null), "");
});
