// tests/live-components.test.js — чистая логика анимационных компонентов:
// подиум, дуэль, экспресс, кольцо таймера, смена места.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { podiumOrder, podiumLayout } from '../ui/components/podium.js';
import { duelRounds } from '../ui/components/duel.js';
import { expressStations, stationProgress } from '../ui/components/express.js';
import { ringFraction, isUrgent } from '../ui/components/ring-timer.js';
import { moveLabel } from '../ui/components/leaderboard.js';

test('подиум: поднимаются 3 → 2 → 1, колонки стоят 2 · 1 · 3', () => {
  assert.deepEqual(podiumOrder(3), [3, 2, 1]);
  assert.deepEqual(podiumOrder(2), [2, 1]);
  assert.deepEqual(podiumOrder(1), [1]);
  assert.deepEqual(podiumLayout(3), [2, 1, 3]);
  assert.deepEqual(podiumOrder(0), []);
});

test('кольцо таймера: доля остатка и последние 5 секунд', () => {
  assert.equal(ringFraction(30000, 15000), 0.5);
  assert.equal(ringFraction(30000, -5), 0);
  assert.equal(ringFraction(0, 100), 0);
  assert.equal(isUrgent(5000), true);
  assert.equal(isUrgent(5001), false);
  assert.equal(isUrgent(0), false, 'время вышло — уже не пульс');
  assert.equal(isUrgent(null), false);
});

test('значок смены места: ↑2 / ↓1', () => {
  assert.equal(moveLabel(2), '↑2');
  assert.equal(moveLabel(-1), '↓1');
  assert.equal(moveLabel(0), '');
});

test('дуэль: раунд выигрывает верный против неверного, иначе ничья', () => {
  const a = { verdicts: [{ qid: '0', verdict: true }, { qid: '1', verdict: true }, { qid: '2', verdict: false }] };
  const b = { verdicts: [{ qid: '0', verdict: true }, { qid: '1', verdict: false }, { qid: '2', verdict: null }] };
  const r = duelRounds(a, b);
  assert.deepEqual(r.rounds.map(x => x.winner), ['draw', 'a', 'draw']);
  assert.equal(r.winsA, 1);
  assert.equal(r.winsB, 0);
});

test('экспресс: станция на вопрос, процент верных по группе', () => {
  const rows = [
    { verdicts: [{ qid: '0', verdict: true }, { qid: '1', verdict: false }] },
    { verdicts: [{ qid: '0', verdict: false }, { qid: '1', verdict: null }] }
  ];
  const st = expressStations(rows);
  assert.equal(st.length, 2);
  assert.deepEqual([st[0].correct, st[0].total, st[0].percent], [1, 2, 50]);
  assert.deepEqual([st[1].correct, st[1].total, st[1].percent], [0, 1, 0]);
  assert.equal(stationProgress(0, 4), 0);
  assert.equal(stationProgress(3, 4), 1);
  assert.equal(stationProgress(0, 1), 1);
});
