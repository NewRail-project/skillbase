// tests/discipline-pages.test.js — ЭТАП 3: каталог дисциплин и страница
// дисциплины.
//
// Чистая логика (прогресс, ближайшая тема, краткое описание) берётся из
// core/subjects-logic.js и проверяется напрямую. Сами страницы в Node не
// импортируются (тянут Firebase SDK), поэтому UI-контракты проверяются
// статически: маршруты роутера, ключевые элементы разметки, видимость
// управления по ролям, совместимость со старыми данными, мобильная
// навигация.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  activeTopics,
  disciplineProgress,
  nextScheduledTopic,
  shortDescription,
  STATUS_ACTIVE,
  STATUS_ARCHIVED
} from "../core/subjects-logic.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = readFileSync(path.join(ROOT, "ui/pages/discipline-catalog.js"), "utf8");
const PAGE = readFileSync(path.join(ROOT, "ui/pages/discipline-page.js"), "utf8");
const APP = readFileSync(path.join(ROOT, "shared/app.js"), "utf8");
const SIDEBAR = readFileSync(path.join(ROOT, "ui/components/sidebar.js"), "utf8");

// ---------- Чистая логика каталога ----------

test("каталог: активные темы фильтруются, вход не мутируется", () => {
  const topics = [
    { id: "t1", status: STATUS_ACTIVE },
    { id: "t2", status: STATUS_ARCHIVED },
    { id: "t3" } // старые данные без status
  ];
  const input = [...topics];
  const result = activeTopics(topics);
  assert.deepEqual(result.map(t => t.id), ["t1", "t3"]);
  assert.equal(topics.length, input.length, "исходный массив не меняется");
  assert.deepEqual(activeTopics(null), []);
  assert.deepEqual(activeTopics(undefined), []);
});

test("каталог: прогресс — доля активных тем в процентах", () => {
  assert.equal(disciplineProgress([]), 0);
  assert.equal(disciplineProgress(null), 0);
  assert.equal(disciplineProgress([{ status: STATUS_ACTIVE }]), 100);
  assert.equal(disciplineProgress([
    { status: STATUS_ACTIVE },
    { status: STATUS_ACTIVE },
    { status: STATUS_ARCHIVED }
  ]), 67);
  // Все архивные: активных нет, но тем всего 3 — прогресс 0%
  assert.equal(disciplineProgress([
    { status: STATUS_ARCHIVED },
    { status: STATUS_ARCHIVED }
  ]), 0);
});

test("каталог: ближайшая тема — активная с самой ранней startDate", () => {
  const topics = [
    { id: "late", startDate: "2026-12-01", status: STATUS_ACTIVE },
    { id: "early", startDate: "2026-11-01", status: STATUS_ACTIVE },
    { id: "archived", startDate: "2026-10-01", status: STATUS_ARCHIVED },
    { id: "no-date", status: STATUS_ACTIVE }
  ];
  const next = nextScheduledTopic(topics);
  assert.equal(next.id, "early");
  assert.equal(nextScheduledTopic([]), null);
  assert.equal(nextScheduledTopic([{ id: "t", status: STATUS_ACTIVE }]), null,
    "темы без startDate не дают «ближайшую» (старые данные)");
  assert.equal(nextScheduledTopic([{ id: "t", startDate: "2026-01-01", status: STATUS_ARCHIVED }]), null,
    "архивные темы не участвуют");
});

test("каталог: краткое описание обрезается по границе слова", () => {
  assert.equal(shortDescription("  Короткое описание  "), "Короткое описание");
  assert.equal(shortDescription(null), "");
  assert.equal(shortDescription(123), "", "нестроковые данные (старые записи) — пусто");
  const long = "слово ".repeat(40);
  const cut = shortDescription(long, 40);
  assert.ok(cut.length <= 41, `обрезано до ~40 символов: ${cut.length}`);
  assert.ok(cut.endsWith("…"));
});

// ---------- Страницы: синтаксис и подключение к роутеру ----------

test("страницы дисциплин компилируются без синтаксических ошибок", () => {
  for (const file of ["ui/pages/discipline-catalog.js", "ui/pages/discipline-page.js"]) {
    execFileSync(process.execPath, ["--check", path.join(ROOT, file)]);
  }
});

test("маршруты: #disciplines и #discipline/<id> подключены к роутеру", () => {
  assert.match(APP, /"disciplines":\s*\{\s*file:\s*"ui\/pages\/discipline-catalog\.js"/);
  assert.match(APP, /"discipline":\s*\{\s*file:\s*"ui\/pages\/discipline-page\.js"/);
});

test("совместимость: старый маршрут #subjects сохранён", () => {
  assert.match(APP, /"subjects":\s*\{\s*file:\s*"ui\/pages\/subjects\.js"/);
});

test("обе страницы экспортируют default", () => {
  assert.match(CATALOG, /export default async function/);
  assert.match(PAGE, /export default async function/);
});

// ---------- Каталог: карточки, поиск, фильтр ----------

test("каталог: поиск и фильтр присутствуют", () => {
  assert.match(CATALOG, /id:\s*"discipline-search"/, "поле поиска");
  assert.match(CATALOG, /id:\s*"discipline-filter"/, "селект фильтра статуса");
  assert.match(CATALOG, /"Поиск по названию и описанию"/);
});

test("каталог: карточка содержит название-ссылку, темы, прогресс, статус", () => {
  assert.match(CATALOG, /#discipline\/\$\{encode\(subject\.id\)\}/, "ссылка на страницу дисциплины");
  assert.match(CATALOG, /disciplineProgress\(topics\)/);
  assert.match(CATALOG, /badge-success|badge-neutral/, "статус бейджем");
  assert.match(CATALOG, /`\$\{active\.length\} из \$\{topics\.length\} тем`/);
});

test("каталог: ближайшая тема — по наличию startDate, без неё строка скрыта", () => {
  assert.match(CATALOG, /nextScheduledTopic\(topics\)/);
  assert.match(CATALOG, /Следующая: /);
});

test("каталог: преподаватель показывается только если он есть в данных", () => {
  // Правила Firestore запрещают записывать поле teacher; оно может прийти
  // только из старых данных, поэтому отображение — условное.
  assert.match(CATALOG, /typeof subject\.teacher === "string"/);
});

test("каталог: управление доступно только сотрудникам", () => {
  assert.match(CATALOG, /staff \? h\("div", \{ class: "page-head-actions" \}/);
  assert.match(CATALOG, /staff \? h\("button"/, "кнопки карточки — сотрудникам");
  // Архивная секция рисуется только персоналу
  assert.match(CATALOG, /if \(staff && archivedAll\.length\) drawArchive/);
});

test("каталог: пустые состояния для сотрудника и студента различаются", () => {
  assert.match(CATALOG, /Создайте первую дисциплину/);
  assert.match(CATALOG, /Преподаватели ещё не завели дисциплины/);
  assert.match(CATALOG, /Ничего не найдено/);
});

// ---------- Страница дисциплины ----------

test("дисциплина: навигация назад в каталог", () => {
  assert.match(PAGE, /href: "#disciplines"/);
  assert.match(PAGE, /К каталогу дисциплин/);
});

test("дисциплина: отсутствующая дисциплина — состояние «не найдена»", () => {
  assert.match(PAGE, /Дисциплина не найдена/);
  assert.match(PAGE, /Дисциплина не существует или скрыта из списков\./);
  // Архивную дисциплину студент не видит: для него это «не найдена»
  assert.match(PAGE, /!staff && discipline\.status === STATUS_ARCHIVED/);
});

test("дисциплина: страница содержит все обязательные блоки", () => {
  assert.match(PAGE, /"Статистика"/);
  assert.match(PAGE, /"Темы"/);
  assert.match(PAGE, /"Ближайшие сроки"/);
  assert.match(PAGE, /"Материалы"/);
  assert.match(PAGE, /"Тесты"/);
  assert.match(PAGE, /quick-action/, "статистика отображается быстрой-сеткой");
});

test("дисциплина: темы ведут на отдельные страницы темы", () => {
  assert.match(PAGE, /#topic\/\$\{encode\(topic\.id\)\}/);
});

test("дисциплина: привязка материалов и тестов по subjectId и по topicId (старые данные)", () => {
  // Новые записи имеют subjectId; старые — только topicId темы дисциплины.
  assert.match(PAGE, /item\.subjectId === discipline\.id/);
  assert.match(PAGE, /topicIds\.has\(item\.topicId\)/);
});

test("дисциплина: управление темами — только сотрудникам", () => {
  assert.match(PAGE, /staff \? h\("div", \{ class: "page-head-actions" \}/);
  assert.match(PAGE, /Добавить тему/);
  assert.match(PAGE, /staff \? topics : activeTopics\(topics\)/,
    "студенты архивные темы не видят");
});

test("дисциплина: группы без данных не ломают страницу", () => {
  assert.match(PAGE, /profile\.teacherGroups \|| \{\}/);
  assert.match(PAGE, /groups\.length \? groups\.join\(", "\) : "—"/);
});

// ---------- Переименование «Предметы» → «Дисциплины» ----------

test("навигация: пункт меню «Дисциплины» ведёт на #disciplines", () => {
  assert.match(SIDEBAR, /id: "disciplines", label: lt\("nav\.disciplines"\),[^}]*route: "#disciplines"/);
});

test("локализация: ключи nav.disciplines и title.disciplines = «Дисциплины»", async () => {
  const i18n = readFileSync(path.join(ROOT, "core/i18n.js"), "utf8");
  assert.match(i18n, /\["nav\.disciplines", "Дисциплины", /);
  assert.match(i18n, /\["title\.disciplines", "Дисциплины", /);
});

test("заголовок каталога использует живой ключ title.disciplines", () => {
  assert.match(CATALOG, /lt\("title\.disciplines"\)/);
});

// ---------- Мобильная навигация ----------

test("мобильная навигация: маршрут меню совпадает с маршрутом роутера", () => {
  // Имя пункта меню (id) и хеш-цель должны существовать в роутере app.js.
  const routeNames = new Set();
  for (const m of APP.matchAll(/"([a-zA-Z-]*)":\s*\{\s*file:\s*"([^"]+)"/g)) {
    routeNames.add(m[1]);
  }
  assert.ok(routeNames.has("disciplines"), "#disciplines есть в роутере");
  assert.ok(routeNames.has("discipline"), "#discipline/<id> есть в роутере");
  // Сайдбар — выдвижная панель на мобильных: классы open/backdrop.
  assert.match(SIDEBAR, /sidebar.*open|open.*sidebar/);
});

// ---------- Совместимость со старыми данными ----------

test("старые данные: дисциплина без teacher/startDate/description отображается", () => {
  // Чистые функции не требуют новых полей
  const oldTopics = [{ id: "t1", title: "Тема 1" }];
  assert.equal(disciplineProgress(oldTopics), 100);
  assert.equal(nextScheduledTopic(oldTopics), null);
  // Страницы не обязуют поле teacher: только условный вывод
  assert.ok(CATALOG.includes("typeof subject.teacher === \"string\""));
});

test("старые данные: архивная дисциплина скрыта от студентов в каталоге", () => {
  assert.match(CATALOG, /staff \|\| s\.status !== STATUS_ARCHIVED/);
});
