// tests/parser.test.js
import { test } from 'node:test';
import { parseQuiz } from '../core/import/parser.js';

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL: ${message}`);
    console.log('Expected:', expected);
    console.log('Actual:', actual);
    process.exit(1);
  }
}

// Helper to run a single test case
test('Single choice with [правильный] marker', () => {
  const input = `1. Вопрос 1?\nA) Вариант [правильный]\nB) Второй вариант`;
  const result = parseQuiz(input);
  assertEqual(result.questions.length, 1, 'One question parsed');
  assertEqual(result.questions[0].type, 'single', 'Question type single');
  assertEqual(result.questions[0].text, 'Вопрос 1?', 'Question text');
  assertEqual(result.questions[0].options.length, 2, 'Two options');
  assertEqual(result.questions[0].options[0].correct, true, 'Option correct');
  assertEqual(result.questions[0].answer, 'Вариант', 'Answer text');
  assertEqual(result.errors.length, 0, 'No errors');
});

test('Single choice with [correct] marker', () => {
  const input = `1. Вопрос 2?\nB) Вариант [correct]\nC) Ошибка`;
  const result = parseQuiz(input);
  assertEqual(result.questions.length, 1, 'One question');
  assertEqual(result.questions[0].options[0].correct, true, 'Correct');
  assertEqual(result.questions[0].answer, 'Вариант', 'Answer');
});

test('Single choice with [+] marker', () => {
  const input = `1. Вопрос 3?\nC) Вариант [+]\nD) Нет`;
  const result = parseQuiz(input);
  assertEqual(result.questions[0].options[0].correct, true, 'Correct');
});

test('Multiple correct using * marker', () => {
  const input = `1. Вопрос 4?\nA) Вариант 1 *\nB) Вариант 2 *`;
  const result = parseQuiz(input);
  assertEqual(result.questions.length, 1, 'One question');
  // Both options should be correct
  assertEqual(result.questions[0].type, 'multiple', 'Multiple type');
  assertEqual(result.questions[0].options.filter(o => o.correct).length, 2, 'Two correct');
});

test('Short answer type (Ответ:)', () => {
  const input = `1. Какой цвет неба? Ответ: синий`;
  const result = parseQuiz(input);
  assertEqual(result.questions.length, 1, 'One short question');
  assertEqual(result.questions[0].type, 'short', 'Type short');
  assertEqual(result.questions[0].text, 'Какой цвет неба?', 'Question text');
  assertEqual(result.questions[0].answer, 'синий', 'Short answer');
  assertEqual(result.questions[0].options.length, 0, 'No options for short');
});

test('No correct answer – error', () => {
  const input = `1. Вопрос без правильного ответа?\nA) Вариант\nB) Другой`;
  const result = parseQuiz(input);
  assertEqual(result.errors.length, 1, 'One error about missing correct');
  assertEqual(result.errors[0].includes('не содержит правильного ответа'), true, 'Error message');
});

test('Less than two options – error', () => {
  const input = `1. Вопрос с одним вариантом?\nA) Единственный`;
  const result = parseQuiz(input);
  assertEqual(result.errors.length, 2, 'Errors for less than two options and missing correct');
  assertEqual(result.errors[0].includes('меньше двух вариантов ответа'), true, 'Error message');
});

test('Multiple correct options leads to type multiple', () => {
  const input = `1. Много правильных?\nA) Вариант 1 [правильный]\nB) Вариант 2 [правильный]`;
  const result = parseQuiz(input);
  assertEqual(result.questions[0].type, 'multiple', 'Type multiple');
  assertEqual(result.questions[0].options.filter(o => o.correct).length, 2, 'Two correct options');
  assertEqual(result.questions[0].answer, ['Вариант 1', 'Вариант 2'], 'Answer array');
});

test('Clean whitespace handling', () => {
  const input = `  1.  Вопрос с пробелами  \n   A)  Вариант  \t  [correct]  \n   B)  Второй  `;
  const result = parseQuiz(input);
  assertEqual(result.questions.length, 1, 'Parsed');
  assertEqual(result.questions[0].text, 'Вопрос с пробелами', 'Trimmed text');
  assertEqual(result.questions[0].options.length, 2, 'Two options');
  assertEqual(result.questions[0].options[0].correct, true, 'First correct');
  assertEqual(result.questions[0].options[1].correct, false, 'Second not correct');
});

test('Cyrillic option markers (А,Б,В)', () => {
  const input = `1. Вопрос?\nА) Правильный [верный]\nB) Неправильный`;
  const result = parseQuiz(input);
  assertEqual(result.questions[0].options.length, 2, 'Two options');
  assertEqual(result.questions[0].options[0].correct, true, 'First correct');
});

test('Mixed punctuation for questions (1. 2)', () => {
  const input = `1. Вопрос 1?\nA) Вариант 1 [правильный]\nB) Вариант 2\n2) Вопрос 2?\nA) Вариант`;
  const result = parseQuiz(input);
  assertEqual(result.questions.length, 2, 'Two questions');
});

test('Empty lines and extra blank lines', () => {
  const input = `

1. Вопрос?
A) Вариант [correct]

2. Еще вопрос?
B) Вариант

`;
  const result = parseQuiz(input);
  assertEqual(result.questions.length, 2, 'Two questions');
  assertEqual(result.questions[0].options[0].correct, true, 'First correct');
  assertEqual(result.questions[1].options.length, 1, 'Second has one option');
});
