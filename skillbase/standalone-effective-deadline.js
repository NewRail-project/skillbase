function effectiveDeadline(qStartMs, attemptDeadlineMs, timePerQuestionSec) {
  if (!attemptDeadlineMs) return qStartMs + (timePerQuestionSec || 5) * 1000;
  if (!timePerQuestionSec) return attemptDeadlineMs;
  
  const qDeadline = qStartMs + timePerQuestionSec * 1000;
  return Math.min(qDeadline, attemptDeadlineMs);
}

// Тесты для effectiveDeadline

// Оба таймера
const qStartMs = 100000;
const attemptDeadlineMs = 110000;
const timePerQuestionSec = 5;
const result1 = effectiveDeadline(qStartMs, attemptDeadlineMs, timePerQuestionSec);
console.log('Оба таймера:', result1 === 105000 ? '✅ Проверено' : `❌ Ожидалось 105000, получено ${result1}`);

// Только таймер вопроса
const result2 = effectiveDeadline(qStartMs, null, timePerQuestionSec);
console.log('Только таймер вопроса:', result2 === 105000 ? '✅ Проверено' : `❌ Ожидалось 105000, получено ${result2}`);

// Ни одного таймера
const result3 = effectiveDeadline(qStartMs, null, null);
console.log('Ни одного таймера:', result3 === 105000 ? '✅ Проверено' : `❌ Ожидалось 105000, получено ${result3}`);