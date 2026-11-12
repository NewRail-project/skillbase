// tests/reactions.test.js — реакции: синхронность с firestore.rules,
// клиентский троттлинг, ЖД-пресеты.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  REACTIONS, RULES_REACTIONS, RAIL_REACTION_IDS, normalizeReaction,
  isRailReaction, canSendReaction, REACTION_COOLDOWN_MS
} from '../shared/reactions.js';

function rulesList() {
  const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const body = /function reactionsList\(\)\s*\{\s*return \[([^\]]*)\];/.exec(rules);
  assert.ok(body, 'reactionsList() найден в firestore.rules');
  return [...body[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
}

test('firestore.rules: reactionsList совпадает с RULES_REACTIONS', () => {
  assert.deepEqual([...rulesList()].sort(), [...RULES_REACTIONS].sort());
});

test('каждая реакция панели разрешена правилами (раньше 3 из 8 не проходили)', () => {
  const allowed = new Set(rulesList());
  for (const item of REACTIONS) assert.ok(allowed.has(item), `${item} не в правилах`);
});

test('ЖД-реакции: сигнал, гудок, колокол, звезда', () => {
  assert.deepEqual(RAIL_REACTION_IDS, ['signal', 'horn', 'bell', 'star']);
  assert.ok(isRailReaction('horn'));
  assert.ok(!isRailReaction('👍'));
  assert.equal(normalizeReaction('bell'), 'bell');
  assert.equal(normalizeReaction('hack'), null);
});

test('троттлинг: пауза больше секунды между реакциями', () => {
  assert.ok(REACTION_COOLDOWN_MS > 1000, 'правила требуют > 1 с');
  assert.equal(canSendReaction(undefined, 0), true);
  assert.equal(canSendReaction(1000, 1500), false);
  assert.equal(canSendReaction(1000, 1000 + REACTION_COOLDOWN_MS), true);
});
