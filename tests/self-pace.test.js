// tests/self-pace.test.js — режим «каждый в своём темпе», вердикты, админ-участник.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PACE_SELF, PACE_SYNC, paceOf, isSelfPaced, selfPlan, selfProgress, selfShowAllowed,
  selfAnswerAllowed, selfScoringState, computeSelfScores, verdictMapFromResults,
  changedVerdicts, liveVerdicts, roomLifecycle, buildAutoSettings, ratingRows,
  resolveRequestedRole
} from '../core/live-auto.js';
import { verdictFromDoc, joinPlayerFields } from '../core/rooms-logic.js';
import { questionDurationSec } from '../core/rooms-logic.js';

const room = { mode: 'auto', pace: 'self', settings: { pace: 'self' }, questionCount: 3, questionSec: 10, liveState: 'in_progress' };
const plan = selfPlan(room);
const keys = [
  { type: 'single', correct: [1], points: 10 },
  { type: 'single', correct: [0], points: 10 },
  { type: 'single', correct: [2], points: 10 }
];

test('paceOf/isSelfPaced: по умолчанию синхронно; self только в автономной комнате', () => {
  assert.equal(paceOf({}), PACE_SYNC);
  assert.equal(paceOf({ settings: { pace: 'self' } }), PACE_SELF);
  assert.equal(isSelfPaced(room), true);
  assert.equal(isSelfPaced({ mode: 'manual', pace: 'self' }), false);
});

test('buildAutoSettings: self включает мгновенный вердикт', () => {
  const t = { questions: [{}, {}], settings: {} };
  const self = buildAutoSettings({ test: t, options: { pace: 'self' } });
  assert.equal(self.pace, 'self'); assert.equal(self.instantVerdict, true);
  const sync = buildAutoSettings({ test: t, options: {} });
  assert.equal(sync.pace, 'sync'); assert.equal(sync.instantVerdict, false);
});

test('selfProgress: лента идёт по личным меткам, а не по общему старту', () => {
  let p = selfProgress({ plan, shown: {}, answers: {}, nowMs: 1000 });
  assert.deepEqual([p.position, p.needsShow], [0, true]);
  p = selfProgress({ plan, shown: { 0: 1000 }, answers: {}, nowMs: 4000 });
  assert.deepEqual([p.position, p.needsShow, p.msLeft], [0, false, 7000]);
  // ответил — сразу следующий (ещё не показан)
  p = selfProgress({ plan, shown: { 0: 1000 }, answers: { 0: 1 }, nowMs: 4000 });
  assert.deepEqual([p.position, p.needsShow], [1, true]);
  // время вышло — тоже следующий
  p = selfProgress({ plan, shown: { 0: 1000 }, answers: {}, nowMs: 11000 });
  assert.equal(p.position, 1);
  // все закончены
  p = selfProgress({ plan, shown: { 0: 0, 1: 0, 2: 0 }, answers: { 0: 1 }, nowMs: 99999 });
  assert.equal(p.done, true);
});

test('selfShowAllowed: нельзя перепрыгнуть вопрос и показать дважды', () => {
  assert.equal(selfShowAllowed({ plan, requestMs: 0, position: 0 }), true);
  assert.equal(selfShowAllowed({ plan, shown: { 0: 0 }, requestMs: 5000, position: 1 }), false);
  assert.equal(selfShowAllowed({ plan, shown: { 0: 0 }, answers: { 0: 1 }, requestMs: 5000, position: 1 }), true);
  assert.equal(selfShowAllowed({ plan, shown: { 0: 0 }, requestMs: 10000, position: 1 }), true);
  assert.equal(selfShowAllowed({ plan, shown: { 0: 0 }, requestMs: 10000, position: 0 }), false);
  assert.equal(selfShowAllowed({ plan, shown: { 0: 0 }, answers: { 0: 1 }, requestMs: 1, position: 2 }), false);
});

test('selfAnswerAllowed: окно = личное время + допуск 1 с', () => {
  assert.equal(selfAnswerAllowed({ plan, shown: { 0: 0 }, requestMs: 10500, position: 0 }), true);
  assert.equal(selfAnswerAllowed({ plan, shown: { 0: 0 }, requestMs: 11500, position: 0 }), false);
  assert.equal(selfAnswerAllowed({ plan, shown: {}, requestMs: 1, position: 0 }), false);
});

test('computeSelfScores: очки, серия и скорость по личной ленте; пропуск обнуляет серию', () => {
  const fast = { uid: 'a', name: 'А', answers: { 0: 1, 1: 0 }, shown: { 0: 0, 1: 2000 }, times: { 0: 1000, 1: 3000 } };
  const slow = { uid: 'b', name: 'Б', answers: { 0: 0 }, shown: { 0: 500 }, times: { 0: 9500 } };
  const rows = computeSelfScores({ players: [slow, fast], keysByPos: keys, plan, nowMs: 5000 });
  assert.equal(rows[0].uid, 'a');
  assert.ok(rows[0].score > 20, 'серия и скорость дают бонус');
  assert.equal(rows[0].correctCount, 2);
  assert.equal(rows[1].correctCount, 0);
  assert.equal(rows[0].done, false);
  const final = computeSelfScores({ players: [fast], keysByPos: keys, plan, nowMs: 99999, finalize: true });
  assert.equal(final[0].done, true);
  assert.equal(final[0].finished, 3);
});

test('selfScoringState: неотвеченный незаконченный вопрос останавливает подсчёт', () => {
  const st = selfScoringState({ plan, shown: { 0: 0 }, answers: {}, nowMs: 5000 });
  assert.deepEqual(st.positions, []);
  const expired = selfScoringState({ plan, shown: { 0: 0 }, answers: {}, nowMs: 20000 });
  assert.deepEqual(expired.positions, [0]);
});

test('вердикты: только отвеченные вопросы, без ключа; changedVerdicts экономит записи', () => {
  const p = { uid: 'a', name: 'А', answers: { 0: 1, 1: 2 }, shown: { 0: 0, 1: 0 } };
  const [row] = computeSelfScores({ players: [p], keysByPos: keys, plan, nowMs: 3000 });
  const map = verdictMapFromResults(row.results);
  assert.equal(map['0'].c, true);
  assert.equal(map['1'].c, false);
  assert.ok(!JSON.stringify(map).includes('correct'));
  assert.deepEqual(changedVerdicts({ a: map }, { a: map }), {});
  assert.deepEqual(Object.keys(changedVerdicts({}, { a: map })), ['a']);
  assert.deepEqual(verdictFromDoc({ v: map }, 0), { verdict: true, points: map['0'].p });
  assert.deepEqual(verdictFromDoc(null, 0), { verdict: null, points: 0 });
});

test('liveVerdicts: мгновенный вердикт в синхронном режиме по уже данным ответам', () => {
  const out = liveVerdicts({ players: [{ uid: 'a', answers: { 0: 1 } }, { uid: 'b', answers: {} }], keysByPos: keys });
  assert.deepEqual(Object.keys(out), ['a']);
  assert.equal(out.a['0'].c, true);
});

test('roomLifecycle для self не зависит от общего расписания', () => {
  assert.equal(roomLifecycle({ ...room, liveState: 'waiting' }, 0), 'waiting');
  assert.equal(roomLifecycle(room, 9e12), 'in_progress');
  assert.equal(roomLifecycle({ ...room, liveState: 'completed' }, 0), 'completed');
});

test('админ-участник: скрыт из рейтинга для всех, кроме себя', () => {
  const players = [
    { uid: 'u1', name: 'Иван' },
    { uid: 'adm', name: 'Админ', isAdminPlayer: true }
  ];
  const scores = [{ uid: 'u1', score: 5 }, { uid: 'adm', score: 50, isAdminPlayer: true }];
  const others = ratingRows({ scores, players, viewerUid: 'u1' });
  assert.deepEqual(others.map(r => r.uid), ['u1']);
  const admin = ratingRows({ scores, players, viewerUid: 'adm' });
  assert.equal(admin.length, 2);
  assert.equal(admin[0].isAdminPlayer, true);
});

test('роль: администратор может быть участником, преподаватель — нет', () => {
  assert.equal(resolveRequestedRole({ requested: 'player', isStaffUser: true }), 'observer');
  assert.equal(resolveRequestedRole({ requested: 'player', isStaffUser: true, isAdminUser: true }), 'player');
});

test('joinPlayerFields: groupId и isAdminPlayer только у участника', () => {
  const f = joinPlayerFields(null, { uid: 'a', name: 'А', role: 'player', groupId: 'g1', isAdminPlayer: true });
  assert.equal(f.groupId, 'g1'); assert.equal(f.isAdminPlayer, true);
  const o = joinPlayerFields(null, { uid: 'a', name: 'А', observer: true, role: 'observer', groupId: 'g1', isAdminPlayer: true });
  assert.ok(!('groupId' in o) && !('isAdminPlayer' in o));
});

test('questionDurationSec: room.settings = { pace } не отключает лимит теста', () => {
  const t = { questions: [{}, {}], settings: { timePerQuestion: 20 } };
  assert.equal(questionDurationSec(t, { pace: 'sync' }), 20);
  assert.equal(questionDurationSec(t, { timePerQuestion: 7 }), 7);
});
