// tests/topic-students.test.js — таблица «Ученики и оценки» на странице темы
// (обычные прохождения без Live): ФИО по алфавиту, баллы, статусы.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { topicStudentRows, TOPIC_STATUS_LABELS } from "../core/analytics-logic.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const page = fs.readFileSync(path.join(root, "ui/pages/topic-analytics.js"), "utf8");
const T = 1_800_000_000_000;
const students = [
  { uid: "u1", fullName: "Яковлев А." }, { uid: "u2", fullName: "Белов Б." },
  { uid: "u3", fullName: "Ахметов В." }, { uid: "u4", fullName: "Дроздов Г." }
];
const att = (extra) => ({ orgId: "o1", status: "graded", startedAt: T, finishedAt: T, ...extra });

test("ФИО по алфавиту, баллы лучшей попытки и «набрано из максимума»", () => {
  const rows = topicStudentRows({
    students,
    attempts: [
      att({ userId: "u1", percent: 50, score: 15, total: 30, finishedAt: T - 1000 }),
      att({ userId: "u1", percent: 80, score: 24, total: 30, finishedAt: T }),
      att({ userId: "u2", percent: 40, score: 12, total: 30 })
    ]
  });
  assert.deepEqual(rows.map(r => r.name), ["Ахметов В.", "Белов Б.", "Дроздов Г.", "Яковлев А."]);
  const yak = rows.find(r => r.uid === "u1");
  assert.deepEqual([yak.status, yak.attemptsCount, yak.bestScore, yak.bestEarned, yak.bestMax, yak.latestScore, yak.averageScore],
    ["passed", 2, 80, 24, 30, 80, 65]);
  assert.equal(rows.find(r => r.uid === "u2").status, "failed");
});

test("нет попыток — «не приступал» и null (не 0); в ожидании проверки и в процессе различаются", () => {
  const rows = topicStudentRows({
    students,
    attempts: [att({ userId: "u3", status: "submitted", percent: undefined }), att({ userId: "u4", status: "in_progress" })]
  });
  const by = uid => rows.find(r => r.uid === uid);
  assert.equal(by("u3").status, "pending");
  assert.equal(by("u4").status, "in_progress");
  assert.equal(by("u1").status, "none");
  assert.deepEqual([by("u1").bestScore, by("u1").averageScore, by("u1").latestMs], [null, null, null]);
  assert.equal(by("u3").attemptsCount, 1);
  assert.equal(by("u4").attemptsCount, 0, "идущая попытка — не результат");
  assert.equal(TOPIC_STATUS_LABELS.passed, "Сдал");
});

test("гость не в таблице; ученик вне ростера виден по имени из попытки; старые попытки без score/total", () => {
  const rows = topicStudentRows({
    students: [],
    attempts: [
      att({ userId: "g", guest: true, userName: "Гость", percent: 100 }),
      att({ userId: "x", userName: "Перешёл В.", percent: 70 }),
      att({ userId: "y", percent: 61 })
    ]
  });
  assert.deepEqual(rows.map(r => r.name), ["Перешёл В.", "Участник"]);
  const old = rows.find(r => r.uid === "y");
  assert.deepEqual([old.bestScore, old.bestEarned, old.bestMax], [61, null, null]);
  assert.deepEqual(topicStudentRows({}), []);
});

test("страница темы: сводка в баллах, таблица учеников — последним разделом", () => {
  assert.match(page, /gradeLabel\(data\.averageScore\)/);
  assert.match(page, /studentsTable\(topicStudentRows\(\{ attempts, students \}\)\)\);/);
  assert.ok(page.indexOf('"Сложные вопросы"') < page.indexOf("studentsTable(topicStudentRows"), "статистика и графики выше таблицы");
  assert.match(page, /\["ФИО", "Статус", "Попыток", "Лучший балл", "Набрано", "Последний", "Дата"\]/);
});
