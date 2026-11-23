// tests/bots-plan.test.js — план ответов ботов: детерминизм, границы, точность.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planBotAnswers, botNames, summarizePlan, BOT_LIMITS, seededRandom, normalizeAccuracy
} from "../core/bots-plan.js";

test("seededRandom: один seed — одна последовательность, числа в [0, 1)", () => {
  const a = seededRandom(7);
  const b = seededRandom(7);
  const seq = Array.from({ length: 50 }, () => a());
  assert.deepEqual(seq, Array.from({ length: 50 }, () => b()));
  assert.ok(seq.every(x => x >= 0 && x < 1));
  const c = seededRandom(8);
  assert.notDeepEqual(seq, Array.from({ length: 50 }, () => c()));
});

test("botNames: «Бот 01»…, не больше 30, без отрицательных", () => {
  assert.deepEqual(botNames(3), ["Бот 01", "Бот 02", "Бот 03"]);
  assert.equal(botNames(100).length, BOT_LIMITS.maxBots);
  assert.equal(botNames(30).at(-1), "Бот 30");
  assert.deepEqual(botNames(-4), []);
  assert.deepEqual(botNames("abc"), []);
});

test("planBotAnswers: ботов × вопросов, вопросы нумеруются с 1", () => {
  const plan = planBotAnswers({ botCount: 4, questionCount: 6, accuracy: 0.5, seed: 3 });
  assert.equal(plan.length, 4);
  for (const entry of plan) {
    assert.equal(entry.answers.length, 6);
    assert.deepEqual(entry.answers.map(a => a.question), [1, 2, 3, 4, 5, 6]);
  }
  assert.equal(plan[0].bot, "Бот 01");
});

test("planBotAnswers: задержка каждого ответа в пределах 800–15000 мс", () => {
  const plan = planBotAnswers({ botCount: 30, questionCount: 20, accuracy: 0.6, seed: 11 });
  const delays = plan.flatMap(p => p.answers.map(a => a.delayMs));
  assert.ok(delays.length === 600);
  assert.ok(delays.every(d => Number.isInteger(d) && d >= 800 && d <= 15000));
});

test("planBotAnswers: один seed — один план, другой seed — другой", () => {
  const args = { botCount: 5, questionCount: 8, accuracy: 0.6 };
  assert.deepEqual(planBotAnswers({ ...args, seed: 1 }), planBotAnswers({ ...args, seed: 1 }));
  assert.notDeepEqual(planBotAnswers({ ...args, seed: 1 }), planBotAnswers({ ...args, seed: 2 }));
});

test("planBotAnswers: точность 0 — все неверно, 1 (и 100 %) — все верно", () => {
  const all = (plan, value) => plan.every(p => p.answers.every(a => a.correct === value));
  assert.ok(all(planBotAnswers({ botCount: 5, questionCount: 10, accuracy: 0, seed: 4 }), false));
  assert.ok(all(planBotAnswers({ botCount: 5, questionCount: 10, accuracy: 1, seed: 4 }), true));
  assert.ok(all(planBotAnswers({ botCount: 5, questionCount: 10, accuracy: 100, seed: 4 }), true));
  assert.equal(normalizeAccuracy(60), 0.6);
  assert.equal(normalizeAccuracy("x"), 0);
});

test("summarizePlan: считает ответы и верные; ботов не больше лимита", () => {
  const plan = planBotAnswers({ botCount: 99, questionCount: 3, accuracy: 1, seed: 1 });
  const sum = summarizePlan(plan);
  assert.equal(sum.bots, 30);
  assert.equal(sum.questions, 3);
  assert.equal(sum.totalAnswers, 90);
  assert.equal(sum.correct, 90);
  assert.equal(sum.accuracy, 1);
  assert.deepEqual(summarizePlan(null), { bots: 0, questions: 0, totalAnswers: 0, correct: 0, accuracy: 0 });
});
