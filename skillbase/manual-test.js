const { effectiveDeadline } = require('./core/editor.js');

// Тесты для effectiveDeadline

// Оба таймера
const qStartMs = Date.now();
const attemptDeadlineMs = qStartMs + 10000;
const timePerQuestionSec = 5;
const result1 = effectiveDeadline(qStartMs, attemptDeadlineMs, timePerQuestionSec);
console.log('Оба таймера:', result1 === attemptDeadlineMs ? '✅ Проверено' : '❌ Не проверено');

// Только таймер вопроса
const result2 = effectiveDeadline(qStartMs, null, timePerQuestionSec);
console.log('Только таймер вопроса:', result2 === qStartMs + 10000 ? '✅ Проверено' : '❌ Не проверено');

// Ни одного таймера
const result3 = effectiveDeadline(qStartMs, null, null);
console.log('Ни одного таймера:', result3 === qStartMs + 5000 ? '✅ Проверено' : '❌ Не проверено');

