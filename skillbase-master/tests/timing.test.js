import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attemptDeadlineMs, effectiveDeadline, isDeadlinePassed } from '../core/timing.js';

test('attemptDeadlineMs: нет лимита', () => {
  assert.equal(
    attemptDeadlineMs({ startedMs: 1_000_000, limitSeconds: null, storedMs: null, assignedMs: null }),
    null
  );
  assert.equal(
    attemptDeadlineMs({ startedMs: 1_000_000, limitSeconds: 0 }),
    null
  );
});

test('attemptDeadlineMs: лимит на тест', () => {
  const started = 1_000_000;
  assert.equal(
    attemptDeadlineMs({ startedMs: started, limitSeconds: 60 }),
    started + 60_000
  );
});

test('attemptDeadlineMs: лимит на вопрос', () => {
  const started = 1_000_000;
  // Например, 10 вопросов по 15 секунд = 150 секунд всего
  const questionLimitSec = 10 * 15;
  assert.equal(
    attemptDeadlineMs({ startedMs: started, limitSeconds: questionLimitSec }),
    started + 150_000
  );
});

test('attemptDeadlineMs: срок задания раньше лимита', () => {
  const started = 1_000_000;
  const assigned = started + 30_000; // срок задания через 30 с
  const testLimit = 120; // лимит на тест 120 с (120_000 мс)
  assert.equal(
    attemptDeadlineMs({ startedMs: started, limitSeconds: testLimit, assignedMs: assigned }),
    assigned,
    'должен быть выбран ранний срок задания'
  );
});

test('attemptDeadlineMs: срок в прошлом', () => {
  const started = 1_000_000;
  const pastAssigned = 500_000; // срок уже истёк до начала
  assert.equal(
    attemptDeadlineMs({ startedMs: started, limitSeconds: 60, assignedMs: pastAssigned }),
    pastAssigned
  );
});

// effectiveDeadline(qStartMs, attemptDeadlineMs, timePerQuestionSec)
// Возвращает ближайший из двух дедлайнов.

test('оба таймера: вопрос истекает раньше попытки', () => {
  const qStart = 1_000_000;
  const attemptDeadline = qStart + 10_000;
  assert.equal(
    effectiveDeadline(qStart, attemptDeadline, 5),
    qStart + 5_000,
    'должен выбираться дедлайн вопроса'
  );
});

test('оба таймера: попытка истекает раньше вопроса', () => {
  const qStart = 1_000_000;
  const attemptDeadline = qStart + 4_000;
  assert.equal(
    effectiveDeadline(qStart, attemptDeadline, 15),
    attemptDeadline,
    'должен выбираться дедлайн попытки'
  );
});

test('только таймер вопроса', () => {
  const qStart = 1_000_000;
  assert.equal(effectiveDeadline(qStart, null, 10), qStart + 10_000);
});

test('только общий таймер попытки', () => {
  const qStart = 1_000_000;
  const attemptDeadline = qStart + 20_000;
  assert.equal(effectiveDeadline(qStart, attemptDeadline, null), attemptDeadline);
});

test('таймеров нет — используется значение по умолчанию 5 секунд', () => {
  const qStart = 1_000_000;
  assert.equal(effectiveDeadline(qStart, null, null), qStart + 5_000);
});

test('нулевые значения таймеров трактуются как отсутствие ограничения', () => {
  const qStart = 1_000_000;
  assert.equal(effectiveDeadline(qStart, 0, 0), qStart + 5_000);
});

test('isDeadlinePassed проверяет срок в момент вызова', () => {
  const now = 1_000_000;
  assert.equal(isDeadlinePassed(null, now), false);
  assert.equal(isDeadlinePassed(new Date(now + 1), now), false);
  assert.equal(isDeadlinePassed(new Date(now), now), true);
  assert.equal(isDeadlinePassed(new Date(now - 1), now), true);
  assert.equal(isDeadlinePassed({ seconds: Math.floor(now / 1000) - 1 }, now), true);
  assert.equal(isDeadlinePassed({ toMillis: () => now + 5_000 }, now), false);
});
