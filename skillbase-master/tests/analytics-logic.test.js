// tests/analytics-logic.test.js — чистая аналитика попыток.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnalytics, ANALYTICS_STATUSES, ANALYTICS_LIMIT, LOW_PERCENT_THRESHOLD
} from '../core/analytics-logic.js';

const KEYS = {
  '0': { type: 'single', points: 2, correct: [1] },
  '1': { type: 'multipledummy', points: 3, correct: [0, 2] },
  '2': { type: 'short', points: 5, answer: 'диспетчер' }
};
KEYS['1'].type = 'multiple';

function attempt(uid, opts = {}) {
  return {
    userId: uid,
    groupId: opts.groupId || 'g1',
    status: opts.status || 'submitted',
    score: opts.score ?? 4,
    total: opts.total ?? 10,
    answers: opts.answers || {},
    finishedAt: opts.finishedAt || new Date(2026, 0, 1, 12).getTime()
  };
}

test('buildAnalytics: процент верных по вопросам, пропуск — неверный', () => {
  const attempts = [
    attempt('a', { answers: { '0': 1, '1': [0, 2], '2': 'Диспетчер' } }),
    attempt('b', { answers: { '0': 1, '1': [0], '2': 'диспетчер' } })
  ];
  const data = buildAnalytics(attempts, KEYS);
  assert.equal(data.attemptsCount, 2);
  // №0: верны обе → 100%; №1: только первая → 50%; №2: обе → 100%.
  assert.deepEqual(data.perQuestion.map(q => q.percent), [100, 50, 100]);
  assert.deepEqual(data.lowQuestions, [], 'никто не ниже 40%');
});

test('buildAnalytics: вопросы ниже 40% попадают в список', () => {
  const attempts = [
    attempt('a', { answers: { '0': 0 } }), // неверно
    attempt('b', { answers: { '0': 0 } }),
    attempt('c', { answers: { '0': 1 } })  // одна верная из трёх = 33%
  ];
  const data = buildAnalytics(attempts, { '0': KEYS['0'] });
  assert.equal(data.lowQuestions.length, 1);
  assert.equal(data.lowQuestions[0].percent, 33);
  assert.equal(data.lowQuestions[0].low, true, 'порог ' + LOW_PERCENT_THRESHOLD + '%');
});

test('buildAnalytics: средний балл по группам', () => {
  const attempts = [
    attempt('a', { groupId: 'g1', answers: {}, score: 8, total: 10 }),
    attempt('b', { groupId: 'g1', answers: {}, score: 6, total: 10 }),
    attempt('c', { groupId: 'g2', answers: {}, status: 'graded', score: 4, total: 10 })
  ];
  const data = buildAnalytics(attempts, KEYS);
  const g1 = data.groups.find(g => g.groupId === 'g1');
  const g2 = data.groups.find(g => g.groupId === 'g2');
  assert.equal(g1.avgPercent, 70);
  assert.equal(g2.avgPercent, 40);
  assert.equal(data.groups[0].groupId, 'g1', 'сортировка от лучших');
});

test('buildAnalytics: in_progress не попадает в выборку', () => {
  const attempts = [
    attempt('a', { status: 'in_progress', answers: { '0': 1 } }),
    attempt('b', { answers: { '0': 1 } })
  ];
  const data = buildAnalytics(attempts, KEYS);
  assert.equal(data.attemptsCount, 1);
});

test('buildAnalytics: выборка ограничена последними N попытками', () => {
  const attempts = [];
  for (let i = 0; i < ANALYTICS_LIMIT + 5; i++) {
    attempts.push(attempt('u' + i, {
      answers: {},
      finishedAt: new Date(2026, 0, 1, 12, i).getTime()
    }));
  }
  const data = buildAnalytics(attempts, KEYS);
  assert.equal(data.attemptsCount, ANALYTICS_LIMIT);
});

test('buildAnalytics: expired попытки учитываются с неверными ответами', () => {
  const data = buildAnalytics(
    [attempt('x', { status: 'expired', answers: {} })],
    { '0': KEYS['0'] });
  assert.equal(data.attemptsCount, 1);
  assert.equal(data.perQuestion[0].percent, 0, 'пропуск — неверный');
});

test('аналитические статусы согласованы с попытками', () => {
  assert.deepEqual(ANALYTICS_STATUSES, ['submitted', 'graded', 'expired']);
});
