import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gradeLabel, earnedLabel, attemptResultLabel } from "../core/score-format.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");

test("оценка в баллах: число + «б.», нет данных — прочерк, а не 0", () => {
  assert.equal(gradeLabel(80), "80 б.");
  assert.equal(gradeLabel(64.4), "64 б.");
  assert.equal(gradeLabel(0), "0 б.", "настоящий ноль остаётся нулём");
  assert.equal(gradeLabel(null), "—");
  assert.equal(gradeLabel(undefined), "—");
  assert.equal(gradeLabel(NaN), "—");
});

test("набранные баллы и результат попытки", () => {
  assert.equal(earnedLabel(24, 30), "24 из 30");
  assert.equal(earnedLabel(2.5, 5), "2.5 из 5");
  assert.equal(earnedLabel(1, 0), "—");
  assert.equal(attemptResultLabel({ percent: 80, score: 24, total: 30 }), "80 б. (24 из 30)");
  assert.equal(attemptResultLabel({ percent: 80 }), "80 б.");
  assert.equal(attemptResultLabel({ percent: null, score: 1, total: 2 }), "—");
  assert.equal(attemptResultLabel(), "—");
});

test("страницы статистики показывают оценки в баллах, а не в процентах", () => {
  const results = read("ui/pages/results.js");
  assert.match(results, /attemptResultLabel\(\{ percent: r\.percent, score: r\.score, total: r\.total \}\)/);
  assert.ok(!/\$\{r\.percent\}%/.test(results), "результат попытки без процентов");
  assert.match(results, /"Оценка \(баллы\)"/);
  const home = read("ui/pages/home.js");
  assert.ok(!/avg \+ "%"/.test(home), "главная: средний балл без %");
});
