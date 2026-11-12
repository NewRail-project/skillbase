import { test } from "node:test";
import assert from "node:assert/strict";
import {
  settingsFromForm, formFromSettings, mergeSettings, normalizeSettings,
  effectiveSettings, SETTINGS_DEFAULTS,
  ON_QUESTION_TIMEOUT_VALUES, ON_TOTAL_TIMEOUT_VALUES, ANSWER_POLICY_VALUES
} from "../core/settings.js";
import { emptyTest, validateTest } from "../core/test-schema.js";

const form = (over = {}) => ({
  shuffleQuestions: true, shuffleOptions: false,
  timePerQuestionSec: "", totalTimeMin: "", passScore: "", attemptsLimit: "3",
  onQuestionTimeout: "lock", onTotalTimeout: "submit",
  allowRetake: true, answerPolicy: "final",
  showLeaderboard: false, showCorrectAfterQuestion: false,
  ...over
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
  // Частичная форма (только passScore) не трогает остальные настройки.
  const merged = mergeSettings(
    { answerPolicy: "final", showLeaderboard: true, passScore: 50, attemptsLimit: 7, allowRetake: true },
    { passScore: "80" }
  );
  assert.equal(merged.answerPolicy, "final");
  assert.equal(merged.showLeaderboard, true);
  assert.equal(merged.passScore, 80);
  assert.equal(merged.attemptsLimit, 7);
  // Полная форма формы перезаписывает всё, что в ней есть.
  const full = mergeSettings(
    { showLeaderboard: true, attemptsLimit: 7 },
    form({ showLeaderboard: false, attemptsLimit: "2" })
  );
  assert.equal(full.showLeaderboard, false);
  assert.equal(full.attemptsLimit, 2);
});

test("значения по умолчанию совпадают со схемой", () => {
  const s = emptyTest().settings;
  for (const key of Object.keys(SETTINGS_DEFAULTS)) assert.equal(s[key], SETTINGS_DEFAULTS[key], key);
});

// ---------- новые настройки: перечисления ----------

test("onQuestionTimeout: только next и lock, legacy skip → lock", () => {
  assert.deepEqual(ON_QUESTION_TIMEOUT_VALUES, ["next", "lock"]);
  assert.equal(normalizeSettings({ onQuestionTimeout: "next" }).onQuestionTimeout, "next");
  assert.equal(normalizeSettings({ onQuestionTimeout: "skip" }).onQuestionTimeout, "lock");
  assert.equal(normalizeSettings({ onQuestionTimeout: "мусор" }).onQuestionTimeout, "lock");
});

test("onTotalTimeout: только submit и expire, legacy autosubmit → submit", () => {
  assert.deepEqual(ON_TOTAL_TIMEOUT_VALUES, ["submit", "expire"]);
  assert.equal(normalizeSettings({ onTotalTimeout: "expire" }).onTotalTimeout, "expire");
  assert.equal(normalizeSettings({ onTotalTimeout: "autosubmit" }).onTotalTimeout, "submit");
  assert.equal(normalizeSettings({ onTotalTimeout: "мусор" }).onTotalTimeout, "submit");
});

test("answerPolicy: changeable/final, legacy never → final", () => {
  assert.deepEqual(ANSWER_POLICY_VALUES, ["changeable", "final"]);
  assert.equal(normalizeSettings({ answerPolicy: "changeable" }).answerPolicy, "changeable");
  assert.equal(normalizeSettings({ answerPolicy: "never" }).answerPolicy, "final");
  assert.equal(normalizeSettings({ answerPolicy: "мусор" }).answerPolicy, "final");
});

// ---------- противоречия ----------

test("showCorrectAfterQuestion работает только при answerPolicy=final", () => {
  assert.equal(normalizeSettings({ showCorrectAfterQuestion: true, answerPolicy: "final" }).showCorrectAfterQuestion, true);
  assert.equal(normalizeSettings({ showCorrectAfterQuestion: true, answerPolicy: "changeable" }).showCorrectAfterQuestion, false);
  // Миграция legacy: never → final → показ возможен.
  assert.equal(normalizeSettings({ showCorrectAfterQuestion: true, answerPolicy: "never" }).showCorrectAfterQuestion, true);
});

test("allowRetake=false принудительно даёт одну попытку", () => {
  assert.equal(normalizeSettings({ allowRetake: false, attemptsLimit: 5 }).attemptsLimit, 1);
  assert.equal(normalizeSettings({ allowRetake: true, attemptsLimit: 5 }).attemptsLimit, 5);
  assert.equal(normalizeSettings({ attemptsLimit: 3 }).allowRetake, true);
});

test("onQuestionTimeout без timePerQuestion не активен (значение сохраняется)", () => {
  // Значение хранится, но рантайм его применяет только при timePerQuestion:
  // проверяем, что нормализация не отбрасывает настройку.
  assert.equal(normalizeSettings({ timePerQuestion: null, onQuestionTimeout: "next" }).onQuestionTimeout, "next");
});

test("validateTest: отражает противоречие showCorrect + changeable", () => {
  const t = emptyTest();
  t.title = "T";
  t.questions = [{ type: "short", text: "q", answer: "a", points: 1 }];
  t.settings = { ...t.settings, answerPolicy: "changeable", showCorrectAfterQuestion: true };
  assert.ok(validateTest(t).errors.some(e => e.includes("final")));
});

// ---------- effectiveSettings: единая точка рантайма ----------

test("effectiveSettings нормализует legacy-документ и мусор", () => {
  assert.equal(effectiveSettings({ settings: { onTotalTimeout: "autosubmit", answerPolicy: "never", allowRetake: false } }).onTotalTimeout, "submit");
  assert.equal(effectiveSettings({ settings: { answerPolicy: "never", allowRetake: false } }).answerPolicy, "final");
  assert.equal(effectiveSettings({ settings: null }).attemptsLimit, SETTINGS_DEFAULTS.attemptsLimit);
  assert.equal(effectiveSettings(null).attemptsLimit, SETTINGS_DEFAULTS.attemptsLimit);
});

// ---------- валидация перечислений ----------

test("validateTest: неизвестные значения перечислений отклоняются", () => {
  const base = emptyTest();
  base.title = "T";
  base.questions = [{ type: "short", text: "q", answer: "a", points: 1 }];
  for (const [key, bad, good] of [
    ["onQuestionTimeout", "jump", "next"],
    ["onTotalTimeout", "drop", "expire"],
    ["answerPolicy", "strict", "final"]
  ]) {
    const badTest = { ...base, settings: { ...base.settings, [key]: bad } };
    const goodTest = { ...base, settings: { ...base.settings, [key]: good } };
    assert.ok(validateTest(badTest).errors.length > 0, `${key}=${bad} должен отклоняться`);
    assert.equal(validateTest(goodTest).errors.length, 0, `${key}=${good} должен проходить`);
  }
});
