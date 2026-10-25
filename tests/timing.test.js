import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveDeadline, isDeadlinePassed } from '../core/timing.js';

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
