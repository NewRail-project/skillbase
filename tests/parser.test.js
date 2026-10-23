import { test } from 'node:test';
import { parseQuiz } from '../core/import/parser.js';

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\n  ожидалось: ${JSON.stringify(expected)}\n  получено:  ${JSON.stringify(actual)}`);
  }
}

// Helper to run a single test case

// Баллы
function testWithPoints() {
  const input = `1. Вопрос?
A) Вариант [правильный]
Баллы: 2
Пояснение: Это важный вопрос.
B) Вариант 2 [правильный]
2. Вопрос 2?
A) Вариант 3 [правильный]
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
A) Вариант 3 [правильный]
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
  assertEqual(result.structuredErrors[0].line, 1, 'Error line');
  assertEqual(result.structuredErrors[0].message.includes('меньше двух вариантов'), true, 'Error message');
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

// Тесты из исходного кода

// Single choice with [правильный] marker
test('Single choice with [правильный] marker', () => {
  const input = `1. Вопрос 1?
A) Вариант [правильный]
B) Второй вариант`;
  const result = parseQuiz(input);
  assertEqual(result.questions.length, 1, 'One question parsed');
  assertEqual(result.questions[0].type, 'single', 'Question type single');
  assertEqual(result.questions[0].text, 'Вопрос 1?', 'Question text');
  assertEqual(result.questions[0].options.length, 2, 'Two options');
  assertEqual(result.questions[0].options[0].correct, true, 'Option correct');
  assertEqual(result.questions[0].answer, 'Вариант', 'Answer text');
  assertEqual(result.errors.length, 0, 'No errors');
});

// Single choice with [correct] marker
test('Single choice with [correct] marker', () => {
  const input = `1. Вопрос 2?
B) Вариант [correct]
C) Ошибка`;
  const result = parseQuiz(input);
  assertEqual(result.questions.length, 1, 'One question');
  assertEqual(result.questions[0].options[0].correct, true, 'Correct');
  assertEqual(result.questions[0].answer, 'Вариант', 'Answer');
});

// Single choice with [+] marker
test('Single choice with [+] marker', () => {
  const input = `1. Вопрос 3?
C) Вариант [+]
D) Нет`;
  const result = parseQuiz(input);
  assertEqual(result.questions[0].options[0].correct, true, 'Correct');
});

// Multiple correct using * marker
test('Multiple correct using * marker', () => {
  const input = `1. Вопрос 4?
A) Вариант 1 *
B) Вариант 2 *`;
  const result = parseQuiz(input);
  assertEqual(result.questions.length, 1, 'One question');
  assertEqual(result.questions[0].type, 'multiple', 'Multiple type');
  assertEqual(result.questions[0].options.filter(o => o.correct).length, 2, 'Two correct');
});

// Short answer type (Ответ:)
test('Short answer type (Ответ:)', () => {
  const input = `1. Какой цвет неба? Ответ: синий`;
  const result = parseQuiz(input);
  assertEqual(result.questions.length, 1, 'One short question');
  assertEqual(result.questions[0].type, 'short', 'Type short');
  assertEqual(result.questions[0].text, 'Какой цвет неба?', 'Question text');
  assertEqual(result.questions[0].answer, 'синий', 'Short answer');
  assertEqual(result.questions[0].options.length, 0, 'No options for short');
});

// No correct answer – error
test('No correct answer – error', () => {
  const input = `1. Вопрос без правильного ответа?
A) Вариант
B) Другой`;
  const result = parseQuiz(input);
  assertEqual(result.errors.length, 1, 'One error about missing correct');
  assertEqual(result.errors[0].includes('не содержит правильного ответа'), true, 'Error message');
});

// Less than two options – error
test('Less than two options – error', () => {
  const input = `1. Вопрос с одним вариантом?
A) Единственный`;
  const result = parseQuiz(input);
  assertEqual(result.errors.length, 1, 'Errors for less than two options');
  assertEqual(result.errors[0].includes('меньше двух вариантов ответа'), true, 'Error message');
});

// Multiple correct options leads to type multiple
test('Multiple correct options leads to type multiple', () => {
  const input = `1. Много правильных?
A) Вариант 1 [правильный]
B) Вариант 2 [правильный]`;
  const result = parseQuiz(input);
  assertEqual(result.questions[0].type, 'multiple', 'Type multiple');
  assertEqual(result.questions[0].options.filter(o => o.correct).length, 2, 'Two correct options');
  assertEqual(result.questions[0].answer, ['Вариант 1', 'Вариант 2'], 'Answer array');
});

// Clean whitespace handling
test('Clean whitespace handling', () => {
  const input = `  1.  Вопрос с пробелами  
   A)  Вариант  	  [correct]  
   B)  Второй  `;
  const result = parseQuiz(input);
  assertEqual(result.questions.length, 1, 'Parsed');
  assertEqual(result.questions[0].text, 'Вопрос с пробелами', 'Trimmed text');
  assertEqual(result.questions[0].options.length, 2, 'Two options');
  assertEqual(result.questions[0].options[0].correct, true, 'First correct');
  assertEqual(result.questions[0].options[1].correct, false, 'Second not correct');
});

// Cyrillic option markers (А,Б,В)
test('Cyrillic option markers (А,Б,В)', () => {
  const input = `1. Вопрос?
А) Правильный [верный]
B) Неправильный`;
  const result = parseQuiz(input);
  assertEqual(result.questions[0].options.length, 2, 'Two options');
  assertEqual(result.questions[0].options[0].correct, true, 'First correct');
});

// Mixed punctuation for questions (1. 2)
test('Mixed punctuation for questions (1. 2)', () => {
  const input = `1. Вопрос 1?
A) Вариант 1 [правильный]
B) Вариант 2
2) Вопрос 2?
A) Вариант
`;
  const result = parseQuiz(input);
  assertEqual(result.questions.length, 2, 'Two questions');
});

// Empty lines and extra blank lines
test('Empty lines and extra blank lines', () => {
  const input = `1. Вопрос?
A) Вариант [correct]

2. Еще вопрос?
B) Вариант
`;
  const result = parseQuiz(input);
  assertEqual(result.questions.length, 2, 'Two questions');
  assertEqual(result.questions[0].options[0].correct, true, 'First correct');
  assertEqual(result.questions[1].options.length, 1, 'Second has one option');
});

// Баллы и пояснение
test('Баллы и пояснение', testWithPoints);
test('Пояснение', testWithExplanation);

// Варианты A-J
test('Варианты A-J', testWithAJOptions);

// Ошибки и предупреждения
test('Вопрос без вариантов', testErrors);
test('Структурированные ошибки', testStructuredErrors);
test('Предупреждение об одинаковых вариантах', testWarnings);