// tests/duel-bank-late.test.js — банк вопросов для ничьей за 1-е место,
// подготовленный ПОСЛЕ того, как группа ничьей уже создана.
// Раньше такая группа навсегда оставалась без банка и дуэль молча шла
// по вопросам теста.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDuelsDoc, duelGroupsChanged, openDuelRound, groupBank } from "../core/duel-logic.js";

const rows = [
  { uid: "a", name: "A", place: 1, score: 5, correctCount: 5 },
  { uid: "b", name: "B", place: 1, score: 5, correctCount: 5 },
  { uid: "c", name: "C", place: 3, score: 2, correctCount: 2 },
];

test("банк подготовлен после создания группы — дописывается не начатой группе", () => {
  const first = buildDuelsDoc({ rows, questionCount: 5, banks: null });
  assert.equal(first.groups[0].bank, undefined, "сначала банка нет");
  assert.equal(duelGroupsChanged(first, [{ members: rows.slice(0, 2) }], { 1: ["t1:0", "t1:1"] }), true);
  const next = buildDuelsDoc({ rows, existing: first, questionCount: 5, banks: { 1: ["t1:0", "t1:1"] } });
  assert.deepEqual(next.groups[0].bank, ["t1:0", "t1:1"]);
  assert.deepEqual(groupBank(next.groups[0], 5), ["t1:0", "t1:1"], "дуэль берёт подготовленные вопросы");
});

test("начатая группа банк не меняет", () => {
  const first = buildDuelsDoc({ rows, questionCount: 5, banks: null });
  const started = { ...first, groups: first.groups.map(g => ({ ...g, currentQid: "0", currentRound: 1 })) };
  const next = buildDuelsDoc({ rows, existing: started, questionCount: 5, banks: { 1: ["t1:0"] } });
  assert.equal(next.groups[0].bank, undefined, "вопросы не меняются посреди дуэли");
});

test("без подготовленного банка поведение прежнее", () => {
  const first = buildDuelsDoc({ rows, questionCount: 3, banks: null });
  assert.equal(duelGroupsChanged(first, [{ members: rows.slice(0, 2) }], { 1: [] }), false);
  const round = openDuelRound(first.groups[0], 3);
  assert.equal(round.currentQid, "0", "вопрос из теста");
});

test("подготовленный банк уже есть в группе — документ не пересобирается", () => {
  const withBank = buildDuelsDoc({ rows, questionCount: 5, banks: { 1: ["t1:0"] } });
  assert.equal(duelGroupsChanged(withBank, [{ members: rows.slice(0, 2) }], { 1: ["t1:0"] }), false);
});
