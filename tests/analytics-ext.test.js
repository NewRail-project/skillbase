// tests/analytics-ext.test.js — ЭТАП 6: аналитика дисциплин, тем, групп
// и учеников. Проверяются чистые расчёты core/analytics-logic.js
// (существующие функции buildAnalytics/aggregateLeaderboard не тронуты —
// их поведение уже покрыто tests/analytics-logic.test.js) на сценариях:
// нет попыток, одна попытка, несколько попыток, незавершённые, повторные,
// старые записи без новых полей, разные дисциплины и группы.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  filterAttempts, attemptKind, gradeDistribution, averagePercent,
  performanceDynamics, disciplineAnalytics, topicAnalytics, groupAnalytics,
  assignmentCompletion, studentAnalytics, PERIODS, TOPIC_PASS_PERCENT,
  buildAnalytics, aggregateLeaderboard // существующие — не сломать
} from "../core/analytics-logic.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(path.join(ROOT, "shared/app.js"), "utf8");
const HUB = readFileSync(path.join(ROOT, "ui/pages/analytics.js"), "utf8");
const TOPIC_PAGE = readFileSync(path.join(ROOT, "ui/pages/topic-analytics.js"), "utf8");
const CHARTS = readFileSync(path.join(ROOT, "ui/components/charts.js"), "utf8");
const RULES = readFileSync(path.join(ROOT, "firestore.rules"), "utf8");

const DAY = 24 * 3600 * 1000;
const NOW = new Date(2026, 10, 15, 12).getTime(); // 2026-11-15

// Фабрика попытки: существенные поля журнала (core/attempts.js).
function attempt(overrides = {}) {
  return {
    userId: "s1",
    userName: "Иван",
    groupId: "g1",
    orgId: "o1",
    testId: "t1",
    testTitle: "Тест",
    assignmentId: "",
    subjectId: "subj1",
    topicId: "top1",
    status: "graded",
    percent: 70,
    answers: {},
    startedAt: NOW - DAY,
    finishedAt: NOW - DAY,
    ...overrides
  };
}

// ---------- Фильтр и периоды ----------

test("фильтр: нет попыток — пустой результат без ошибок", () => {
  assert.deepEqual(filterAttempts([], { subjectId: "subj1" }), []);
  assert.deepEqual(filterAttempts([attempt()], { userId: "nope" }), []);
});

test("фильтр: дисциплина, группа, ученик и тип проверки", () => {
  const attempts = [
    attempt({ subjectId: "subj1", groupId: "g1", userId: "a", assignmentId: "as1" }),
    attempt({ subjectId: "subj2", groupId: "g2", userId: "b", assignmentId: "" }),
    attempt({ subjectId: "subj1", groupId: "g2", userId: "b", assignmentId: "" })
  ];
  assert.equal(filterAttempts(attempts, { subjectId: "subj1" }).length, 2);
  assert.equal(filterAttempts(attempts, { groupId: "g1" }).length, 1);
  assert.equal(filterAttempts(attempts, { userId: "b" }).length, 2);
  assert.equal(filterAttempts(attempts, { kind: "assignment" }).length, 1);
  assert.equal(attemptKind(attempts[0]), "assignment");
  assert.equal(attemptKind(attempts[1]), "free");
  assert.deepEqual(filterAttempts(attempts, { subjectId: "subj1", groupId: "g2" }).length, 1);
});

test("фильтр: период отсекает старые, попытки без дат не теряются", () => {
  const attempts = [
    attempt({ finishedAt: NOW - 2 * DAY }),
    attempt({ finishedAt: NOW - 90 * DAY }),
    // Старая запись без дат (легаси) — показывается при любом периоде.
    attempt({ finishedAt: null, startedAt: null })
  ];
  assert.equal(filterAttempts(attempts, { fromMs: NOW - 7 * DAY }).length, 2);
  assert.equal(filterAttempts(attempts, { fromMs: NOW - 120 * DAY }).length, 3);
});

test("периоды: справочник с честными окнами", () => {
  assert.deepEqual(PERIODS.map(p => p.days), [null, 7, 30, 90]);
});

// ---------- Распределение оценок ----------

test("распределение: корзины и сумма равна числу попыток", () => {
  const dist = gradeDistribution([10, 55, 75, 90, 100, 84, 120, -5]);
  // 120 и -5 вне диапазона — отброшены.
  assert.equal(dist.total, 6);
  assert.deepEqual(dist.buckets.map(b => b.count), [1, 1, 2, 2]);
  assert.equal(dist.buckets.reduce((sum, b) => sum + b.count, 0), dist.total);
});

test("распределение: нет данных → null (не выдуманные нули)", () => {
  assert.equal(gradeDistribution([]), null);
  assert.equal(gradeDistribution([null, undefined]), null);
});

test("средний: пусто → null, округление", () => {
  assert.equal(averagePercent([]), null);
  assert.equal(averagePercent([70, 71]), 71);
  assert.equal(averagePercent([0]), 0);
});

// ---------- Динамика ----------

test("динамика: одна точка — не динамика (null)", () => {
  assert.equal(performanceDynamics([attempt()], NOW), null);
  assert.equal(performanceDynamics([], NOW), null);
});

test("динамика: недельные корзины по среднему, пустые пропускаются", () => {
  const attempts = [
    attempt({ percent: 60, finishedAt: NOW - 15 * DAY }),
    attempt({ percent: 80, finishedAt: NOW - 15 * DAY + 1 }),
    attempt({ percent: 100, finishedAt: NOW - 2 * DAY })
  ];
  const points = performanceDynamics(attempts, NOW);
  assert.ok(points.length >= 2);
  // Последняя точка — неделя с одной попыткой 100%.
  const last = points[points.length - 1];
  assert.equal(last.avgPercent, 100);
  assert.equal(last.count, 1);
  // Первая точка — среднее 60 и 80.
  assert.equal(points[0].avgPercent, 70);
});

// ---------- Дисциплина ----------

test("дисциплина: нет попыток — честные null и нули", () => {
  const data = disciplineAnalytics({
    attempts: [],
    topics: [{ id: "t1" }, { id: "t2" }],
    students: [{ uid: "s1" }]
  });
  assert.equal(data.studentsCount, 1);
  assert.equal(data.topicsCount, 2);
  assert.equal(data.masteryPercent, 0, "тем нет освоенных — 0%");
  assert.equal(data.averageScore, null);
  assert.equal(data.bestScore, null);
  assert.equal(data.completedTopics, 0);
  assert.equal(data.incompleteTopics, 2);
  assert.equal(data.activeStudents, 0);
  assert.equal(data.activeStudentsPercent, 0);
});

test("дисциплина: завершение темы по среднему баллу ≥ 60 и по материалу", () => {
  const topics = [{ id: "t1" }, { id: "t2" }, { id: "t3" }];
  const attempts = [
    attempt({ topicId: "t1", percent: 80 }),
    attempt({ topicId: "t1", percent: 90 }), // средняя 85 ≥ 60 → завершена
    attempt({ topicId: "t2", percent: 40 }), // средняя 40 < 60 → нет
    attempt({ topicId: "t3", percent: 70 })
  ];
  const data = disciplineAnalytics({
    attempts, topics,
    students: [{ uid: "s1" }, { uid: "s2" }],
    completedMaterialTopicIds: new Set(["t2"]), // t2 закрыта материалом
    nowMs: NOW
  });
  assert.equal(data.completedTopics, 3);
  assert.equal(data.incompleteTopics, 0);
  assert.equal(data.masteryPercent, 100);
  assert.equal(data.averageScore, Math.round((80 + 90 + 40 + 70) / 4));
  assert.equal(data.bestScore, 90);
});

test("дисциплина: повторные попытки — лучший берётся по максимуму", () => {
  const data = disciplineAnalytics({
    attempts: [attempt({ percent: 30 }), attempt({ percent: 95 })],
    topics: [{ id: "t1" }],
    students: [{ uid: "s1" }]
  });
  assert.equal(data.bestScore, 95);
  assert.equal(data.averageScore, Math.round((30 + 95) / 2), "среднее по всем попыткам");
});

test("дисциплина: активность — попытки за 30 дней", () => {
  const data = disciplineAnalytics({
    attempts: [
      attempt({ userId: "a", finishedAt: NOW - DAY }),
      attempt({ userId: "b", finishedAt: NOW - 40 * DAY })
    ],
    topics: [],
    students: [{ uid: "a" }, { uid: "b" }],
    nowMs: NOW
  });
  assert.equal(data.activeStudents, 1);
  assert.equal(data.activeStudentsPercent, 50);
});

// ---------- Тема ----------

test("тема: нет попыток и нет назначенных — null-показатели", () => {
  const data = topicAnalytics({ attempts: [], assignedCount: 0, progressRows: [] });
  assert.equal(data.startedCount, 0);
  assert.equal(data.averageScore, null);
  assert.equal(data.distribution, null);
  assert.equal(data.finishedMaterialCount, 0);
  assert.equal(data.notPassedCount, 0);
});

test("тема: несколько попыток и повторные прохождения", () => {
  const data = topicAnalytics({
    attempts: [
      attempt({ userId: "s1", percent: 40 }),
      attempt({ userId: "s1", percent: 90 }), // повторная
      attempt({ userId: "s2", percent: 55 }),
      attempt({ userId: "s3", status: "in_progress" })
    ],
    assignedCount: 4,
    progressRows: [
      { uid: "s1", completed: true },
      { uid: "s2", completed: false }
    ]
  });
  assert.equal(data.startedCount, 3, "уникальные ученики с попытками");
  assert.equal(data.passedCount, 1, "≥ 60% — только s1");
  assert.equal(data.notPassedCount, 3, "4 назначенных − 1 прошедший");
  assert.equal(data.attemptsCount, 4);
  assert.equal(data.inProgressCount, 1);
  assert.equal(data.repeatStudentsCount, 1);
  assert.equal(data.finishedMaterialCount, 1);
  assert.equal(data.startedMaterialCount, 2);
  assert.equal(data.averageScore, Math.round((40 + 90 + 55) / 3));
});

test("тема: сложные вопросы из buildAnalytics (общий расчёт)", () => {
  const keys = { "0": { type: "single", points: 1, correct: [1] } };
  const attempts = [
    attempt({ answers: { "0": 1 } }),
    attempt({ answers: { "0": 0 } })
  ];
  const data = topicAnalytics({ attempts, assignedCount: 2, keys });
  assert.equal(data.questionStats.perQuestion[0].percent, 50);
  assert.deepEqual(data.questionStats.lowQuestions, [], "50% выше порога 40%");
});

// ---------- Группа ----------

test("группа: рейтинг, отстающие и без активности", () => {
  const data = groupAnalytics({
    attempts: [
      attempt({ userId: "a", userName: "Аня", percent: 90, finishedAt: NOW - DAY }),
      attempt({ userId: "b", userName: "Борис", percent: 30, finishedAt: NOW - DAY }),
      attempt({ userId: "c", userName: "Вера", percent: 80, finishedAt: NOW - 60 * DAY })
    ],
    students: [
      { uid: "a", fullName: "Аня" },
      { uid: "b", fullName: "Борис" },
      { uid: "c", fullName: "Вера" },
      { uid: "d", fullName: "Глеб" }
    ],
    topics: [{ id: "top1", title: "Тема 1" }],
    nowMs: NOW
  });
  assert.equal(data.studentsCount, 4);
  assert.deepEqual(data.ranking.map(r => r.uid), ["a", "c", "b", "d"],
    "рейтинг по среднему, ученик без попыток — в конце");
  assert.deepEqual(data.lagging.map(r => r.uid), ["b"], "средний < 60% — отстающий");
  assert.deepEqual(data.inactive.map(r => r.uid), ["c", "d"],
    "60+ дней без попыток и совсем без попыток");
  assert.equal(data.topicComparison.length, 1);
  assert.equal(data.activeStudentsPercent, 50);
});

test("группа: учебный рейтинг не смешан с Live-рейтингом", () => {
  // Проверка чистой логики: вход — только попытки; полей room/duel нет.
  const data = groupAnalytics({
    attempts: [attempt({ percent: 75 })],
    students: [{ uid: "s1", fullName: "Иван" }],
    topics: []
  });
  assert.ok(!("liveScore" in data) && !("duelScore" in data));
  assert.equal(data.ranking[0].averageScore, 75);
});

test("группа: сравнение тем — только темы с попытками", () => {
  const data = groupAnalytics({
    attempts: [
      attempt({ topicId: "t1", percent: 50 }),
      attempt({ topicId: "t1", percent: 90 }),
      attempt({ topicId: "t2", percent: 100 })
    ],
    students: [{ uid: "s1", fullName: "Иван" }],
    topics: [{ id: "t1", title: "T1" }, { id: "t2", title: "T2" }, { id: "t3", title: "T3" }]
  });
  assert.deepEqual(data.topicComparison.map(t => t.topicId), ["t2", "t1"]);
  assert.equal(data.topicComparison[0].averageScore, 100);
  assert.equal(data.topicComparison[1].averageScore, 70);
});

// ---------- Задания ----------

test("задания: доля выполненных и просроченные без попыток", () => {
  const data = assignmentCompletion({
    assignments: [
      { id: "as1", testId: "t1", groupId: "g1", deadline: { toMillis: () => NOW - DAY } },
      { id: "as2", testId: "t2", groupId: "g1", deadline: { toMillis: () => NOW + DAY } },
      { id: "as3", testId: "t3", groupId: "g2", deadline: null }
    ],
    attempts: [attempt({ userId: "s1", testId: "t1", percent: 80 })],
    students: [
      { uid: "s1", fullName: "Иван", groupId: "g1" },
      { uid: "s2", fullName: "Борис", groupId: "g1" },
      { uid: "s3", fullName: "Вера", groupId: "g2" }
    ],
    nowMs: NOW
  });
  // as1: g1 × 2 ученика; as2: g1 × 2; as3: g2 × 1 → всего 5.
  assert.equal(data.total, 5);
  assert.equal(data.done, 1);
  assert.equal(data.percent, 20);
  // Просрочено без попытки: только s2 по as1 (as3 без срока — не строка).
  assert.deepEqual(data.overdueRows.map(r => `${r.uid}|${r.assignmentId}`), ["s2|as1"]);
});

// ---------- Ученик ----------

test("ученик: сильные, слабые темы и просроченные задания", () => {
  const data = studentAnalytics({
    attempts: [
      attempt({ topicId: "t1", percent: 90, testId: "k1" }),
      attempt({ topicId: "t2", percent: 40, testId: "k2" }),
      attempt({ topicId: "t3", percent: 55, testId: "k3" })
    ],
    subjects: [{ id: "subj1", title: "Математика" }],
    topics: [
      { id: "t1", title: "Сильная", subjectId: "subj1" },
      { id: "t2", title: "Слабая", subjectId: "subj1" },
      { id: "t3", title: "Пограничная", subjectId: "subj1" }
    ],
    assignments: [
      { id: "as1", testId: "k9", deadline: { toMillis: () => NOW - DAY } },
      { id: "as2", testId: "k1", deadline: { toMillis: () => NOW - DAY } }
    ],
    nowMs: NOW
  });
  assert.equal(data.testsCompleted, 3);
  assert.deepEqual(data.strongTopics.map(t => t.topicId), ["t1"]);
  assert.ok(data.weakTopicsDetailed.map(t => t.topicId).includes("t2"));
  // as2 закрыта попыткой k1 — не просрочена; as1 просрочена.
  assert.deepEqual(data.overdueAssignments.map(a => a.assignmentId), ["as1"]);
  // Существующая логика progress.js сохранена в расчёте.
  assert.equal(data.gradedAttempts, 3);
  assert.ok(Array.isArray(data.dynamics.series));
});

test("ученик: старые записи без новых полей не ломают расчёт", () => {
  // Попытки до этапа 4: без topicId, groupId, assignmentId.
  const data = studentAnalytics({
    attempts: [attempt({ topicId: null, groupId: undefined, assignmentId: undefined, percent: 66 })],
    subjects: [], topics: [], assignments: []
  });
  assert.equal(data.testsCompleted, 1);
  assert.equal(data.averageScore, 66);
  assert.equal(data.strongTopics.length, 0);
});

// ---------- Статические проверки ----------

test("маршруты аналитики зарегистрированы", () => {
  assert.match(APP, /"analytics":\s*\{[^}]*ui\/pages\/analytics\.js/);
  assert.match(APP, /"topic-analytics":\s*\{[^}]*ui\/pages\/topic-analytics\.js/);
  assert.match(APP, /"topic-analytics"[^}]*roles: STAFF/, "аналитика — только персонал");
});

test("графики: линейная динамика, столбцы сравнения, распределение", () => {
  // Расчёт динамики — в analyticsView (общая выборка фильтров), страница
  // рисует view.dynamics линейным графиком.
  assert.match(HUB, /analyticsView/, "хаб считает всё через единую модель");
  assert.match(HUB, /view\.dynamics[\s\S]*lineChart|lineChart[\s\S]*view\.dynamics/, "линейная динамика на хабе");
  assert.match(HUB, /barChart/, "столбчатое сравнение");
  assert.match(CHARTS, /role: "img"/, "графики доступны (aria)");
});

test("пустые состояния вместо выдуманных данных", () => {
  assert.match(HUB, /Недостаточно данных для динамики/);
  assert.match(HUB, /Попыток по выбранным фильтрам нет/);
  // Формулировка страницы темы: «Оценённых попыток пока нет.».
  assert.match(TOPIC_PAGE, /Оценённых попыток (пока )?нет/);
});

test("фильтры на хабе: дисциплина, тема, группа, ученик, период, тип проверки", () => {
  for (const label of ["по дисциплине", "по теме", "по группе", "по ученику", "по периоду", "по типу проверки"]) {
    assert.match(HUB, new RegExp(`"Фильтр ${label}"`));
  }
});

test("существующая аналитика сохранена: слабые темы и leaderboard", () => {
  assert.match(HUB, /weakTopicsSection/, "блок «Слабые темы» остался");
  assert.match(HUB, /Рейтинг по тестам/, "ссылка на существующий leaderboard");
  // Существующие функции не удалены и работают по-прежнему.
  assert.equal(typeof buildAnalytics, "function");
  assert.equal(typeof aggregateLeaderboard, "function");
});

test("безопасность: правила чтения прогресса сотрудником ограничены orgId", () => {
  const block = RULES.slice(RULES.indexOf("match /materialProgress"), RULES.indexOf("match /attempts/"));
  assert.match(block, /isStaff\(\)/);
  assert.match(block, /users\/\$\(\$?\{?resource\.data\.uid|users\/\$\(\$\{resource\.data\.uid\}\)/, "владелец прогресса сверяется по users/{uid}");
  assert.match(block, /== myOrg\(\)/, "только своя организация");
  // Студент по-прежнему пишет только свой прогресс: hasOnly и uid == auth.
  assert.match(block, /request\.resource\.data\.uid == request\.auth\.uid/);
});
