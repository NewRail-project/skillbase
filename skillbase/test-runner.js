const fs = require('fs');
const path = require('path');
const { parseQuiz } = require('./core/import/parser.js');
const { effectiveDeadline } = require('./core/editor.js');
const assert = require('assert');

// Баллы
function testWithPoints() {
  const input = `1. Вопрос?
A) Вариант [правильный]
Баллы: 2
Пояснение: Это важный вопрос.
B) Вариант 2 [правильный]
2. Вопрос 2?
A) Вариант 3
Баллы: 1.5
Пояснение: Это другой вопрос.
B) Вариант 4
`;
  const result = parseQuiz(input);
  assert.strictEqual(result.questions.length, 2, 'Two questions with points');
  assert.strictEqual(result.questions[0].points, 2, 'First question points');
  assert.strictEqual(result.questions[0].explanation, 'Это важный вопрос.', 'First question explanation');
  assert.strictEqual(result.questions[1].points, 1.5, 'Second question points');
  assert.strictEqual(result.questions[1].explanation, 'Это другой вопрос.', 'Second question explanation');
  assert.strictEqual(result.errors.length, 0, 'No errors');
}

// Пояснение
function testWithExplanation() {
  const input = `1. Вопрос?
A) Вариант [правильный]
Пояснение: Это объяснение.
B) Вариант 2
2. Вопрос 2?
A) Вариант 3
Пояснение: Это другое объяснение.
B) Вариант 4
`;
  const result = parseQuiz(input);
  assert.strictEqual(result.questions.length, 2, 'Two questions with explanations');
  assert.strictEqual(result.questions[0].explanation, 'Это объяснение.', 'First question explanation');
  assert.strictEqual(result.questions[1].explanation, 'Это другое объяснение.', 'Second question explanation');
  assert.strictEqual(result.errors.length, 0, 'No errors');
}

// Варианты A-J
function testWithAJOptions() {
  const input = `1. Вопрос?
A) Вариант A [правильный]
B) Вариант B
C) Вариант C
D) Вариант D
E) Вариант E
F) Вариант F
G) Вариант G
H) Вариант H
I) Вариант I
J) Вариант J
`;
  const result = parseQuiz(input);
  assert.strictEqual(result.questions.length, 1, 'One question with A-J options');
  assert.strictEqual(result.questions[0].options.length, 10, 'Ten options');
  assert.strictEqual(result.questions[0].options[0].correct, true, 'First option correct');
  assert.strictEqual(result.errors.length, 0, 'No errors');
}

// Ошибки
function testErrors() {
  const input = `1. Вопрос без вариантов?
`;
  const result = parseQuiz(input);
  assert.strictEqual(result.errors.length, 1, 'One error');
  assert(result.errors[0].includes('меньше двух вариантов ответа'), 'Error message');
}

// Структурированные ошибки
function testStructuredErrors() {
  const input = `1. Вопрос без ответа?
A) Вариант
`;
  const result = parseQuiz(input);
  assert.strictEqual(result.structuredErrors.length, 1, 'One structured error');
  assert.structEqual(result.structuredErrors[0].severity, 'error', 'Severity');
  assert(result.structuredErrors[0].message.includes('не содержит правильного ответа'), 'Error message');
}

// Предупреждения
function testWarnings() {
  const input = `1. Вопрос с одинаковыми вариантами?
A) Вариант [правильный]
A) Вариант
`;
  const result = parseQuiz(input);
  assert.strictEqual(result.structuredErrors.length, 1, 'One warning');
  assert.strictEqual(result.structuredErrors[0].severity, 'warning', 'Severity');
  assert(result.structuredErrors[0].message.includes('одинаковые варианты ответа'), 'Warning message');
}

// Тесты из исходного кода
function testSingleChoice() {
  const input = `1. Вопрос 1?
A) Вариант [правильный]
B) Второй вариант`;
  const result = parseQuiz(input);
  assert.strictEqual(result.questions.length, 1, 'One question parsed');
  assert.strictEqual(result.questions[0].type, 'single', 'Question type single');
  assert.strictEqual(result.questions[0].text, 'Вопрос 1?', 'Question text');
  assert.strictEqual(result.questions[0].options.length, 2, 'Two options');
  assert.strictEqual(result.questions[0].options[0].correct, true, 'Option correct');
  assert.strictEqual(result.questions[0].answer, 'Вариант', 'Answer text');
  assert.strictEqual(result.errors.length, 0, 'No errors');
}

// Тесты для effectiveDeadline
function testBothTimers() {
  const qStartMs = Date.now();
  const attemptDeadlineMs = qStartMs + 10000;
  const timePerQuestionSec = 5;
  const result = effectiveDeadline(qStartMs, attemptDeadlineMs, timePerQuestionSec);
  assert.strictEqual(result, attemptDeadlineMs, 'Both timers: min(qDeadline, attemptDeadlineMs)');
}

function testOnlyQuestionTimer() {
  const qStartMs = Date.now();
  const attemptDeadlineMs = Date.now() + 15000;
  const timePerQuestionSec = 10;
  const result = effectiveDeadline(qStartMs, null, timePerQuestionSec);
  assert.strictEqual(result, qStartMs + 10000, 'Only question timer: qDeadline');
}

function testNoTimers() {
  const qStartMs = Date.now();
  const timePerQuestionSec = 5;
  const result = effectiveDeadline(qStartMs, null, null);
  assert.strictEqual(result, qStartMs + 5000, 'No timers: qDeadline');
}

// Запуск всех тестов
console.log('Running parser tests...');
testWithPoints();
testWithExplanation();
testWithAJOptions();
testErrors();
testStructuredErrors();
testWarnings();
testSingleChoice();

console.log('Running timing tests...');
testBothTimers();
testOnlyQuestionTimer();
testNoTimers();

console.log('All tests passed successfully!');