import test from "node:test";
import assert from "node:assert/strict";
import {
  pairGradeValue, gradePlayer, gradeRoster, journalRows,
  buildGradeOverride, applyOverrides, GRADE_STATUS
} from "../core/pair-grade.js";
import { buildLiveReport } from "../core/live-report.js";

const keys = Array.from({ length: 10 }, () => ({ type: "single", points: 1, correct: [0] }));
const answersOf = (right, answeredAll = true) => {
  const out = {};
  for (let i = 0; i < 10; i++) {
    if (i < right) out[i] = 0;
    else if (answeredAll) out[i] = 1;
  }
  return out;
};

test("формула: 8 верных из 10, ответил на все → 82", () => {
  assert.equal(pairGradeValue({ earned: 8, max: 10, answered: 10, total: 10 }), 82);
  const g = gradePlayer({ uid: "a", name: "А", answers: answersOf(8) }, keys);
  assert.equal(g.grade, 82);
  assert.equal(g.status, GRADE_STATUS.GRADED);
});

test("формула: полный балл = 100, без ответов = 0", () => {
  assert.equal(gradePlayer({ uid: "a", answers: answersOf(10) }, keys).grade, 100);
  const zero = gradePlayer({ uid: "b", answers: {} }, keys);
  assert.equal(zero.grade, 0);
  assert.equal(zero.status, GRADE_STATUS.ZERO);
});

test("скорость и место не влияют на оценку", () => {
  const fast = { uid: "a", answers: answersOf(5), times: { 0: 1 }, durations: { 0: 100 } };
  const slow = { uid: "b", answers: answersOf(5), times: { 0: 999 }, durations: { 0: 29000 } };
  assert.equal(gradePlayer(fast, keys).grade, gradePlayer(slow, keys).grade);
});

test("реальные веса вопросов учитываются", () => {
  const k = [{ type: "single", points: 3, correct: [0] }, { type: "single", points: 1, correct: [0] }];
  const g = gradePlayer({ uid: "a", answers: { 0: 0, 1: 1 } }, k);
  // 90 × 3/4 + 10 × 2/2 = 77.5 → 78
  assert.equal(g.grade, 78);
  assert.equal(g.earned, 3);
  assert.equal(g.max, 4);
});

test("пропуски уменьшают участие, неверные ответы — нет", () => {
  const skipped = gradePlayer({ uid: "a", answers: answersOf(5, false) }, keys);
  const wrong = gradePlayer({ uid: "b", answers: answersOf(5, true) }, keys);
  assert.ok(wrong.grade > skipped.grade);
  assert.equal(skipped.answered, 5);
});

test("журнал: по алфавиту, отсутствующие — «Не участвовал»", () => {
  const rows = gradeRoster({
    players: [
      { uid: "1", name: "Толеуов Д.", answers: answersOf(7) },
      { uid: "2", name: "Абдрахманов А.", answers: answersOf(8) },
      { uid: "3", name: "Observer", observer: true, answers: {} }
    ],
    keysByPos: keys,
    absent: [{ uid: "9", name: "Иванов В." }]
  });
  const journal = journalRows(rows);
  assert.deepEqual(journal.map(r => r.name), ["Абдрахманов А.", "Иванов В.", "Толеуов Д."]);
  assert.equal(journal[1].label, "Не участвовал");
  assert.equal(journal[1].grade, null);
});

test("ручная правка требует причину, автора и диапазон; фиксируется отдельно", () => {
  assert.ok(buildGradeOverride({ uid: "a", to: 90, authorUid: "t" }).error);
  assert.ok(buildGradeOverride({ uid: "a", to: 101, reason: "x", authorUid: "t" }).error);
  assert.ok(buildGradeOverride({ uid: "a", to: 90, reason: "x" }).error);
  const { override } = buildGradeOverride({ uid: "a", from: 82, to: 90, reason: "Сбой связи", authorUid: "t", at: 5 });
  const grades = [{ uid: "a", name: "А", status: "graded", grade: 82 }];
  const [row] = applyOverrides(grades, [override]);
  assert.equal(row.grade, 90);
  assert.equal(row.calculated, 82);
  assert.equal(row.override.reason, "Сбой связи");
});

test("отчёт: статистика группы, вопросы, ученики, темы, рекомендации", () => {
  const k = [
    { type: "single", points: 1, correct: [0] },
    { type: "single", points: 1, correct: [0] },
    { type: "short", points: 1, answer: "да" }
  ];
  const questions = [
    { text: "Q1", topic: "Устройство", options: [{ text: "a" }, { text: "b" }] },
    { text: "Q2", topic: "Защита", options: [{ text: "a" }, { text: "b" }] },
    { text: "Q3", topic: "Защита" }
  ];
  const players = [
    { uid: "1", name: "Ученик 1", answers: { 0: 0, 1: 0, 2: "да" }, durations: { 0: 4000 } },
    { uid: "2", name: "Ученик 2", answers: { 0: 0, 1: 1, 2: "нет" }, durations: { 0: 6000 } },
    { uid: "3", name: "Ученик 3", answers: { 0: 1, 1: 1 } },
    { uid: "4", name: "Ученик 4", answers: {} }
  ];
  const r = buildLiveReport({ players, keysByPos: k, questions });
  assert.equal(r.group.participants, 4);
  assert.equal(r.group.participated, 3);
  assert.equal(r.group.finished, 2);
  assert.equal(r.questions[0].correct, 2);
  assert.equal(r.questions[0].skipped, 1);
  assert.equal(r.questions[0].averageTimeSec, 5);
  assert.equal(r.questions[1].popularWrong.text, "b");
  assert.equal(r.questions[2].popularWrong.text, "нет");
  assert.equal(r.students.find(s => s.uid === "4").level, "no_answers");
  assert.equal(r.students.find(s => s.uid === "3").level, "unfinished");
  const topic = Object.fromEntries(r.topics.map(t => [t.topic, t.percent]));
  assert.equal(topic["Устройство"], 50);
  assert.equal(topic["Защита"], 25); // 2 верных из 8 возможных
  assert.ok(r.recommendations.some(x => /повторение/.test(x.text)));
  assert.ok(r.recommendations.some(x => /индивидуальная/.test(x.text)));
});

test("отчёт без ответов не падает", () => {
  const r = buildLiveReport({ players: [], keysByPos: keys, questions: [] });
  assert.equal(r.group.participants, 0);
  assert.equal(r.recommendations[0].kind, "info");
});
