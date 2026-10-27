// tests/rooms-scoring.test.js — очки Live-комнат: база, серия
// (+10% до макс +50%), бонус за скорость (до +50% по оставшемуся
// серверному времени) и идемпотентный пересчёт computeScores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  streakRatio, speedRatio, answerPoints,
  computeScores, normalizePlayerTimes
} from '../core/rooms-logic.js';

const KEY1 = { type: 'single', points: 2, correct: [1] };

test('streakRatio: +10% за верный ответ подряд, максимум +50%', () => {
  assert.equal(streakRatio(0), 0);
  assert.equal(Math.round(streakRatio(1) * 100), 10);
  assert.equal(Math.round(streakRatio(2) * 100), 20);
  assert.equal(Math.round(streakRatio(5) * 100), 50);
  assert.equal(streakRatio(7), 0.5, 'выше 5 подряд — всё ещё 50%');
  assert.equal(streakRatio(-3), 0);
});

test('speedRatio: до +50%, линейно по оставшемуся времени', () => {
  // 60 секунд: мгновенный ответ — все 50% бонуса.
  assert.equal(Math.round(speedRatio(60, 0) * 1000) / 1000, 0.5);
  // Половина времени потрачена — 25% бонуса.
  assert.equal(speedRatio(60, 30_000), 0.25);
  // Ответ позже длительности: бонус 0.
  assert.equal(speedRatio(60, 61_000), 0);
  // Комната без qDurationSec: бонуса нет.
  assert.equal(speedRatio(null, 0), 0);
  assert.equal(speedRatio(0, 0), 0);
  // Метки нет: без бонуса.
  assert.equal(speedRatio(60, null), 0);
});

test('answerPoints: база домножается на бонусы и округляется', () => {
  // base 3, первая серия (10%), без скорости → 3.3 → 3.
  assert.equal(answerPoints(3, { streak: 1, speed: 0 }), 3);
  // base 4, третья подряд серия 30% → 5.2 → 5.
  assert.equal(answerPoints(4, { streak: 3, speed: 0 }), 5);
  // base 2, мгновенный ответ на 60-секундном вопросе: +50% → 3.
  assert.equal(answerPoints(2, { streak: 0, speed: 0.5 }), 3);
  // Максимум вместе: серия 50% + скорость 50% = удвоение базы.
  assert.equal(answerPoints(10, { streak: 5, speed: 0.5 }), 20);
});

const KEYS = {
  '0': { type: 'single', points: 2, correct: [1] },
  '1': { type: 'single', points: 4, correct: [0] },
  '2': { type: 'single', points: 6, correct: [2] }
};

// Скорость выключена: время ответа позже длительности вопроса.
function noSpeedOpts() {
  return {
    qDurationSec: 20,
    qStarts: { '0': 1000, '1': 11_000, '2': 21_000 }
  };
}

function playerTimes({ base = 0, offsetSec = 20 } = {}) {
  // times[qid] = qStarts[qid] + offset (сек) — при offset ≥ длительности
  // бонус за скорость нулевой.
  const times = {};
  Object.keys(noSpeedOpts().qStarts).forEach(qid => {
    times[qid] = noSpeedOpts().qStarts[qid] + (Number(qid) * 10_000) + offsetSec * 1000;
  });
  return times;
}

test('computeScores: серия растёт на верных подряд и сбрасывается', () => {
  const player = {
    uid: 'u1', name: 'Аня', observer: false,
    answers: { '0': 1, '1': 0, '2': 0 }, // 0 и 1 верно, 2 неверно
    times: playerTimes()
  };
  const board = computeScores([player], KEYS, [0, 1, 2], noSpeedOpts());
  // №0: 2×1.1 = 2.2 → 2; №1: 4×1.2 = 4.8 → 5; №2 неверно: 0.
  assert.equal(board[0].score, 7);
  assert.equal(board[0].correctCount, 2);
  // Идемпотентность: пересчёт с нуля — тот же итог.
  const again = computeScores([player], KEYS, [0, 1, 2], noSpeedOpts());
  assert.equal(again[0].score, board[0].score);
});

test('computeScores: серия капается на 50% (5 и более подряд)', () => {
  const manyKeys = {};
  const answers = {};
  const times = {};
  const qStarts = {};
  for (let i = 0; i < 7; i++) {
    manyKeys[String(i)] = { type: 'single', points: 1, correct: [0] };
    answers[String(i)] = 0;
    qStarts[String(i)] = i * 10_000 + 1000;
    times[String(i)] = i * 10_000 + 1000 + 60_000; // скорость = 0
  }
  const player = { uid: 'u1', name: 'Боря', observer: false, answers, times };
  const board = computeScores([player], manyKeys, [0, 1, 2, 3, 4, 5, 6],
    { qDurationSec: 20, qStarts });
  // Множители 1.1, 1.2, 1.3, 1.4 → 1,1,1,1; с 5-го подряд — 1.5 → 2; далее 2.
  assert.equal(board[0].score, 1 + 1 + 1 + 1 + 2 + 2 + 2);
  assert.equal(board[0].max, 7);
});

test('computeScores: пропуск и неверно сбрасывают серию', () => {
  const player = {
    uid: 'u1', name: 'Витя', observer: false,
    // 0 верно, 1 пропуск, 2 снова верно: у второго верного серия снова 1.
    answers: { '0': 1, '2': 2 },
    times: playerTimes()
  };
  const board = computeScores([player], KEYS, [0, 1, 2], noSpeedOpts());
  // №0: 2×1.1 → 2; №1 пропуск → серия 0; №2: 6×1.1 = 6.6 → 7.
  assert.equal(board[0].score, 9);
  assert.equal(board[0].correctCount, 2);
});

test('computeScores: бонус за скорость считается по серверным меткам', () => {
  const player = {
    uid: 'u1', name: 'Даша', observer: false,
    answers: { '0': 1 },
    times: { '0': 6000 } // 5 секунд после старта (qStarts 1000)
  };
  const board = computeScores([player], KEYS, [0], { qDurationSec: 20, qStarts: { '0': 1000 } });
  // Пятнадцать из 20 секунд в запасе → +37.5%; серия +10%.
  // 2 × (1 + 0.1 + 0.375) = 2.95 → 3.
  assert.equal(board[0].score, 3);
});

test('computeScores: без ограниченного времени скорость не начисляется', () => {
  const player = { uid: 'u1', name: 'Аня', observer: false, answers: { '0': 1 }, times: { '0': 2000 } };
  const optsNoDur = { qDurationSec: null, qStarts: { '0': 1 } };
  const board = computeScores([player], KEYS, [0].map(Number), optsNoDur);
  assert.equal(board[0].score, 2); // 2 × 1.1 (серия) → 2, скорости нет
  // Тот же итог — тот же счёт (идемпотентность при наличии opts).
  const again = computeScores([player], KEYS, [0], optsNoDur);
  assert.equal(again[0].score, board[0].score);
});

test('computeScores: идемпотентен на любом порядке входных данных', () => {
  const p1 = { uid: 'a', name: 'Аня', observer: false, answers: { '0': 1, '1': 0 }, times: playerTimes() };
  const p2 = { uid: 'b', name: 'Боря', observer: false, answers: { '0': 2, '1': 0 }, times: {} };
  for (const opts of [null, noSpeedOpts()]) {
    const first = computeScores([p1, p2], KEYS, [0, 1], opts);
    const second = computeScores([p2, p1], KEYS, [0, 1], opts);
    assert.deepEqual(
      first.map(row => [row.uid, row.score]),
      second.map(row => [row.uid, row.score]));
  }
});

test('normalizePlayerTimes: Timestamp → мс, мусор → null', () => {
  const fixed = normalizePlayerTimes({
    uid: 'x', times: { '0': { toMillis: () => 5000 }, '1': 7, '2': 'мусор' }
  });
  assert.equal(fixed.times['0'], 5000);
  assert.equal(fixed.times['1'], 7);
  assert.equal(fixed.times['2'], null);
});
