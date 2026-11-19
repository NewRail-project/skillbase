import test from "node:test";
import assert from "node:assert/strict";
import { buildLaunchPlan, validateQuestions } from "../core/battle-launch.js";
import * as L from "../core/battle-logic.js";

const ids = (n) => Array.from({ length: n }, (_, i) => "u" + (i + 1));
const roster = (n) => L.buildRoster({ memberIds: ids(n), captains: { a: "u1", b: "u2" }, rng: L.createSeededRng(7) }).roster;
const qs = [
  { id: "q1", type: "single", optionCount: 4, correct: [2] },
  { id: "q2", type: "multiple", optionCount: 5, correct: [0, 3] }
];
const base = { hostId: "host", testId: "t1", orgId: "org" };

test("план: публичный документ не содержит правильных ответов", () => {
  const { plan, errors } = buildLaunchPlan({ ...base, roster: roster(9), questions: qs });
  assert.equal(errors, undefined);
  const json = JSON.stringify(plan.battle);
  assert.equal(json.includes("correct"), false);
  assert.equal(json.includes('"key"'), false);
  assert.deepEqual(plan.battle.questions, [
    { id: "q1", type: "single", optionCount: 4 },
    { id: "q2", type: "multiple", optionCount: 5 }
  ]);
});

test("план: ключи только в отдельном списке, режим комнаты battle", () => {
  const { plan } = buildLaunchPlan({ ...base, roster: roster(8), questions: qs });
  assert.deepEqual(plan.keys, [{ id: "q1", correct: [2] }, { id: "q2", correct: [0, 3] }]);
  assert.deepEqual(plan.room, { mode: "battle" });
});

test("план: поля игроков — команда, капитан, резерв", () => {
  const r = roster(9);
  const { plan } = buildLaunchPlan({ ...base, roster: r, questions: qs });
  assert.deepEqual(plan.playerFields.u1, { teamId: "a", isCaptain: true, isReserve: false });
  assert.deepEqual(plan.playerFields.u2, { teamId: "b", isCaptain: true, isReserve: false });
  const res = r.reserve[0];
  assert.deepEqual(plan.playerFields[res], { teamId: "reserve", isCaptain: false, isReserve: true });
  assert.equal(Object.keys(plan.playerFields).length, 9);
});

test("план: настройки нормализуются, неверные веса — ошибка", () => {
  const ok = buildLaunchPlan({ ...base, roster: roster(8), questions: qs, settings: { questionSeconds: 45 } });
  assert.equal(ok.plan.battle.settings.questionSeconds, 45);
  const bad = buildLaunchPlan({ ...base, roster: roster(8), questions: qs, settings: { weightLive: 0.9 } });
  assert.ok(bad.errors.length > 0);
  assert.equal(bad.plan, undefined);
});

test("план: без вопросов, с открытым вопросом, без ведущего — не запускается", () => {
  assert.ok(buildLaunchPlan({ ...base, roster: roster(8), questions: [] }).errors.length);
  const open = buildLaunchPlan({ ...base, roster: roster(8), questions: [{ id: "x", type: "open", optionCount: 2, correct: [0] }] });
  assert.match(open.errors[0], /только выбор/);
  assert.ok(buildLaunchPlan({ roster: roster(8), questions: qs, testId: "t" }).errors.some((e) => /ведущий/.test(e)));
});

test("вопросы: неверный индекс ответа и один ответ у single — ошибка", () => {
  assert.ok(validateQuestions([{ id: "a", type: "single", optionCount: 2, correct: [5] }]).length);
  assert.ok(validateQuestions([{ id: "a", type: "single", optionCount: 3, correct: [0, 1] }]).length);
  assert.ok(validateQuestions([{ id: "a/b", type: "single", optionCount: 2, correct: [0] }]).length);
  assert.equal(validateQuestions(qs).length, 0);
});

test("состав: капитан вне своей команды или дубль участника — ошибка", () => {
  const r = roster(8);
  const dup = { ...r, reserve: [r.teams.a[1]] };
  const res = buildLaunchPlan({ ...base, roster: dup, questions: qs });
  assert.ok(res.errors.some((e) => /дважды/.test(e)));
});

import { toBattleQuestions } from "../core/battle-launch.js";

const testQs = [
  { options: ["a", "b", "c"], type: "single" },
  { options: ["a", "b", "c", "d"], type: "multiple" },
  { options: ["x", "y"], type: "short" }
];
const testKeys = [
  { type: "single", correct: [1] },
  { type: "multiple", correct: [0, 2] },
  { type: "short", answer: "y" }
];

test("вопросы теста: одиночные и множественные переходят, короткие — с ошибкой", () => {
  const { questions, errors } = toBattleQuestions({ questions: testQs, keys: testKeys });
  assert.deepEqual(questions, [
    { id: "q0", type: "single", optionCount: 3, correct: [1] },
    { id: "q1", type: "multiple", optionCount: 4, correct: [0, 2] }
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Вопрос 3/);
});

test("вопросы теста: количество ограничивает набор, порядок set сохраняется", () => {
  const { questions } = toBattleQuestions({ questions: testQs, keys: testKeys, count: 1, order: "set" });
  assert.deepEqual(questions.map((q) => q.id), ["q0"]);
});

test("вопросы теста: случайный порядок детерминирован при одном rng", () => {
  const many = Array.from({ length: 6 }, (_, i) => ({ options: ["a", "b"], type: "single" }));
  const keysMany = many.map(() => ({ type: "single", correct: [0] }));
  const seeded = () => { let s = 0.5; return () => (s = (s * 9301 + 49297) % 233280 / 233280); };
  const a = toBattleQuestions({ questions: many, keys: keysMany, order: "random", rng: seeded() }).questions.map((q) => q.id);
  const b = toBattleQuestions({ questions: many, keys: keysMany, order: "random", rng: seeded() }).questions.map((q) => q.id);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 6);
});
