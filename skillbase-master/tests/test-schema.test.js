import test from "node:test";
import assert from "node:assert/strict";
import { emptyTest, validateTest } from "../core/test-schema.js";

function validTest() {
  const t = emptyTest();
  t.title = "Проверка знаний";
  t.mode = "self";
  t.settings.passScore = 70;
  t.questions = [{
    type: "single",
    text: "Какой сигнал разрешает движение?",
    options: [
      { text: "Красный", correct: false },
      { text: "Зелёный", correct: true },
      { text: "Жёлтый", correct: false }
    ],
    points: 1
  }];
  return t;
}

test("single допускает несколько вариантов и один правильный", () => {
  assert.deepEqual(validateTest(validTest()).errors, []);
});

test("single требует ровно один правильный вариант", () => {
  const t = validTest();
  t.questions[0].options[1].correct = false;
  assert.ok(validateTest(t).errors.some(x => x.includes("ровно один")));
});

test("multiple требует минимум два правильных варианта", () => {
  const t = validTest();
  t.questions[0].type = "multiple";
  assert.ok(validateTest(t).errors.some(x => x.includes("минимум два правильных")));
});

test("short требует текст правильного ответа", () => {
  const t = validTest();
  t.questions[0] = { type: "short", text: "Назовите сигнал", answer: "", points: 1 };
  assert.ok(validateTest(t).errors.some(x => x.includes("должен иметь ответ")));
});

test("passScore 0 и значения вне диапазона отклоняются", () => {
  const t = validTest();
  t.settings.passScore = 0;
  assert.ok(validateTest(t).errors.some(x => x.includes("Проходной балл")));
  t.settings.passScore = 101;
  assert.ok(validateTest(t).errors.some(x => x.includes("Проходной балл")));
});

test("некорректные баллы отклоняются", () => {
  const t = validTest();
  t.questions[0].points = 0;
  assert.ok(validateTest(t).errors.some(x => x.includes("баллы")));

  t.questions[0].points = NaN;
  assert.ok(validateTest(t).errors.some(x => x.includes("баллы")));

  t.questions[0].points = "2";
  assert.ok(validateTest(t).errors.some(x => x.includes("баллы")));
});

test("пустой текст варианта отклоняется", () => {
  const t = validTest();
  t.questions[0].options[0].text = "   ";
  assert.ok(validateTest(t).errors.some(x => x.includes("вариант 1 пуст")));
});

test("passScore необязателен: null допустим и для черновика, и для публикации", () => {
  const t = validTest();
  t.settings.passScore = null;
  assert.deepEqual(validateTest(t).errors, []);
  assert.deepEqual(validateTest(t, { publishing: true }).errors, []);
});

test("passScore 1 и 100 допустимы", () => {
  const t = validTest();
  t.settings.passScore = 1;
  assert.deepEqual(validateTest(t).errors, []);
  t.settings.passScore = 100;
  assert.deepEqual(validateTest(t).errors, []);
});

test("отсутствие settings не роняет проверку", () => {
  const t = validTest();
  delete t.settings;
  const result = validateTest(t);
  assert.equal(result.errors.some(x => x.includes("Проходной балл")), false);
});

test("settings не-объект отклоняется", () => {
  const t = validTest();
  t.settings = [];
  assert.ok(validateTest(t).errors.some(x => x.includes("Настройки теста")));
});

test("повреждённый список вопросов отклоняется", () => {
  const t = validTest();
  t.questions = "не массив";
  assert.ok(validateTest(t).errors.some(x => x.includes("Список вопросов")));
});

test("публикация ограничивает число вопросов", () => {
  const t = validTest();
  t.questions = Array.from({ length: 201 }, (_, i) => ({
    type: "short",
    text: `Вопрос ${i + 1}`,
    answer: "ответ",
    points: 1
  }));
  assert.equal(validateTest(t).errors.some(x => x.includes("200 вопросов")), false);
  assert.ok(validateTest(t, { publishing: true }).errors.some(x => x.includes("200 вопросов")));
});

test("большой тест: предупреждение в черновике, ошибка при публикации", () => {
  const t = validTest();
  t.description = "x".repeat(720 * 1024);

  const draft = validateTest(t);
  assert.ok(draft.warnings.some(x => x.includes("превышает размер")));
  assert.equal(draft.errors.some(x => x.includes("превышает размер")), false);

  const publish = validateTest(t, { publishing: true });
  assert.ok(publish.errors.some(x => x.includes("превышает размер")));
});

test("validateTest не падает на null и не-объекте", () => {
  assert.ok(validateTest(null).errors.length > 0);
  assert.ok(validateTest("тест").errors.length > 0);
  assert.ok(validateTest(42).errors.length > 0);
});
