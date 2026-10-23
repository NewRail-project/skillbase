import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveDeadline } from '../core/timing.js';

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
