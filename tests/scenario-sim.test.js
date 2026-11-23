// tests/scenario-sim.test.js — прогон сценария: события, итоговая таблица, ничьи.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runScenario, rankBoard, boardFromEvents, POINTS_PER_CORRECT } from "../core/scenario-sim.js";
import { tieGroups } from "../core/duel-logic.js";
import { botNames } from "../core/bots-plan.js";

const BASE = { botCount: 8, questionCount: 5, accuracy: 0.6, seed: 1 };

test("события отсортированы по t и имеют заявленный формат", () => {
  const { events, totalAnswers } = runScenario(BASE);
  for (let i = 1; i < events.length; i += 1) assert.ok(events[i].t >= events[i - 1].t, `порядок на ${i}`);
  const answers = events.filter(e => e.type === "answer");
  assert.equal(answers.length, 40);
  assert.equal(totalAnswers, 40);
  for (const a of answers) {
    assert.equal(typeof a.bot, "string");
    assert.ok(Number.isInteger(a.question) && a.question >= 1 && a.question <= 5);
    assert.equal(typeof a.correct, "boolean");
    assert.ok(a.progress >= 0 && a.progress <= 1);
  }
  assert.ok(answers.every((a, i) => i === 0 || a.progress >= answers[i - 1].progress), "progress не убывает");
});

test("finish идёт после всех ответов, tie — после finish", () => {
  const { events, ties } = runScenario({ ...BASE, seed: 3 });
  const finishAt = events.findIndex(e => e.type === "finish");
  assert.equal(events.filter(e => e.type === "finish").length, 1);
  assert.ok(events.slice(0, finishAt).every(e => e.type === "answer"));
  const tail = events.slice(finishAt + 1);
  assert.ok(tail.every(e => e.type === "tie"));
  assert.equal(tail.length, ties.length);
  assert.ok(ties.length > 0, "для seed 3 ожидаются ничьи");
  for (const tie of tail) {
    assert.ok(tie.members.length >= 2);
    assert.equal(tie.places.length, tie.members.length);
  }
});

test("места: равные очки и верные — одно место (1, 1, 3)", () => {
  const ranked = rankBoard([
    { name: "A", score: 300, correctCount: 3 },
    { name: "B", score: 200, correctCount: 2 },
    { name: "C", score: 300, correctCount: 3 },
    { name: "D", score: 100, correctCount: 1 }
  ]);
  assert.deepEqual(ranked.map(r => `${r.name}:${r.place}`), ["A:1", "C:1", "B:3", "D:4"]);
  const { board } = runScenario(BASE);
  for (const row of board) assert.equal(row.score, row.correctCount * POINTS_PER_CORRECT);
  assert.ok(board.every((r, i) => i === 0 || r.score <= board[i - 1].score));
});

test("ties совпадают с tieGroups(board), board совпадает с событием finish", () => {
  const { board, ties, events } = runScenario({ ...BASE, botCount: 12, seed: 5 });
  assert.deepEqual(ties, tieGroups(board));
  const finish = events.find(e => e.type === "finish");
  assert.deepEqual(finish.board, board.map(r => ({ name: r.name, score: r.score, correct: r.correctCount, place: r.place })));
  assert.deepEqual(boardFromEvents(events, botNames(12)), board);
});

test("runScenario({}) — пустой сценарий; один seed — одинаковый результат", () => {
  const empty = runScenario({});
  assert.equal(empty.totalAnswers, 0);
  assert.deepEqual(empty.board, []);
  assert.equal(empty.events.length, 1);
  assert.equal(empty.events[0].type, "finish");
  assert.deepEqual(runScenario(BASE), runScenario(BASE));
  assert.notDeepEqual(runScenario(BASE).events, runScenario({ ...BASE, seed: 2 }).events);
});
