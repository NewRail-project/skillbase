import test from "node:test";
import assert from "node:assert/strict";
import {
  dateMs, isoDateToMs, msToISODate, formatTopicDate, topicOpenNow,
  studentTopicState, topicStatusLabel
} from "../core/schedule-logic.js";
import { validateJournalEntry, journalEntryId } from "../core/grade-journal-logic.js";
import { trainState } from "../ui/components/live-train.js";
import { gradeRoster, journalRows } from "../core/pair-grade.js";

const D = (iso) => isoDateToMs(iso);

test("даты: ISO ↔ миллисекунды, мусор отклоняется", () => {
  assert.equal(msToISODate(D("2026-11-15")), "2026-11-15");
  assert.equal(isoDateToMs("2026-02-31"), null);
  assert.equal(isoDateToMs(""), null);
  assert.equal(dateMs(null), null);
  assert.equal(dateMs({ toMillis: () => 5 }), 5);
  assert.equal(formatTopicDate(null), "не задана");
});

test("окно доступа темы: до открытия закрыта, после закрытия недоступна", () => {
  const topic = { openDate: D("2026-11-10"), closeDate: D("2026-11-20"), dueDate: D("2026-11-18") };
  assert.equal(topicOpenNow(topic, D("2026-11-09")), false);
  assert.equal(topicOpenNow(topic, D("2026-11-20") + 3600e3), true); // день закрытия включён
  assert.equal(topicOpenNow(topic, D("2026-11-21")), false);
  assert.equal(studentTopicState(topic, D("2026-11-09")).state, "upcoming");
  assert.equal(studentTopicState(topic, D("2026-11-12")).state, "available");
  assert.equal(studentTopicState(topic, D("2026-11-19")).state, "overdue");
  assert.equal(studentTopicState(topic, D("2026-11-25")).state, "closed");
  assert.equal(topicStatusLabel("draft"), "Черновик");
});

test("журнал: проверка записи и детерминированный id без дублей", () => {
  assert.equal(validateJournalEntry({ studentId: "u1", grade: 80, source: "test" }), null);
  assert.ok(validateJournalEntry({ studentId: "u1", grade: 101, source: "test" }));
  assert.ok(validateJournalEntry({ studentId: "", grade: 50, source: "test" }));
  assert.ok(validateJournalEntry({ studentId: "u1", grade: 50, source: "x" }));
  const a = journalEntryId({ studentId: "u1", source: "test", sourceId: "att/1" });
  assert.equal(a, journalEntryId({ studentId: "u1", source: "test", sourceId: "att/1" }));
  assert.equal(journalEntryId({ studentId: "u1", source: "test" }), null);
});

test("паровоз: станции = вопросы, в конце стоит на конечной", () => {
  assert.deepEqual(trainState({ total: 0 }).stations, 0);
  const mid = trainState({ position: 2, total: 5 });
  assert.equal(mid.stations, 5);
  assert.equal(mid.passed, 2);
  assert.equal(mid.parked, false);
  assert.equal(mid.progress, 0.5);
  const end = trainState({ position: 1, total: 5, finished: true });
  assert.equal(end.progress, 1);
  assert.equal(end.parked, true);
  assert.equal(end.passed, 5);
  assert.equal(trainState({ position: 99, total: 3 }).index, 2);
});

test("журнал пары: участники по алфавиту, у каждого оценка", () => {
  const keys = [{ type: "single", correct: [0], points: 1 }, { type: "single", correct: [1], points: 1 }];
  const players = [
    { uid: "b", name: "Яковлев", answers: { 0: [0], 1: [1] } },
    { uid: "a", name: "Алексеев", answers: { 0: [0] } },
    { uid: "c", name: "Борисов", answers: {} }
  ];
  const rows = journalRows(gradeRoster({ players, keysByPos: keys }));
  assert.deepEqual(rows.map(r => r.name), ["Алексеев", "Борисов", "Яковлев"]);
  assert.ok(rows.every(r => r.grade === null || typeof r.grade === "number"));
  assert.equal(rows[2].grade, 100);
});
