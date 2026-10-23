const { parseQuiz } = require('./core/import/parser.js');
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
  console.log('Points test result:', result);
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
  console.log('Explanation test result:', result);
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
  console.log('AJ options test result:', result);
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
  console.log('Error test result:', result);
  assert.strictEqual(result.errors.length, 1, 'One error');
  assert(result.errors[0].includes('меньше двух вариантов ответа'), 'Error message');
}

// Структурированные ошибки
function testStructuredErrors() {
  const input = `1. Вопрос без ответа?
A) Вариант
`;
  const result = parseQuiz(input);
  console.log('Structured errors test result:', result);
  assert.strictEqual(result.structuredErrors.length, 1, 'One structured error');
  assert.strictEqual(result.structuredErrors[0].severity, 'error', 'Severity');
  assert(result.structuredErrors[0].message.includes('не содержит правильного ответа'), 'Error message');
}

// Предупреждения
function testWarnings() {
  const input = `1. Вопрос с одинаковыми вариантами?
A) Вариант [правильный]
A) Вариант
`;
  const result = parseQuiz(input);
  console.log('Warning test result:', result);
  assert.strictEqual(result.structuredErrors.length, 1, 'One warning');
  assert.strictEqual(result.structuredErrors[0].severity, 'warning', 'Severity');
  assert(result.structuredErrors[0].message.includes('одинаковые варианты ответа'), 'Warning message');
}

// Запуск тестов
console.log('Running parser tests...');
testWithPoints();
testWithExplanation();
testWithAJOptions();
testErrors();
testStructuredErrors();
testWarnings();
console.log('All parser tests passed successfully!');