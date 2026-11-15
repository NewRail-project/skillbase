// tests/analytics-filters.test.js — фильтры аналитики: дисциплина, группа,
// ученик, тип проверки (+ тема, период) на уровне чистой логики
// core/analytics-logic.js. Фактическая работа интерфейса — в
// tests/analytics-page.test.js (там выполняется настоящая страница).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyticsView, normalizeFilters, filterOptions, hasActiveFilters, EMPTY_FILTERS,
  filterAttempts, attemptCheckType, matchesKind, attemptKind, CHECK_KINDS,
  groupAnalytics, studentAnalytics, disciplineAnalytics
} from "../core/analytics-logic.js";
import { makeFixture } from "./helpers/analytics-fixture.js";

const fx = makeFixture();
const data = { attempts: fx.attempts, students: fx.users.filter(u => u.role === "student"), subjects: fx.subjects, topics: fx.topics, assignments: fx.assignments, orgId: "o1" };
const view = (filters = {}) => analyticsView(data, filters, { nowMs: fx.now });
const ids = list => list.map(a => a.id).sort();

// ---------- 1. Каждый фильтр отдельно ----------

test("дисциплина: только попытки этой дисциплины, без чужих организаций и без дисциплин других", () => {
  const v = view({ subjectId: "subjM" });
  assert.deepEqual(ids(v.attempts.filter(a => a.status !== "in_progress")), ["a1", "a2", "a3", "a4", "a6", "e1"]);
  assert.ok(v.attempts.every(a => a.subjectId === "subjM" && a.orgId === "o1"));
  assert.equal(v.overview.averageScore, 63);
  assert.deepEqual(v.disciplines.map(d => d.subject.id), ["subjM"]);
  assert.deepEqual(v.weakTopics.map(t => t.id).sort(), ["tM1", "tM2"]);
});

test("группа: только попытки группы; ученики — только этой группы", () => {
  const v = view({ groupId: "g2" });
  assert.ok(v.attempts.every(a => a.groupId === "g2"));
  assert.deepEqual(v.options.students.map(s => s.uid), ["u3", "u4"]);
  assert.deepEqual(v.students.rows.map(r => r.uid).sort(), ["u3", "u4"]);
  // Группа g1 чужой организации не подмешалась.
  assert.ok(!v.attempts.some(a => a.orgId === "o2"));
});

test("ученик: личная статистика только его попыток", () => {
  const v = view({ userId: "u1" });
  assert.ok(v.attempts.every(a => a.userId === "u1"));
  assert.equal(v.students.student.name, "Анна");
  assert.equal(v.students.student.testsCompleted, 3); // a1, a2 и старая L1
  assert.equal(v.students.student.averageScore, 65);  // (90+40+65)/3 = 65
  assert.equal(v.students.student.bestScore, 90);
});

test("тип проверки: free / exam / training / assignment по реальным полям схемы", () => {
  assert.deepEqual(ids(view({ kind: "exam" }).attempts), ["a1", "a3", "a5"]);
  assert.deepEqual(ids(view({ kind: "training" }).attempts), ["b1"]);
  assert.deepEqual(ids(view({ kind: "assignment" }).attempts), ["a1", "a3", "a5", "b1"]);
  const free = ids(view({ kind: "free" }).attempts);
  assert.ok(free.includes("L1") && free.includes("b4") && !free.includes("a1") && !free.includes("b1"));
  // Выбранный тип исключает остальные из ВСЕХ связанных показателей.
  const v = view({ kind: "training" });
  assert.equal(v.overview.attemptsCount, 1);
  assert.equal(v.distribution.total, 1);
  assert.deepEqual(v.groups.bars.map(b => b.groupId), ["g2"]);
  assert.deepEqual(v.weakTopics.map(t => t.id), ["tP1"]);
  assert.deepEqual(v.disciplines.map(d => d.subject.id), ["subjP"]);
});

test("типы проверки: Live не придумывается, неизвестный тип задания не выдаётся за exam", () => {
  assert.deepEqual(CHECK_KINDS.map(k => k.id), ["assignment", "exam", "training", "free"]);
  const unknown = { assignmentId: "deleted-assignment" };
  assert.equal(attemptCheckType(unknown, new Map()), "assignment");
  assert.equal(matchesKind(unknown, "exam", new Map()), false);
  assert.equal(matchesKind(unknown, "assignment", new Map()), true);
  assert.equal(attemptCheckType({ assignmentId: "x" }, { x: "training" }), "training");
  // Прежний контракт attemptKind сохранён.
  assert.equal(attemptKind({ assignmentId: "x" }), "assignment");
  assert.equal(attemptKind({}), "free");
  // Неизвестное значение kind в фильтре → сбрасывается, а не «нулевая выборка».
  assert.equal(normalizeFilters(data, { kind: "live" }).kind, "");
});

// ---------- 2. Все четыре фильтра вместе ----------

test("дисциплина → группа → ученик → тип работают одновременно", () => {
  const v = view({ subjectId: "subjM", groupId: "g1", userId: "u1", kind: "exam" });
  assert.deepEqual(ids(v.attempts), ["a1"]);
  assert.equal(v.overview.averageScore, 90);
  assert.equal(v.students.student.averageScore, 90);
  assert.equal(v.distribution.total, 1);
  assert.deepEqual(v.groups.bars, [{ groupId: "g1", label: "g1", averageScore: 90, count: 1 }]);
  assert.deepEqual(v.weakTopics.map(t => t.id), ["tM1"]);
  assert.deepEqual(v.students.rows.map(r => r.uid), ["u1"]);
});

// ---------- 3. Смена дисциплины корректирует зависимые фильтры ----------

test("смена дисциплины сбрасывает несовместимые тему, группу и ученика", () => {
  const before = { subjectId: "subjM", topicId: "tM2", groupId: "g1", userId: "u1" };
  assert.deepEqual(normalizeFilters(data, before), { ...EMPTY_FILTERS, ...before });
  // Физика: тема tM2 чужая, g1 по Физике не занималась, Анна — тоже.
  const after = normalizeFilters(data, { ...before, subjectId: "subjP" });
  assert.deepEqual(after, { ...EMPTY_FILTERS, subjectId: "subjP" });
  // Совместимое остаётся: g2 и Вера занимались физикой.
  const keep = normalizeFilters(data, { subjectId: "subjP", groupId: "g2", userId: "u3", topicId: "tP1" });
  assert.deepEqual(keep, { ...EMPTY_FILTERS, subjectId: "subjP", groupId: "g2", userId: "u3", topicId: "tP1" });
});

test("несуществующие/чужие id (другая организация, удалённые) сбрасываются", () => {
  const f = normalizeFilters(data, { subjectId: "nope", topicId: "nope", groupId: "nope", userId: "x1", period: "5", kind: "zzz" });
  assert.deepEqual(f, EMPTY_FILTERS);
  // Ученик чужой организации не появляется в опциях, даже если передан в данных.
  const leaky = { ...data, students: fx.users.filter(u => u.role === "student") };
  assert.ok(!filterOptions(leaky, {}).students.some(s => s.uid === "x1"));
});

// ---------- 4. Смена группы и списка учеников ----------

test("смена группы меняет список учеников; ученик другой группы сбрасывается", () => {
  assert.deepEqual(filterOptions(data, { groupId: "g1" }).students.map(s => s.uid), ["u1", "u2"]);
  assert.deepEqual(filterOptions(data, { groupId: "g2" }).students.map(s => s.uid), ["u3", "u4"]);
  assert.equal(normalizeFilters(data, { groupId: "g2", userId: "u1" }).userId, "");
  assert.equal(normalizeFilters(data, { groupId: "g1", userId: "u1" }).userId, "u1");
  // Группа без дисциплины: доступны и группы ростера без попыток (g3).
  assert.deepEqual(filterOptions(data, {}).groups, ["g1", "g2", "g3"]);
  assert.deepEqual(filterOptions(data, { subjectId: "subjP" }).groups, ["g2"]);
});

test("ученик, перешедший в другую группу, виден в старой группе по снимку попыток", () => {
  const moved = { ...data, students: data.students.map(s => s.uid === "u1" ? { ...s, groupId: "g2" } : s) };
  const g1 = filterOptions(moved, { groupId: "g1" }).students.map(s => s.uid);
  assert.ok(g1.includes("u1"), "попытки u1 хранят groupId=g1");
  assert.ok(filterOptions(moved, { groupId: "g2" }).students.some(s => s.uid === "u1"));
});

// ---------- 5/6. Сброс ----------

test("сброс: пустые фильтры = все данные; hasActiveFilters", () => {
  assert.equal(hasActiveFilters(EMPTY_FILTERS), false);
  assert.equal(hasActiveFilters({ period: "all" }), false);
  assert.equal(hasActiveFilters({ kind: "free" }), true);
  assert.equal(hasActiveFilters({ period: "7" }), true);
  const all = view(EMPTY_FILTERS);
  assert.equal(all.overview.attemptsCount, 11);
  assert.equal(all.overview.gradedCount, 9);
  assert.equal(all.overview.averageScore, 64);
  // Сброс отдельного фильтра: остальные сохраняются.
  const f = normalizeFilters(data, { subjectId: "subjM", groupId: "g1", kind: "exam" });
  assert.deepEqual(normalizeFilters(data, { ...f, groupId: "" }), { ...EMPTY_FILTERS, subjectId: "subjM", kind: "exam" });
});

// ---------- 7. Пустая выборка ----------

test("пустая выборка: null вместо нулей, пустые разделы без ошибок", () => {
  const v = view({ subjectId: "subjE" });
  assert.equal(v.isEmpty, true);
  assert.equal(v.overview.averageScore, null);
  assert.equal(v.overview.bestScore, null);
  assert.equal(v.overview.attemptsCount, 0);
  assert.equal(v.distribution, null);
  assert.equal(v.dynamics, null);
  assert.deepEqual(v.weakTopics, []);
  assert.deepEqual(v.groups.bars, []);
  // Ученик без оценённых попыток: средний — null, а не 0%.
  const s = view({ userId: "u5" }).students.student;
  assert.equal(s.averageScore, null);
  assert.equal(s.bestScore, null);
  assert.equal(s.testsCompleted, 0);
  assert.deepEqual(s.subjectsProgress, []);
});

// ---------- 8. Организации ----------

test("организации не смешиваются: чужие попытки/ученики/задания/справочники исключены", () => {
  const leaky = {
    attempts: fx.attempts, // включая f1/f2 из o2
    students: fx.users.filter(u => u.role === "student"), // включая x1 из o2
    subjects: [...fx.subjects, { id: "subjX", title: "Чужая", orgId: "o2" }],
    topics: [...fx.topics, { id: "tX1", subjectId: "subjX", title: "Чужая тема", orgId: "o2" }],
    assignments: fx.assignments, // включая asX из o2
    orgId: "o1"
  };
  const v = analyticsView(leaky, {}, { nowMs: fx.now });
  assert.ok(v.attempts.every(a => a.orgId === "o1"));
  assert.equal(v.overview.averageScore, 64, "оценки по 100 из o2 не повлияли");
  assert.ok(!v.options.subjects.some(s => s.id === "subjX"));
  assert.ok(!v.options.topics.some(t => t.id === "tX1"));
  assert.ok(!v.options.students.some(s => s.uid === "x1"));
  assert.equal(v.assignments.total, 4, "asX (o2) не учтено");
  // Одинаковое имя группы в двух организациях: g1 считается только по o1.
  const g1 = analyticsView(leaky, { groupId: "g1" }, { nowMs: fx.now });
  assert.ok(g1.attempts.every(a => a.orgId === "o1"));
  // filterAttempts: orgId — жёсткая граница, в т.ч. для записей без orgId.
  assert.equal(filterAttempts([{ orgId: "o2" }, { orgId: "o1" }, {}], { orgId: "o1" }).length, 1);
  assert.equal(filterAttempts([{ orgId: "o2" }, {}]).length, 2, "без orgId в фильтре — прежнее поведение");
});

// ---------- 9. Согласованность карточек, графиков и таблиц ----------

test("согласованность при любых сочетаниях фильтров", () => {
  const combos = [];
  for (const subjectId of ["", "subjM", "subjP", "subjE"])
    for (const groupId of ["", "g1", "g2"])
      for (const kind of ["", "exam", "training", "free", "assignment"])
        for (const period of ["all", "7", "30"]) combos.push({ subjectId, groupId, kind, period });
  let nonEmpty = 0;
  for (const filters of combos) {
    const v = view(filters);
    const label = JSON.stringify(v.filters);
    const graded = v.attempts.filter(a => a.status === "graded" && Number.isFinite(a.percent));
    assert.equal(v.overview.gradedCount, graded.length, label);
    // Распределение = оценённые (или null, когда оценённых нет).
    assert.equal(v.distribution?.total ?? 0, graded.length, `${label}: распределение`);
    // Столбцы групп = оценённые.
    assert.equal(v.groups.bars.reduce((s, b) => s + b.count, 0), graded.length, `${label}: группы`);
    // Таблица учеников + гости/не из ростера = оценённые (никогда не больше).
    const inRoster = new Set(v.options.students.map(s => s.uid));
    const outside = graded.filter(a => !inRoster.has(a.userId)).length;
    assert.equal(v.students.rows.reduce((s, r) => s + r.attemptsCount, 0) + outside, graded.length, `${label}: таблица`);
    // Дисциплины: при выбранной дисциплине — ровно она и её оценённые.
    if (v.filters.subjectId) {
      assert.ok(v.disciplines.every(d => d.subject.id === v.filters.subjectId), label);
      if (v.disciplines[0]) assert.equal(v.disciplines[0].data.gradedCount, graded.length, `${label}: дисциплина`);
    }
    // Средний в обзоре = среднему тех же попыток.
    const expectedAvg = graded.length ? Math.round(graded.reduce((s, a) => s + a.percent, 0) / graded.length) : null;
    assert.equal(v.overview.averageScore, expectedAvg, `${label}: средний`);
    // Слабые темы — только из выбранной выборки.
    for (const t of v.weakTopics) assert.ok(graded.some(a => a.topicId === t.id), label);
    // Попытки незавершённые и чужие в результаты не попали.
    assert.ok(v.attempts.every(a => a.orgId === "o1"), label);
    assert.equal(v.overview.attemptsCount, v.attempts.filter(a => ["submitted", "graded", "expired"].includes(a.status)).length, label);
    if (v.attempts.length) nonEmpty += 1;
  }
  assert.ok(nonEmpty > 20 && nonEmpty < combos.length, "набор сочетаний содержит и пустые, и непустые выборки");
});

test("незавершённые и неизвестные статусы не считаются результатами", () => {
  const extra = [
    ...fx.attempts,
    { id: "z1", orgId: "o1", userId: "u1", groupId: "g1", subjectId: "subjM", status: "cancelled", percent: 100, startedAt: fx.now },
    { id: "z2", orgId: "o1", userId: "u1", groupId: "g1", subjectId: "subjM", status: "graded", percent: null, finishedAt: fx.now }
  ];
  const v = analyticsView({ ...data, attempts: extra }, { subjectId: "subjM" }, { nowMs: fx.now });
  assert.equal(v.overview.averageScore, 63, "cancelled и graded без процента не влияют на средний");
  assert.equal(v.overview.gradedCount, 4);
  assert.equal(v.overview.attemptsCount, 7, "graded без процента — завершённая, но не оценённая");
  assert.equal(v.overview.inProgressCount, 1);
  assert.equal(v.overview.pendingCount + v.overview.expiredCount + v.overview.gradedCount + 1, v.overview.attemptsCount, "cancelled в «Попытки» не входит; graded без процента — входит");
});

test("активность и выполнение заданий не искажаются фильтром периода", () => {
  // Период 7 дней: попытка Глеба (b2, 20 дн.) вне периода, но он активен в
  // последние 30 дней — «без активности 30+ дней» его не касается.
  const v = view({ subjectId: "subjP", groupId: "g2", period: "7" });
  const gleb = v.groups.selected.ranking.find(r => r.uid === "u4");
  assert.equal(gleb.averageScore, null, "в период 7 дней оценок у Глеба нет");
  assert.equal(gleb.inactive, false);
  assert.deepEqual(v.groups.selected.inactive.map(r => r.uid), []);
  // Старое поведение (без activityAttempts) отмечало бы его неактивным.
  const legacy = groupAnalytics({ attempts: v.attempts, students: v.options.students, nowMs: fx.now });
  assert.equal(legacy.ranking.find(r => r.uid === "u4").inactive, true);
  // Выполнение задания не зависит от периода.
  assert.equal(view({ period: "7" }).assignments.done, view({}).assignments.done);
});

// ---------- 10. Совместимость со старыми попытками ----------

test("старые попытки без новых полей: не теряются и не ломают расчёты", () => {
  const legacy = [
    { id: "o-old", orgId: "o1", userId: "u1", status: "graded", percent: 66, testId: "t" }, // ни дат, ни группы, ни темы, ни задания
    { id: "o-old2", orgId: "o1", userId: "u2", status: "submitted", testId: "t" }
  ];
  const v = analyticsView({ ...data, attempts: legacy }, { period: "7", kind: "free" }, { nowMs: fx.now });
  assert.equal(v.overview.attemptsCount, 2, "без дат попытки не отсекаются периодом");
  assert.equal(v.overview.averageScore, 66);
  assert.equal(v.groups.bars[0].label, "Без группы");
  const s = studentAnalytics({ attempts: [legacy[0]], subjects: [], topics: [], assignments: [] });
  assert.equal(s.averageScore, 66);
  assert.equal(s.testsCompleted, 1);
  // Дисциплина без попыток и без тем: честные null, не NaN.
  const d = disciplineAnalytics({ attempts: [], topics: [], students: [] });
  assert.equal(d.averageScore, null);
  assert.equal(d.masteryPercent, null);
  assert.equal(d.activeStudentsPercent, null);
});

test("период: окно считается от текущего момента, 'all' не режет", () => {
  assert.equal(view({ period: "all" }).overview.attemptsCount, 11);
  assert.equal(view({ period: "7" }).overview.attemptsCount, 7);
  assert.equal(view({ period: "90" }).overview.attemptsCount, 11);
});
