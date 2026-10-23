const fs = require('fs');
const path = require('path');
const { parseQuiz } = require('./core/import/parser.js');
const { effectiveDeadline } = require('./core/editor.js');
const { emptyTest, validateTest } = require('./core/test-schema.js');

// Проверка базовых функций
function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL: ${message}`);
    console.log('Expected:', expected);
    console.log('Actual:', actual);
    process.exit(1);
  }
}

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
  assertEqual(result.questions.length, 2, 'Two questions with points');
  assertEqual(result.questions[0].points, 2, 'First question points');
  assertEqual(result.questions[0].explanation, 'Это важный вопрос.', 'First question explanation');
  assertEqual(result.questions[1].points, 1.5, 'Second question points');
  assertEqual(result.questions[1].explanation, 'Это другой вопрос.', 'Second question explanation');
  assertEqual(result.errors.length, 0, 'No errors');
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
  assertEqual(result.questions.length, 2, 'Two questions with explanations');
  assertEqual(result.questions[0].explanation, 'Это объяснение.', 'First question explanation');
  assertEqual(result.questions[1].explanation, 'Это другое объяснение.', 'Second question explanation');
  assertEqual(result.errors.length, 0, 'No errors');
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
  assertEqual(result.questions.length, 1, 'One question with A-J options');
  assertEqual(result.questions[0].options.length, 10, 'Ten options');
  assertEqual(result.questions[0].options[0].correct, true, 'First option correct');
  assertEqual(result.errors.length, 0, 'No errors');
}

// Ошибки
function testErrors() {
  const input = `1. Вопрос без вариантов?
`;
  const result = parseQuiz(input);
  assertEqual(result.errors.length, 1, 'One error');
  assertEqual(result.errors[0].includes('меньше двух вариантов ответа'), true, 'Error message');
}

// Структурированные ошибки
function testStructuredErrors() {
  const input = `1. Вопрос без ответа?
A) Вариант
`;
  const result = parseQuiz(input);
  assertEqual(result.structuredErrors.length, 1, 'One structured error');
  assertEqual(result.structuredErrors[0].severity, 'error', 'Severity');
  assertEqual(result.structuredErrors[0].message.includes('не содержит правильного ответа'), true, 'Error message');
}

// Предупреждения
function testWarnings() {
  const input = `1. Вопрос с одинаковыми вариантами?
A) Вариант [правильный]
A) Вариант
`;
  const result = parseQuiz(input);
  assertEqual(result.structuredErrors.length, 1, 'One warning');
  assertEqual(result.structuredErrors[0].severity, 'warning', 'Severity');
  assertEqual(result.structuredErrors[0].message.includes('одинаковые варианты ответа'), true, 'Warning message');
}

// Тесты для effectiveDeadline
function testBothTimers() {
  const qStartMs = Date.now();
  const attemptDeadlineMs = qStartMs + 10000;
  const timePerQuestionSec = 5;
  const result = effectiveDeadline(qStartMs, attemptDeadlineMs, timePerQuestionSec);
  assertEqual(result, attemptDeadlineMs, 'Both timers: min(qDeadline, attemptDeadlineMs)');
}

function testOnlyQuestionTimer() {
  const qStartMs = Date.now();
  const attemptDeadlineMs = Date.now() + 15000;
  const timePerQuestionSec = 10;
  const result = effectiveDeadline(qStartMs, null, timePerQuestionSec);
  assertEqual(result, qStartMs + 10000, 'Only question timer: qDeadline');
}

function testNoTimers() {
  const qStartMs = Date.now();
  const timePerQuestionSec = 5;
  const result = effectiveDeadline(qStartMs, null, null);
  assertEqual(result, qStartMs + 5000, 'No timers: qDeadline');
}

// Запуск тестов
console.log('Running parser tests...');
testWithPoints();
testWithExplanation();
testWithAJOptions();
testErrors();
testStructuredErrors();
testWarnings();

console.log('Running timing tests...');
testBothTimers();
testOnlyQuestionTimer();
testNoTimers();

console.log('All tests passed successfully!');