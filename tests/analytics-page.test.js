// tests/analytics-page.test.js — фактическая работа страницы аналитики.
//
// В отличие от статических проверок исходника, здесь ВЫПОЛНЯЕТСЯ настоящая
// ui/pages/analytics.js: подменён только слой Firebase (tests/helpers/stubs),
// DOM — минимальная заглушка. Тест меняет селекты (как пользователь) и
// читает то, что страница реально нарисовала: карточки, диаграммы, таблицы.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { installFakeDom, byLabel, panelByTitle, optionsOf, choose, statsOf, tableRows, findAll, findOne, text } from "./helpers/fake-dom.js";
import { makeFixture } from "./helpers/analytics-fixture.js";

register("./helpers/stub-loader.mjs", import.meta.url);
installFakeDom();
const { default: AnalyticsPage } = await import("../ui/pages/analytics.js");

const L = {
  subject: "Фильтр по дисциплине", topic: "Фильтр по теме", group: "Фильтр по группе",
  user: "Фильтр по ученику", period: "Фильтр по периоду", kind: "Фильтр по типу проверки"
};

async function open({ profile = { uid: "staff1", role: "admin", orgId: "o1" }, leak = false, mutate = null } = {}) {
  const fx = makeFixture();
  if (mutate) mutate(fx);
  globalThis.__SB = { ...fx, profile, leak, calls: [], staff: true };
  const page = await AnalyticsPage();
  return { page, fx };
}
const sel = (page, key) => byLabel(page, L[key]);
const picked = (page, key) => optionsOf(sel(page, key)).find(o => o.selected)?.value;
const values = (page, key) => optionsOf(sel(page, key)).map(o => o.value).filter(Boolean);
const overview = page => statsOf(panelByTitle(page, "Обзор"));
const rows = (page, title) => tableRows(panelByTitle(page, title));
const barHints = el => findAll(el, e => e.className === "chart-bar-value").map(text);
const barLabels = el => findAll(el, e => e.className === "chart-bar-label").map(text);

test("страница: без фильтров считает только свою организацию (даже если данные «утекли»)", async () => {
  const { page } = await open({ leak: true }); // стаб отдаёт попытки обеих организаций
  const o = overview(page);
  assert.equal(o["Попыток"].value, "11", "9 оценённых + 1 на проверке + 1 время вышло; in_progress не считается");
  assert.match(o["Попыток"].hint, /оценено: 9/);
  assert.match(o["Попыток"].hint, /на проверке: 1/);
  assert.match(o["Попыток"].hint, /в процессе \(не в счёт\): 1/);
  assert.equal(o["Средний балл"].value, "64%");
  assert.match(o["Средний балл"].hint, /лучший: 100%/);
  // Ученики: 5 студентов o1; «Чужой» (o2, та же группа g1) и преподаватель не попали.
  assert.equal(o["Учеников"].value, "5");
  assert.ok(!values(page, "user").includes("x1"));
  assert.ok(!text(page).includes("Чужой"));
});

test("дисциплина: список реальных дисциплин; выбор оставляет данные только этой дисциплины", async () => {
  const { page: p0 } = await open();
  assert.deepEqual(values(p0, "subject"), ["subjM", "subjP", "subjE"]);

  const { page } = await open();
  choose(sel(page, "subject"), "subjM");
  const o = overview(page);
  assert.equal(o["Попыток"].value, "6", "a1,a2,a3,a4 + a6(на проверке) + e1(время вышло)");
  assert.equal(o["Средний балл"].value, "63%", "(90+40+50+70)/4 = 62,5 → 63");
  // Нет «Физики» ни в блоке дисциплин, ни в слабых темах, ни в опциях тем.
  const disc = text(panelByTitle(page, "Дисциплины"));
  assert.ok(disc.includes("Математика") && !disc.includes("Физика") && !disc.includes("Химия"));
  assert.ok(!text(panelByTitle(page, "Слабые темы")).includes("Механика"));
  assert.deepEqual(values(page, "topic"), ["tM1", "tM2"]);
  // Группы — только те, где есть попытки/задания по Математике.
  assert.deepEqual(values(page, "group"), ["g1", "g2"]);
});

test("группа: список зависит от дисциплины; смена группы пересчитывает всё и не смешивает учеников", async () => {
  const { page } = await open();
  choose(sel(page, "subject"), "subjP");
  assert.deepEqual(values(page, "group"), ["g2"], "по Физике занималась только g2");

  choose(sel(page, "subject"), "subjM");
  choose(sel(page, "group"), "g1");
  const o = overview(page);
  assert.equal(o["Попыток"].value, "4", "a1,a2,a3 + e1");
  assert.equal(o["Средний балл"].value, "60%");
  assert.equal(o["Учеников"].value, "2");
  // Таблица учеников и выпадающий список — ровно ученики g1.
  assert.deepEqual(values(page, "user"), ["u1", "u2"]);
  const table = rows(page, "Ученики").map(r => r[0]);
  assert.deepEqual(table, ["Анна", "Борис"]);
  assert.ok(!text(panelByTitle(page, "Ученики")).includes("Вера"));
  // Рейтинг группы (учебный): Анна (90+40)/2=65, Борис 50.
  const ranking = rows(page, "Группы").filter(r => r.length === 5).map(r => r.slice(0, 4));
  assert.deepEqual(ranking, [["Анна", "65%", "2", "90%"], ["Борис", "50%", "1", "50%"]]);

  choose(sel(page, "group"), "g2");
  assert.deepEqual(values(page, "user"), ["u3", "u4"]);
  assert.deepEqual(rows(page, "Ученики").map(r => r[0]), ["Вера", "Глеб"]);
});

test("ученик: личная статистика; смена дисциплины сбрасывает несовместимые группу и ученика", async () => {
  const { page } = await open();
  choose(sel(page, "subject"), "subjM");
  choose(sel(page, "group"), "g1");
  choose(sel(page, "user"), "u1");
  const panel = panelByTitle(page, "Ученик: Анна");
  assert.ok(panel, "появилась личная панель ученика");
  const s = statsOf(panel);
  assert.equal(s["Средний балл"].value, "65%");
  assert.match(s["Средний балл"].hint, /лучший: 90%/);
  assert.equal(s["Выполнено тестов"].value, "2");
  assert.ok(!text(panel).includes("Изучено материалов"), "нет выдуманного нуля по материалам");
  assert.equal(overview(page)["Попыток"].value, "2", "обзор считает только Анну");

  // По Физике g1 не занимался: группа и ученик сбрасываются.
  choose(sel(page, "subject"), "subjP");
  assert.equal(picked(page, "group"), "");
  assert.equal(picked(page, "user"), "");
  assert.ok(!findOne(page, e => e.tag === "h2" && text(e).startsWith("Ученик:")));
  assert.deepEqual(values(page, "user"), ["u3", "u4"], "в списке — только ученики с Физикой");
});

test("тип проверки: реальные типы разделяют попытки и все связанные показатели", async () => {
  const { page } = await open();
  assert.deepEqual(optionsOf(sel(page, "kind")).map(o => o.value), ["", "assignment", "exam", "training", "free"]);
  assert.ok(!text(sel(page, "kind")).toLowerCase().includes("live"), "искусственной категории Live нет");

  const expectations = {
    exam: { attempts: "2", avg: "70%" },     // a1 90, a3 50
    training: { attempts: "1", avg: "80%" }, // b1
    assignment: { attempts: "3", avg: "73%" },
    free: { attempts: "8", avg: "60%" }      // 6 оценённых + a6 + e1
  };
  for (const [kind, want] of Object.entries(expectations)) {
    choose(sel(page, "kind"), kind);
    const o = overview(page);
    assert.equal(o["Попыток"].value, want.attempts, `kind=${kind}: попытки`);
    assert.equal(o["Средний балл"].value, want.avg, `kind=${kind}: средний`);
  }
  // Свободные: заданий нет — блок «Задания» пуст, а не показывает чужие задания.
  const as = statsOf(panelByTitle(page, "Задания"));
  assert.equal(as["Назначено"].value, "0");
  assert.match(text(panelByTitle(page, "Задания")), /Активных заданий по выбранным фильтрам нет/);
});

test("все фильтры вместе: дисциплина → группа → ученик → тип", async () => {
  const { page } = await open();
  choose(sel(page, "subject"), "subjM");
  choose(sel(page, "group"), "g1");
  choose(sel(page, "user"), "u1");
  choose(sel(page, "kind"), "exam");
  const o = overview(page);
  assert.equal(o["Попыток"].value, "1", "только a1");
  assert.equal(o["Средний балл"].value, "90%");
  choose(sel(page, "kind"), "free");
  assert.equal(overview(page)["Попыток"].value, "1", "только a2");
  assert.equal(overview(page)["Средний балл"].value, "40%");
  assert.equal(statsOf(panelByTitle(page, "Ученик: Анна"))["Средний балл"].value, "40%");
});

test("пустая выборка: «Нет данных», прочерки вместо нулей, сброс возвращает данные", async () => {
  const { page } = await open();
  choose(sel(page, "subject"), "subjE"); // у Химии нет ни одной попытки
  const o = overview(page);
  assert.equal(o["Попыток"].value, "0");
  assert.equal(o["Средний балл"].value, "—", "null, а не 0%");
  assert.match(text(panelByTitle(page, "Обзор")), /Нет данных/);
  assert.match(text(panelByTitle(page, "Распределение оценок")), /нет/i);
  assert.deepEqual(values(page, "group"), [], "у дисциплины без попыток групп нет");

  const reset = findOne(page, e => e.tag === "button" && text(e) === "Сбросить все фильтры");
  assert.ok(reset, "кнопка общего сброса видна");
  reset.click();
  assert.equal(picked(page, "subject"), "");
  assert.equal(overview(page)["Попыток"].value, "11");
  assert.ok(!findOne(page, e => e.tag === "button" && text(e) === "Сбросить все фильтры"), "без фильтров кнопки нет");
});

test("сброс отдельного фильтра не трогает остальные", async () => {
  const { page } = await open();
  choose(sel(page, "subject"), "subjM");
  choose(sel(page, "group"), "g1");
  choose(sel(page, "kind"), "exam");
  const resetGroup = byLabel(page, "Сбросить: фильтр по группе");
  assert.ok(resetGroup);
  resetGroup.click();
  assert.equal(picked(page, "group"), "");
  assert.equal(picked(page, "subject"), "subjM");
  assert.equal(picked(page, "kind"), "exam");
  assert.equal(overview(page)["Попыток"].value, "2", "exam по Математике: a1 и a3");
  byLabel(page, "Сбросить: фильтр по типу проверки").click();
  assert.equal(picked(page, "kind"), "");
  assert.equal(overview(page)["Попыток"].value, "6");
});

test("согласованность: карточки, диаграммы и таблицы считают одни и те же попытки", async () => {
  const { page } = await open();
  const checkConsistency = (label) => {
    const o = overview(page);
    const graded = Number(/оценено: (\d+)/.exec(o["Попыток"].hint)?.[1] ?? 0);
    // Распределение: сумма корзин = число оценённых попыток.
    const dist = panelByTitle(page, "Распределение оценок");
    const distSum = barHints(dist).reduce((sum, hint) => sum + Number(/^(\d+)/.exec(hint)[1]), 0);
    assert.equal(distSum, graded, `${label}: распределение = оценённые`);
    // Группы: сумма попыток по столбцам = оценённые.
    const groupSum = barHints(panelByTitle(page, "Группы")).reduce((sum, hint) => sum + Number(/\((\d+)\)/.exec(hint)[1]), 0);
    assert.equal(groupSum, graded, `${label}: группы = оценённые`);
    // Таблица учеников + гостевые = оценённые.
    const tableSum = rows(page, "Ученики").reduce((sum, r) => sum + Number(r[2]), 0);
    // Гостей нет в ростере; в наборе у гостя ровно одна попытка и она оценена.
    const guest = /гостевые попытки: (\d+)/.exec(text(panelByTitle(page, "Обзор")));
    const guestGraded = guest ? Number(guest[1]) : 0;
    assert.equal(tableSum + guestGraded, graded, `${label}: таблица + гости = оценённые`);
  };
  checkConsistency("без фильтров");
  choose(sel(page, "kind"), "free");
  checkConsistency("свободные");
  choose(sel(page, "kind"), "");
  choose(sel(page, "period"), "7");
  checkConsistency("7 дней");
  assert.equal(overview(page)["Попыток"].value, "7");
  assert.equal(overview(page)["Средний балл"].value, "72%");
});

test("задания: статус выполнения не зависит от периода; ученик/группа сужают задания", async () => {
  const { page } = await open();
  let a = statsOf(panelByTitle(page, "Задания"));
  assert.equal(a["Назначено"].value, "4");
  assert.equal(a["Выполнено"].value, "3");
  assert.match(text(panelByTitle(page, "Задания")), /Глеб — /, "Глеб не сдал тренировку");
  // Период 7 дней отсекает оценку b1 (5 дн.)? нет, но отсекает старые; статус заданий не меняется.
  choose(sel(page, "period"), "7");
  a = statsOf(panelByTitle(page, "Задания"));
  assert.equal(a["Выполнено"].value, "3");
  // Группа g1 → только задание группы g1 (asM), выполнено обоими.
  choose(sel(page, "period"), "all");
  choose(sel(page, "group"), "g1");
  a = statsOf(panelByTitle(page, "Задания"));
  assert.equal(a["Назначено"].value, "2");
  assert.equal(a["Выполнено"].value, "2");
  // Дисциплина Физика → задание по Физике (asP) для g2.
  choose(sel(page, "group"), "");
  choose(sel(page, "subject"), "subjP");
  a = statsOf(panelByTitle(page, "Задания"));
  assert.equal(a["Назначено"].value, "2");
  assert.equal(a["Выполнено"].value, "1");
});

test("совместимость со старыми попытками: без subject/topic/group/assignment не ломают страницу", async () => {
  const { page } = await open();
  // Старая попытка L1 учтена в общем среднем и показана как «Без группы».
  assert.ok(barLabels(panelByTitle(page, "Группы")).includes("Без группы"));
  choose(sel(page, "subject"), "subjM");
  assert.equal(overview(page)["Попыток"].value, "6", "L1 без subjectId не попадает в дисциплину");
  choose(sel(page, "subject"), "");
  choose(sel(page, "kind"), "free");
  assert.equal(overview(page)["Попыток"].value, "8", "L1 — свободная (assignmentId отсутствует)");
});

test("права: преподаватель с teacherGroups видит только свои группы, учеников и задания", async () => {
  const { page } = await open({ profile: { uid: "t1", role: "teacher", orgId: "o1", teacherGroups: ["g1"] } });
  assert.deepEqual(values(page, "group"), ["g1"]);
  assert.deepEqual(values(page, "user"), ["u1", "u2"]);
  const o = overview(page);
  assert.equal(o["Учеников"].value, "2");
  // g1: a1 90, a2 40, a3 50 (+ a6? нет, g2); оценённые 3 → 60%
  assert.equal(o["Средний балл"].value, "60%");
  assert.equal(statsOf(panelByTitle(page, "Задания"))["Назначено"].value, "2");
});

test("не сотрудник: аналитика недоступна, данные не запрашиваются", async () => {
  const fx = makeFixture();
  globalThis.__SB = { ...fx, profile: { uid: "s1", role: "student", orgId: "o1" }, leak: false, calls: [], staff: false };
  const page = await AnalyticsPage();
  assert.match(text(page), /доступна сотрудникам/);
  assert.equal(globalThis.__SB.calls.length, 0);
});

test("пустая организация: «Нет данных» без ошибок", async () => {
  const { page } = await open({ mutate: fx => { fx.attempts = []; fx.users = []; } });
  assert.match(text(panelByTitle(page, "Нет данных")), /пока нет учеников и попыток/);
});

test("на смену фильтра страница не делает новых запросов к Firestore", async () => {
  const { page } = await open();
  const before = globalThis.__SB.calls.length;
  choose(sel(page, "subject"), "subjM");
  choose(sel(page, "group"), "g1");
  choose(sel(page, "user"), "u1");
  choose(sel(page, "kind"), "exam");
  assert.equal(globalThis.__SB.calls.length, before);
  // Загрузка — по одному запросу на попытки/учеников/задания.
  const c = name => globalThis.__SB.calls.filter(x => x[0] === name).length;
  assert.equal(c("listOrgAttempts"), 1);
  assert.equal(c("listOrgUsers"), 1);
  assert.equal(c("listAssignments"), 1);
});
