const { effectiveDeadline } = require('./core/editor.js');
const assert = require('assert');

// Тесты для effectiveDeadline

// Оба таймера
function testBothTimers() {
  const qStartMs = Date.now();
  const attemptDeadlineMs = qStartMs + 10000;
  const timePerQuestionSec = 5;
  const result = effectiveDeadline(qStartMs, attemptDeadlineMs, timePerQuestionSec);
  assert.strictEqual(result, attemptDeadlineMs, 'Both timers: min(qDeadline, attemptDeadlineMs)');
}

// Только один таймер
function testOnlyQuestionTimer() {
  const qStartMs = Date.now();
  const attemptDeadlineMs = Date.now() + 15000;
  const timePerQuestionSec = 10;
  const result = effectiveDeadline(qStartMs, null, timePerQuestionSec);
  assert.strictEqual(result, qStartMs + 10000, 'Only question timer: qDeadline');
}

// Ни одного таймера
function testNoTimers() {
  const qStartMs = Date.now();
  const timePerQuestionSec = 5;
  const result = effectiveDeadline(qStartMs, null, null);
  assert.strictEqual(result, qStartMs + 5000, 'No timers: qDeadline');
}

// totalTime истёк раньше таймера вопроса
function testTotalTimeExpiredBeforeQuestion() {
  const qStartMs = Date.now();
  const attemptDeadlineMs = qStartMs + 10000;
  const timePerQuestionSec = 15;
  const result = effectiveDeadline(qStartMs, attemptDeadlineMs, timePerQuestionSec);
  assert.strictEqual(result, attemptDeadlineMs, 'Total time expired before question: min(qDeadline, attemptDeadlineMs)');
}

// totalTime больше, чем сумма времени на вопросы
function testTotalTimeGreaterThanQuestions() {
  const qStartMs = Date.now();
  const attemptDeadlineMs = qStartMs + 20000;
  const timePerQuestionSec = 3;
  const questions = 10;
  const result = effectiveDeadline(qStartMs, attemptDeadlineMs, timePerQuestionSec);
  assert.strictEqual(result, qStartMs + questions * timePerQuestionSec * 1000, 'Total time greater than questions');
}

// Запуск тестов
console.log('Running timing tests...');
testBothTimers();
testOnlyQuestionTimer();
testNoTimers();
testTotalTimeExpiredBeforeQuestion();
testTotalTimeGreaterThanQuestions();
console.log('All timing tests passed successfully!');