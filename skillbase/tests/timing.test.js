import { test } from 'node:test';
import { effectiveDeadline } from '../core/editor.js';

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    console.error(`FAIL: ${message}`);
    console.log('Expected:', expected);
    console.log('Actual:', actual);
    process.exit(1);
  }
}

// Тесты для effectiveDeadline

// Оба таймера
function testBothTimers() {
  const qStartMs = Date.now();
  const attemptDeadlineMs = qStartMs + 10000;
  const timePerQuestionSec = 5;
  const result = effectiveDeadline(qStartMs, attemptDeadlineMs, timePerQuestionSec);
  assertEqual(result, attemptDeadlineMs, 'Both timers: min(qDeadline, attemptDeadlineMs)');
}

// Только один таймер
function testOnlyQuestionTimer() {
  const qStartMs = Date.now();
  const attemptDeadlineMs = Date.now() + 15000;
  const timePerQuestionSec = 10;
  const result = effectiveDeadline(qStartMs, null, timePerQuestionSec);
  assertEqual(result, qStartMs + 10000, 'Only question timer: qDeadline');
}

// Ни одного таймера
function testNoTimers() {
  const qStartMs = Date.now();
  const timePerQuestionSec = 5;
  const result = effectiveDeadline(qStartMs, null, null);
  assertEqual(result, qStartMs + 5000, 'No timers: qDeadline');
}

// totalTime истёк раньше таймера вопроса
function testTotalTimeExpiredBeforeQuestion() {
  const qStartMs = Date.now();
  const attemptDeadlineMs = qStartMs + 10000;
  const timePerQuestionSec = 15;
  const result = effectiveDeadline(qStartMs, attemptDeadlineMs, timePerQuestionSec);
  assertEqual(result, attemptDeadlineMs, 'Total time expired before question: min(qDeadline, attemptDeadlineMs)');
}

// totalTime больше, чем сумма времени на вопросы
function testTotalTimeGreaterThanQuestions() {
  const qStartMs = Date.now();
  const attemptDeadlineMs = qStartMs + 20000;
  const timePerQuestionSec = 3;
  const questions = 10;
  const result = effectiveDeadline(qStartMs, attemptDeadlineMs, timePerQuestionSec);
  assertEqual(result, qStartMs + questions * timePerQuestionSec * 1000, 'Total time greater than questions');
}

// Тесты запускаются

// Оба таймера
test('Both timers', () => {
  const qStartMs = Date.now();
  const attemptDeadlineMs = qStartMs + 10000;
  const timePerQuestionSec = 5;
  const result = effectiveDeadline(qStartMs, attemptDeadlineMs, timePerQuestionSec);
  assertEqual(result, attemptDeadlineMs, 'Both timers');
});

// Только один таймер
test('Only question timer', () => {
  const qStartMs = Date.now();
  const attemptDeadlineMs = Date.now() + 15000;
  const timePerQuestionSec = 10;
  const result = effectiveDeadline(qStartMs, null, timePerQuestionSec);
  assertEqual(result, qStartMs + 10000, 'Only question timer');
});

// Ни одного таймера
test('No timers', () => {
  const qStartMs = Date.now();
  const timePerQuestionSec = 5;
  const result = effectiveDeadline(qStartMs, null, null);
  assertEqual(result, qStartMs + 5000, 'No timers');
});

// totalTime истёк раньше таймера вопроса
test('Total time expired before question', () => {
  const qStartMs = Date.now();
  const attemptDeadlineMs = qStartMs + 10000;
  const timePerQuestionSec = 15;
  const result = effectiveDeadline(qStartMs, attemptDeadlineMs, timePerQuestionSec);
  assertEqual(result, attemptDeadlineMs, 'Total time expired before question');
});

// totalTime больше, чем сумма времени на вопросы
test('Total time greater than questions', () => {
  const qStartMs = Date.now();
  const attemptDeadlineMs = qStartMs + 20000;
  const timePerQuestionSec = 3;
  const questions = 10;
  const result = effectiveDeadline(qStartMs, attemptDeadlineMs, timePerQuestionSec);
  assertEqual(result, qStartMs + questions * timePerQuestionSec * 1000, 'Total time greater than questions');
});