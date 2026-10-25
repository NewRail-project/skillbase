import { test } from "node:test";
import assert from "node:assert/strict";
import { settingsFromForm, formFromSettings, mergeSettings, SETTINGS_DEFAULTS } from "../core/settings.js";
import { emptyTest, validateTest } from "../core/test-schema.js";

const form = (over = {}) => ({
  shuffleQuestions: true, shuffleOptions: false,
  timePerQuestionSec: "", totalTimeMin: "", passScore: "", attemptsLimit: "3", ...over
});

test("пустые числа превращаются в null, минуты — в секунды", () => {
  const s = settingsFromForm(form({ totalTimeMin: "15", timePerQuestionSec: "30", passScore: "70" }));
  assert.equal(s.totalTime, 900);
  assert.equal(s.timePerQuestion, 30);
  assert.equal(s.passScore, 70);
  const empty = settingsFromForm(form());
  assert.equal(empty.totalTime, null);
  assert.equal(empty.timePerQuestion, null);
  assert.equal(empty.passScore, null);
});

test("мусор в числовом поле не маскируется, а отклоняется валидатором", () => {
  const t = emptyTest();
  t.title = "T";
  t.questions = [{ type: "short", text: "q", answer: "a", points: 1 }];
  t.settings = { ...t.settings, ...settingsFromForm(form({ passScore: "abc" })) };
  assert.ok(validateTest(t).errors.some((e) => e.includes("Проходной балл")));
});

test("границы: проходной балл 0 и 101, время на вопрос 4 — ошибки", () => {
  const base = emptyTest();
  base.title = "T";
  base.questions = [{ type: "short", text: "q", answer: "a", points: 1 }];
  for (const over of [{ passScore: "0" }, { passScore: "101" }, { timePerQuestionSec: "4" }, { attemptsLimit: "51" }]) {
    const t = { ...base, settings: { ...base.settings, ...settingsFromForm(form(over)) } };
    assert.ok(validateTest(t).errors.length > 0, JSON.stringify(over));
  }
  const ok = { ...base, settings: { ...base.settings, ...settingsFromForm(form({ passScore: "100", timePerQuestionSec: "5" })) } };
  assert.equal(validateTest(ok).errors.length, 0);
});

test("форма → настройки → форма возвращает те же значения", () => {
  const original = form({ totalTimeMin: "20", passScore: "60", timePerQuestionSec: "45", attemptsLimit: "5" });
  assert.deepEqual(formFromSettings(settingsFromForm(original)), original);
});

test("merge сохраняет прочие поля схемы", () => {
  const merged = mergeSettings({ answerPolicy: "never", showLeaderboard: true, passScore: 50 }, form({ passScore: "80" }));
  assert.equal(merged.answerPolicy, "never");
  assert.equal(merged.showLeaderboard, true);
  assert.equal(merged.passScore, 80);
});

test("значения по умолчанию совпадают со схемой", () => {
  const s = emptyTest().settings;
  for (const key of Object.keys(SETTINGS_DEFAULTS)) assert.equal(s[key], SETTINGS_DEFAULTS[key], key);
});
