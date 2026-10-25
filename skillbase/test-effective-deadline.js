const { effectiveDeadline } = require('./core/editor.js');
const assert = require('assert');

// Тесты для effectiveDeadline

// Оба таймера
function testBothTimers() {
  const qStartMs = Date.now();
  const attemptDeadlineMs = qStartMs + 10000;
  const timePerQuestionSec = 5;
  const result = effectiveDeadline(qStartMs, attemptDeadlineMs, timePerQuestionSec);
  assert.strictEqual(result, attemptDeadlineMs, 'Оба таймера: min(qDeadline, attemptDeadlineMs)');
}

// Только таймер вопроса
function testOnlyQuestionTimer() {
  const qStartMs = Date.now();
  const attemptDeadlineMs = qStartMs + 15000;
  const timePerQuestionSec = 10;
  const result = effectiveDeadline(qStartMs, null, timePerQuestionSec);
  assert.strictEqual(result, qStartMs + 10000, 'Только таймер вопроса: qDeadline');
}

// Ни одного таймера
function testNoTimers() {
  const qStartMs = Date.now();
  const timePerQuestionSec = 5;
  const result = effectiveDeadline(qStartMs, null, null);
  assert.strictEqual(result, qStartMs + 5000, 'Ни одного таймера: qDeadline');
}

// Запуск тестов
console.log('Running effectiveDeadline tests...');
testBothTimers();
testOnlyQuestionTimer();
testNoTimers();

console.log('All effectiveDeadline tests passed successfully!');