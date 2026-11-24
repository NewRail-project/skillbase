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

test("место пары сдвинулось: документ не требует бесконечного обновления", () => {
  // Документ создан, когда A и B делили 2-е место; банк подготовлен для 2-го.
  const old = [
    { uid: "a", name: "A", place: 2, score: 3, correctCount: 3 },
    { uid: "b", name: "B", place: 2, score: 3, correctCount: 3 },
  ];
  const doc = buildDuelsDoc({ rows: old, questionCount: 5, banks: null });
  // Позже та же пара делит 3-е место; банка для 3-го места нет.
  const now = [
    { uid: "x", name: "X", place: 1, score: 9, correctCount: 9 },
    { uid: "a", name: "A", place: 3, score: 3, correctCount: 3 },
    { uid: "b", name: "B", place: 3, score: 3, correctCount: 3 },
  ];
  const groups = [{ members: now.slice(1) }];
  const banks = { 2: ["t2:0", "t2:1"] };
  const rebuilt = buildDuelsDoc({ rows: now, existing: doc, questionCount: 5, banks });
  assert.equal(duelGroupsChanged(rebuilt, groups, banks), false,
    "после пересборки документ стабилен — записи не повторяются");
  assert.equal(duelGroupsChanged(doc, groups, banks), false,
    "банк для 3-го места не подготовлен — менять нечего");
  // Если банк для нового места появился — документ обновляется один раз.
  const banks3 = { 3: ["t3:0"] };
  assert.equal(duelGroupsChanged(doc, groups, banks3), true);
  const updated = buildDuelsDoc({ rows: now, existing: doc, questionCount: 5, banks: banks3 });
  assert.deepEqual(updated.groups[0].bank, ["t3:0"]);
  assert.equal(duelGroupsChanged(updated, groups, banks3), false);
});
