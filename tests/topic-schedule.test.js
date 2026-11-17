// tests/topic-schedule.test.js — ЭТАП 4: расписание тем и учебные состояния.
//
// Чистая логика расписания — core/schedule-logic.js и части
// core/subjects-logic.js (валидация дат/группы/статусов) — проверяется
// напрямую в Node. Страницы (topic.js, calendar.js) и доступ по правилам
// (статус/группа) проверяются статически: правила — tools/rules-test.mjs
// через Rules API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  topicStatusLabel,
  dateMs,
  msToISODate,
  isoDateToMs,
  formatTopicDate,
  topicOpenNow,
  studentTopicState,
  studyPlan,
  buildScheduleEvents,
  filterScheduleEvents,
  scheduleGroups,
  overdueEvents
} from "../core/schedule-logic.js";
import {
  validateTopicData,
  validateSubjectData,
  TOPIC_STATUS_DRAFT,
  TOPIC_STATUS_PUBLISHED,
  STATUS_ARCHIVED
} from "../core/subjects-logic.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOPIC = readFileSync(path.join(ROOT, "ui/pages/topic.js"), "utf8");
const CALENDAR = readFileSync(path.join(ROOT, "ui/pages/calendar.js"), "utf8");
const APP = readFileSync(path.join(ROOT, "shared/app.js"), "utf8");
const SIDEBAR = readFileSync(path.join(ROOT, "ui/components/sidebar.js"), "utf8");
const SUBJECTS = readFileSync(path.join(ROOT, "core/subjects.js"), "utf8");
const INDEXES = readFileSync(path.join(ROOT, "firestore.indexes.json"), "utf8");

// Мок Firestore Timestamp: та же форма, что в приложении.
const ts = (ms) => ({ toMillis: () => ms, seconds: Math.floor(ms / 1000), nanoseconds: 0 });

const DAY = 24 * 3600 * 1000;
const NOW = isoDateToMs("2026-11-15"); // локальная полночь 2026-11-15

// ---------- Преобразование дат ----------

test("даты: dateMs понимает Timestamp, Date, число; строки старых данных → null", () => {
  assert.equal(dateMs(null), null);
  assert.equal(dateMs(undefined), null);
  assert.equal(dateMs("2026-11-15"), null, "строки не допускаются (правила требуют timestamp)");
  assert.equal(dateMs(ts(1234)), 1234);
  assert.equal(dateMs(new Date(5678)), 5678);
  assert.equal(dateMs(99), 99);
});

test("даты: msToISODate и isoDateToMs — обратимы, локальная зона", () => {
  const ms = isoDateToMs("2026-03-01"); // весна: проверяем границы месяцев
  assert.equal(msToISODate(ms), "2026-03-01");
  assert.equal(isoDateToMs("2026-2-1"), null, "нестрогий формат отклоняется");
  assert.equal(isoDateToMs("abc"), null);
  // Полночь локального дня: не смещается на предыдущий день в любой зоне
  // проекта (даты без времени).
  const d = new Date(isoDateToMs("2026-11-15"));
  assert.equal(d.getDate(), 15);
  assert.equal(d.getMonth(), 10);
});

test("даты: formatTopicDate — пустое значение даёт заглушку", () => {
  assert.equal(formatTopicDate(null), "не задана");
  assert.equal(formatTopicDate("x"), "не задана");
  assert.match(formatTopicDate(isoDateToMs("2026-11-15")), /2026/);
});

// ---------- Валидация расписания ----------

test("настройки: даты темы проверяются, строки отклоняются", () => {
  assert.equal(validateTopicData({ openDate: ts(NOW) }, false).ok, true);
  assert.equal(validateTopicData({ openDate: null }, false).ok, true, "снятие даты");
  assert.equal(
    validateTopicData({ openDate: "2026-11-15" }, false).error,
    "Некорректная дата: openDate",
    "строка отклоняется: правила Firestore требуют timestamp"
  );
  assert.equal(
    validateTopicData({ closeDate: ts(NOW - DAY), openDate: ts(NOW) }, false).error,
    "Дата закрытия не может быть раньше даты открытия"
  );
  assert.equal(
    validateTopicData({ groupId: "гр. 101" }, false).ok, true);
  assert.equal(
    validateTopicData({ groupId: "x".repeat(101) }, false).error,
    "Название группы слишком длинное (максимум 100 символов)"
  );
  // Предметы не принимают поля темы: разделение моделей сохранено
  assert.equal(validateSubjectData({ groupId: "гр. 101" }, false).error, "Неизвестное поле: groupId");
});

test("настройки: изменение даты валидно, кросс-проверка окна выполняется", () => {
  // «Изменение даты» по сценарию проверок: сдвиг окна открытия/закрытия.
  const check = validateTopicData({
    openDate: ts(NOW - 3 * DAY),
    closeDate: ts(NOW + 7 * DAY)
  }, false);
  assert.equal(check.ok, true);
  assert.equal(check.value.openDate.toMillis(), NOW - 3 * DAY);
});

// ---------- Открытие/закрытие доступа ----------

test("доступ: тема без дат (старые данные) открыта всегда", () => {
  const oldTopic = { id: "t1", status: "active" };
  assert.equal(topicOpenNow(oldTopic, NOW), true);
  assert.equal(topicOpenNow(oldTopic, NOW + 365 * DAY), true);
});

test("доступ: тема открывается по openDate и закрывается по closeDate", () => {
  const topic = { openDate: ts(NOW - 2 * DAY), closeDate: ts(NOW + 5 * DAY) };
  assert.equal(topicOpenNow(topic, NOW), true, "внутри окна — открыта");
  assert.equal(topicOpenNow(topic, NOW - 3 * DAY), false, "до открытия — закрыта");
  assert.equal(topicOpenNow(topic, NOW + 6 * DAY), false, "после закрытия — закрыта");
  // Границы: открыта ровно с момента открытия; closeDate — дата без
  // времени, в сам день закрытия доступ сохраняется до конца дня.
  assert.equal(topicOpenNow(topic, NOW - 2 * DAY), true);
  assert.equal(topicOpenNow(topic, NOW + 5 * DAY), true);
  assert.equal(topicOpenNow(topic, NOW + 6 * DAY - 1), true, "конец дня закрытия");
  assert.equal(topicOpenNow(topic, NOW + 6 * DAY), false, "на следующий день — закрыта");
});

// ---------- Состояния ученика ----------

test("состояния: черновики, запланированные и архивные темы не выдают состояние", () => {
  assert.equal(studentTopicState({ status: "draft" }, NOW), null);
  assert.equal(studentTopicState({ status: "planned" }, NOW), null);
  assert.equal(studentTopicState({ status: "archived" }, NOW), null);
});

test("состояния: старая тема без дат — «Доступна» / «Изучается»", () => {
  const old = { id: "t1", status: "active" };
  assert.deepEqual(studentTopicState(old, NOW), { state: "available", label: "Доступна" });
  assert.deepEqual(
    studentTopicState(old, NOW, { hasAttempts: true }),
    { state: "studying", label: "Изучается" });
});

test("состояния: закрытие доступа важнее прогресса", () => {
  const closed = { status: "published", closeDate: ts(NOW - DAY) };
  assert.deepEqual(studentTopicState(closed, NOW), { state: "closed", label: "Закрыта" });
  assert.deepEqual(
    studentTopicState(closed, NOW, { hasAttempts: true }),
    { state: "closed", label: "Закрыта" },
    "закрытие перекрывает и «завершена»");
});

test("состояния: просрочка сдачи без попыток, завершение с попытками", () => {
  const due = { status: "published", dueDate: ts(NOW - DAY) };
  assert.deepEqual(studentTopicState(due, NOW), { state: "overdue", label: "Просрочена" });
  assert.deepEqual(
    studentTopicState(due, NOW, { hasAttempts: true }),
    { state: "completed", label: "Завершена" });
});

test("состояния: до даты открытия — «Откроется», материалы скрыты", () => {
  const topic = { status: "published", openDate: ts(NOW + 2 * DAY) };
  assert.deepEqual(studentTopicState(topic, NOW), { state: "upcoming", label: "Откроется" });
});

test("план учёбы: «что сейчас» и «что дальше»", () => {
  const topics = [
    { id: "a", title: "Завершённая", status: "published" },
    { id: "b", title: "Доступная", status: "published" },
    { id: "c", title: "Будущая", status: "published", openDate: ts(NOW + DAY) },
    { id: "d", title: "Черновик", status: "draft" }
  ];
  const plan = studyPlan(topics, NOW, { completedTopicIds: new Set(["a"]) });
  assert.equal(plan.current.id, "b", "первая доступная незавершённая");
  assert.equal(plan.next.id, "c", "первая тема с будущим открытием");
  // Черновики не попадают в план
  assert.ok(plan.current.id !== "d" && plan.next?.id !== "d");
});

test("план учёбы: пустой список не ломается", () => {
  assert.deepEqual(studyPlan([], NOW), { current: null, next: null });
});

// ---------- Статусы ----------

test("статусы: подписи без смешивания с прогрессом ученика", () => {
  assert.equal(topicStatusLabel("draft"), "Черновик");
  assert.equal(topicStatusLabel("planned"), "Запланирована");
  assert.equal(topicStatusLabel("published"), "Опубликована");
  assert.equal(topicStatusLabel("active"), "Опубликована", "легаси = published");
  assert.equal(topicStatusLabel("archived"), "Архивирована");
});

// ---------- Календарь ----------

test("календарь: события строятся из дат тем и сроков заданий", () => {
  const topics = [
    {
      id: "t1", title: "Тема 1", status: "published", subjectId: "s1",
      lessonDate: ts(NOW), openDate: ts(NOW - DAY), dueDate: ts(NOW + DAY)
    },
    { id: "t2", title: "Архив", status: "archived", lessonDate: ts(NOW) },
    { id: "t3", title: "Без дат", status: "published" }
  ];
  const assignments = [
    { testTitle: "Контрольная", groupId: "g1", deadline: ts(NOW + 2 * DAY) },
    { testTitle: "Без срока", groupId: "g1", deadline: null }
  ];
  const events = buildScheduleEvents({ topics, assignments, nowMs: NOW });
  const kinds = events.map(e => e.kind);
  assert.ok(kinds.includes("lesson"), "занятие");
  assert.ok(kinds.includes("open"), "открытие");
  assert.ok(kinds.includes("due"), "срок сдачи");
  assert.ok(kinds.includes("assignment"), "срок задания");
  assert.ok(!events.some(e => e.title === "Архив"), "архивные темы не в расписании");
  assert.ok(!events.some(e => e.title === "Без срока"), "тема без дат не даёт событий");
  assert.ok(!events.some(e => e.title === "Без срока" && e.kind === "assignment"),
    "задание без срока — не событие");
  // Сортировка по времени
  for (let i = 1; i < events.length; i++) {
    assert.ok(events[i - 1].dateMs <= events[i].dateMs, "сортировка по времени");
  }
});

test("календарь: просроченные помечаются (срок < сейчас)", () => {
  const topics = [
    { id: "t1", title: "Просрочено", status: "published", dueDate: ts(NOW - DAY) },
    { id: "t2", title: "Впереди", status: "published", dueDate: ts(NOW + DAY) }
  ];
  const events = buildScheduleEvents({ topics, assignments: [], nowMs: NOW });
  assert.deepEqual(overdueEvents(events, NOW).map(e => e.title), ["Просрочено"]);
});

test("календарь: фильтрация по дисциплине и группе", () => {
  const events = buildScheduleEvents({
    topics: [
      { id: "t1", title: "A", status: "published", subjectId: "s1", groupId: "g1", lessonDate: ts(NOW) },
      { id: "t2", title: "B", status: "published", subjectId: "s2", groupId: "g2", lessonDate: ts(NOW) }
    ],
    assignments: [{ testTitle: "C", groupId: "g1", deadline: ts(NOW) }]
  });
  assert.equal(scheduleGroups(events).join(","), "g1,g2", "уникальные группы для селекта");
  assert.deepEqual(filterScheduleEvents(events, { subjectId: "s1" }).map(e => e.title),
    ["C", "A"], "дисциплина фильтрует темы, задания остаются");
  assert.deepEqual(filterScheduleEvents(events, { groupId: "g2" }).map(e => e.title),
    ["B"], "группа фильтрует события");
  assert.equal(filterScheduleEvents(events, {}).length, 3, "без фильтров — все события");
});

// ---------- Часовые пояса ----------

test("часовые пояса: даты без времени — границы дня не смещаются", () => {
  // Один и тот же момент времени описан через timestamp; локальная дата
  // вычисляется по локальной зоне и совпадает с input type=date.
  for (const iso of ["2026-01-01", "2026-06-15", "2026-12-31"]) {
    assert.equal(msToISODate(isoDateToMs(iso)), iso, `кругосветка ${iso}`);
  }
  // Переход через год
  assert.equal(msToISODate(isoDateToMs("2026-12-31") + DAY).startsWith("2027"), true);
});

// ---------- Статические проверки страниц ----------

test("страница темы: настройки содержат все поля этапа 4", () => {
  for (const key of ["title", "description", "status", "groupId",
    "lessonDate", "openDate", "closeDate", "publishDate", "dueDate"]) {
    assert.ok(TOPIC.includes(`key: "${key}"`), `поле настроек: ${key}`);
  }
});

test("страница темы: копирование, перенос, архивирование, удаление, порядок", () => {
  assert.ok(TOPIC.includes("copyTopic"), "копирование через core/subjects.copyTopic");
  assert.ok(TOPIC.includes("moveTopic"), "порядок через moveTopic");
  assert.ok(TOPIC.includes("Перенести"), "перенос в другую дисциплину");
  assert.ok(TOPIC.includes("Удалить тему?"), "удаление с подтверждением");
  assert.ok(TOPIC.includes("история попыток"), "удаление не уничтожает историю попыток");
  assert.ok(TOPIC.includes("В архив") || TOPIC.includes("Перевести тему в архив"),
    "архивирование");
});

test("страница темы: закрытые материалы скрыты до даты открытия", () => {
  assert.ok(TOPIC.includes('state === "upcoming"'), "состояние «откроется»");
  assert.ok(TOPIC.includes("Материалы скрыты"), "пометка о скрытых материалах");
});

test("страница темы: статусы темы и прогресс ученика не смешаны", () => {
  assert.ok(TOPIC.includes("topicStatusLabel"), "хранимый статус темы");
  assert.ok(TOPIC.includes("studentTopicState"), "вычисляемое состояние ученика");
});

test("календарь подключён: маршрут, пункт меню, фильтры", () => {
  assert.match(APP, /"calendar":\s*\{\s*file:\s*"ui\/pages\/calendar\.js"/);
  assert.ok(SIDEBAR.includes('route: "#calendar"'), "пункт «Расписание» в меню");
  assert.match(SIDEBAR, /lt\("nav\.calendar"\)/, "подпись меню — живой ключ локализации");
  assert.ok(CALENDAR.includes("calendar-subject-filter"), "фильтр по дисциплине");
  assert.ok(CALENDAR.includes("calendar-group-filter"), "фильтр по группе");
  assert.ok(CALENDAR.includes("Просроченные"), "блок просроченных");
});

test("безопасность: студенческий запрос тем повторяет ограничения правил", () => {
  // Правила — не фильтры: запрос студента обязан сам нести ограничения,
  // иначе любая тема чужой группы уронила бы весь список.
  assert.ok(SUBJECTS.includes('where("status", "in", STUDENT_TOPIC_STATUSES)'));
  assert.ok(SUBJECTS.includes('where("groupId", "in", groups)'));
  // Составной индекс для этого запроса объявлен
  assert.ok(INDEXES.includes('"groupId"'), "индекс topics c groupId в firestore.indexes.json");
});

test("безопасность: физическое удаление тем запрещено правилами", () => {
  const rules = readFileSync(path.join(ROOT, "firestore.rules"), "utf8");
  const topicsBlock = rules.slice(rules.indexOf("match /topics/"), rules.indexOf("match /rooms/"));
  assert.match(topicsBlock, /allow delete: if false/);
});
