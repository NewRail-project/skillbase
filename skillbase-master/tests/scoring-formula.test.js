// tests/scoring-formula.test.js — единая формула очков и граничные случаи:
// пропуск, ответ в последнюю секунду, ничья, серия и её значок.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreBreakdown, answerPoints, formatBreakdown, streakTier,
  assignPlaces, streakFromReveals, computeScores, speedRatio
} from '../core/rooms-logic.js';

const KEYS = {
  0: { type: 'single', points: 10, correct: [0] },
  1: { type: 'single', points: 10, correct: [0] },
  2: { type: 'single', points: 10, correct: [0] }
};

test('scoreBreakdown: база + серия + скорость всегда равны итогу', () => {
  for (const streak of [0, 1, 2, 3, 5, 9]) {
    for (const speed of [0, 0.1, 0.25, 0.5]) {
      const b = scoreBreakdown(10, { streak, speed });
      assert.equal(b.base + b.streakBonus + b.speedBonus, b.total);
      assert.equal(b.total, answerPoints(10, { streak, speed }));
    }
  }
});

test('formatBreakdown: пример из задачи «Верно: 10 · Серия ×1.2 · Скорость +4 = 16 б.»', () => {
  // база 10, серия 2 (×1.2 = +2), скорость 0.4 (+4) → 16.
  const breakdown = scoreBreakdown(10, { streak: 2, speed: 0.4 });
  assert.equal(breakdown.total, 16);
  assert.equal(
    formatBreakdown({ answered: true, correct: true, breakdown }),
    'Верно: 10 · Серия ×1.2 · Скорость +4 = 16 б.'
  );
});

test('formatBreakdown: нулевые бонусы скрыты, пропуск и ошибка — 0 б.', () => {
  const plain = scoreBreakdown(5, { streak: 0, speed: 0 });
  assert.equal(formatBreakdown({ answered: true, correct: true, breakdown: plain }), 'Верно: 5 = 5 б.');
  assert.equal(formatBreakdown({ answered: false }), 'Пропуск · 0 б.');
  assert.equal(formatBreakdown({ answered: true, correct: false }), 'Неверно · 0 б.');
});

test('граница: пропуск обнуляет серию и даёт 0', () => {
  const players = [{ uid: 'a', name: 'А', answers: { 0: 0, 2: 0 } }]; // вопрос 1 пропущен
  const [row] = computeScores(players, KEYS, [0, 1, 2]);
  assert.equal(row.results[1].answered, false);
  assert.equal(row.results[1].points, 0);
  // 10 (серия 1 → ×1.1 = 11) + 0 + 10 (серия снова 1 → 11) = 22.
  assert.equal(row.score, 22);
  assert.equal(row.streak, 1);
  assert.equal(row.bestStreak, 1);
});

test('граница: ответ в последнюю секунду почти без бонуса, после — без бонуса', () => {
  assert.ok(speedRatio(30, 29_999) > 0 && speedRatio(30, 29_999) < 0.001);
  assert.equal(speedRatio(30, 30_000), 0);
  assert.equal(speedRatio(30, 31_000), 0);
  assert.equal(scoreBreakdown(10, { streak: 0, speed: speedRatio(30, 29_999) }).total, 10);
  // Мгновенный ответ — максимум +50%.
  assert.equal(scoreBreakdown(10, { speed: speedRatio(30, 0) }).total, 15);
});

test('граница: серия ограничена +50%', () => {
  assert.equal(scoreBreakdown(10, { streak: 50 }).streakMult, 1.5);
  assert.equal(scoreBreakdown(10, { streak: 50 }).total, 15);
});

test('ничья: равные очки и верные делят место (1, 1, 3), порядок стабилен', () => {
  const rows = [
    { uid: 'a', name: 'Анна', score: 20, correctCount: 2 },
    { uid: 'b', name: 'Борис', score: 20, correctCount: 2 },
    { uid: 'c', name: 'Вера', score: 10, correctCount: 1 }
  ];
  assignPlaces(rows);
  assert.deepEqual(rows.map(r => r.place), [1, 1, 3]);
});

test('ничья по очкам, но разные верные ответы — места разные', () => {
  const rows = [
    { score: 20, correctCount: 3 },
    { score: 20, correctCount: 2 }
  ];
  assignPlaces(rows);
  assert.deepEqual(rows.map(r => r.place), [1, 2]);
});

test('computeScores: при равных очках выше тот, у кого больше верных, затем по алфавиту', () => {
  const keys = { 0: { type: 'single', points: 4, correct: [0] }, 1: { type: 'single', points: 1, correct: [0] } };
  const players = [
    { uid: 'z', name: 'Яков', answers: { 0: 0 } },          // 4 б., 1 верный
    { uid: 'y', name: 'Аркадий', answers: { 0: 0 } },       // 4 б., 1 верный
    { uid: 'x', name: 'Борис', answers: { 0: 1, 1: 0 } }    // 1 б.
  ];
  const board = computeScores(players, keys, [0, 1]);
  assert.deepEqual(board.map(r => r.uid), ['y', 'z', 'x']);
});

test('streakTier: огонь с 3, молния с 5', () => {
  assert.equal(streakTier(0), 'none');
  assert.equal(streakTier(2), 'none');
  assert.equal(streakTier(3), 'fire');
  assert.equal(streakTier(4), 'fire');
  assert.equal(streakTier(5), 'bolt');
  assert.equal(streakTier(12), 'bolt');
  assert.equal(streakTier(NaN), 'none');
});

test('streakFromReveals: серия по раскрытым вопросам, ошибка и пропуск обрывают', () => {
  const reveals = {};
  for (const q of ['0', '1', '2', '3', '4']) reveals[q] = { reveal: { type: 'single', correct: [0] } };
  const player = { answers: { 0: 0, 1: 0, 2: 1, 3: 0, 4: 0 } };
  const r = streakFromReveals(player, reveals, ['0', '1', '2', '3', '4']);
  assert.equal(r.streak, 2);
  assert.equal(r.bestStreak, 2);
  const skipped = streakFromReveals({ answers: { 0: 0, 1: 0 } }, reveals, ['0', '1', '2']);
  assert.equal(skipped.streak, 0, 'пропуск последнего сбрасывает серию');
  assert.equal(skipped.bestStreak, 2);
});

import { streakEvent } from '../core/rooms-logic.js';

test('streakEvent: вспышка при росте, гашение при обрыве, смена уровня', () => {
  assert.equal(streakEvent(0, 1), 'hit');
  assert.equal(streakEvent(2, 3), 'tier', 'огонь зажёгся');
  assert.equal(streakEvent(3, 4), 'hit');
  assert.equal(streakEvent(4, 5), 'tier', 'огонь → молния');
  assert.equal(streakEvent(5, 6), 'hit');
  assert.equal(streakEvent(4, 0), 'break', 'огонь погас');
  assert.equal(streakEvent(7, 0), 'break', 'молния погасла');
  assert.equal(streakEvent(2, 0), 'lost', 'малая серия просто исчезает');
  assert.equal(streakEvent(3, 3), 'same');
  assert.equal(streakEvent(undefined, undefined), 'same');
});

import { trailFromResults, verdictsFromTrail, streakFromTrail } from '../core/rooms-logic.js';
import { changedScores, ratingRows } from '../core/live-auto.js';

test('trail: дорожка ответов 1/0/- и серия из неё совпадают с computeScores', () => {
  const players = [{ uid: 'a', name: 'А', answers: { 0: 0, 1: 0, 2: 1 } }]; // 3-й вопрос неверный, 4-й пропущен
  const keys = { ...KEYS, 3: { type: 'single', points: 10, correct: [0] } };
  const [row] = computeScores(players, keys, [0, 1, 2, 3]);
  assert.equal(row.trail, '110-');
  assert.deepEqual(streakFromTrail(row.trail), { streak: 0, bestStreak: 2 });
  assert.deepEqual(verdictsFromTrail('10-').map(v => v.verdict), [true, false, null]);
  assert.equal(trailFromResults([]), '');
});

test('changedScores: смена серии или дорожки — повод переписать документ', () => {
  const old = [{ uid: 'a', name: 'А', score: 5, max: 10, correctCount: 1, answered: 1, finished: 1, streak: 1, trail: '1' }];
  const same = [{ ...old[0] }];
  assert.equal(changedScores(old, same).length, 0);
  assert.equal(changedScores(old, [{ ...old[0], streak: 2, trail: '11' }]).length, 1);
});

test('ratingRows: серия и дорожка доходят до карточек рейтинга', () => {
  const rows = ratingRows({
    scores: [{ uid: 'a', name: 'А', score: 5, max: 10, correctCount: 1, streak: 4, trail: '1111' }],
    players: [{ uid: 'a', name: 'А' }], questionCount: 4, finished: 4, lifecycle: 'in_progress'
  });
  assert.equal(rows[0].streak, 4);
  assert.equal(rows[0].trail, '1111');
});
