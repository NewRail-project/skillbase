// tests/lesson-ui.test.js — редактор таблицы, экран отчёта, страницы занятий, маршруты.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { installFakeDom, findAll, findOne, text } from "./helpers/fake-dom.js";

register("./helpers/stub-loader.mjs", import.meta.url);
installFakeDom();
globalThis.__SB = { profile: { uid: "t1", role: "teacher", orgId: "o1" }, calls: [], staff: true, routeParam: "" };
const realWarn = console.warn; console.warn = (...a) => { if (!/Стили/.test(String(a[0]))) realWarn(...a); };
const realErr = console.error; console.error = (...a) => { if (!/Сценарии занятий|История занятий|Редактор занятия/.test(String(a[0]))) realErr(...a); };

const { buildPracticalEditor } = await import("../ui/components/practical-editor.js");
const { buildReportView } = await import("../ui/components/lesson-report-view.js");
const { buildLessonReport } = await import("../core/lesson-report.js");
const { normalizePlan, newRun } = await import("../core/lesson-plan.js");
const { splitTask, evaluateSubmission, compareTeams } = await import("../core/practical.js");

// ---------- редактор таблицы ----------

test("редактор: преподаватель строит свою таблицу — столбцы, строки, ответы, режимы", () => {
  const changes = [];
  const ed = buildPracticalEditor({ team: "a", task: null, onChange: t => changes.push(t) });
  // По умолчанию — простой вид; сложную таблицу включает кнопка режима.
  findOne(ed.el, e => e.tag === "button" && e.getAttribute("data-action") === "mode").click();
  // Название и описание.
  const title = findOne(ed.el, e => e.attrs.id === "pe-a-title");
  title.value = "Диагностика датчика"; title.dispatch("input");
  const desc = findOne(ed.el, e => e.attrs.id === "pe-a-desc");
  desc.value = "Заполните"; desc.dispatch("input");
  // + Столбец, + Строка.
  findAll(ed.el, e => e.tag === "button" && /＋ Столбец/.test(text(e)))[0].click();
  findAll(ed.el, e => e.tag === "button" && /＋ Строка/.test(text(e)))[0].click();
  let t = ed.getTask();
  assert.equal(t.columns.length, 3);
  assert.equal(t.rows.length, 2);
  assert.ok(t.rows.every(r => r.length === 3), "в каждой строке столько ячеек, сколько столбцов");
  // Ожидаемые ответы вводятся через «;».
  const accept = findOne(ed.el, e => e.tag === "input" && /ожидаемые ответы/.test(e.attrs["aria-label"] || ""));
  accept.value = "обрыв цепи; обрыв провода"; accept.dispatch("input");
  t = ed.getTask();
  const answer = t.rows.flat().find(c => c.t === "answer" && c.accept.length);
  assert.deepEqual(answer.accept, ["обрыв цепи", "обрыв провода"]);
  assert.equal(t.title, "Диагностика датчика");
  assert.ok(changes.length >= 4, "onChange вызывается при каждой правке");
  // Режим «Число»: допуск и единица.
  const mode = findAll(ed.el, e => e.tag === "select" && /способ проверки/.test(e.attrs["aria-label"] || ""))[0];
  mode.value = "number"; mode.dispatch("change");
  assert.ok(findOne(ed.el, e => e.tag === "input" && /допуск/.test(e.attrs["aria-label"] || "")));
  // Режим «Вручную»: ожидаемых ответов нет.
  const mode2 = findAll(ed.el, e => e.tag === "select" && /способ проверки/.test(e.attrs["aria-label"] || ""))[0];
  mode2.value = "manual"; mode2.dispatch("change");
  assert.match(text(ed.el), /проверит преподаватель вручную/);
});

test("редактор: нельзя удалить последний столбец и последнюю строку; setTask подменяет данные", () => {
  const ed = buildPracticalEditor({ team: "b" });
  findOne(ed.el, e => e.tag === "button" && e.getAttribute("data-action") === "mode").click();
  const delCol = findAll(ed.el, e => e.tag === "button" && /Удалить столбец/.test(e.attrs["aria-label"] || ""));
  assert.equal(delCol.length, 2);
  delCol[1].click();
  assert.equal(ed.getTask().columns.length, 1);
  assert.equal(findAll(ed.el, e => e.tag === "button" && /Удалить столбец/.test(e.attrs["aria-label"] || ""))[0].disabled, true);
  assert.equal(findAll(ed.el, e => e.tag === "button" && text(e) === "Удалить строку")[0].disabled, true);
  ed.setTask({ title: "Другое", columns: ["x", "y"], rows: [[{ t: "label", text: "a" }, { t: "answer", mode: "text", accept: ["1"] }]] });
  assert.equal(ed.getTask().title, "Другое");
  assert.equal(findOne(ed.el, e => e.attrs.id === "pe-b-title").value, "Другое");
});

test("простая таблица: название — число или слово, как обычный вопрос", () => {
  const changes = [];
  const ed = buildPracticalEditor({ team: "a", onChange: t => changes.push(t) });
  const q = (frag) => findOne(ed.el, e => e.tag === "input" && (e.attrs["aria-label"] || "").includes(frag));
  const sel = (frag) => findOne(ed.el, e => e.tag === "select" && (e.attrs["aria-label"] || "").includes(frag));
  assert.ok(findOne(ed.el, e => e.className === "pe-simple"));
  assert.equal(findOne(ed.el, e => e.className === "pe-simple").hidden, false);
  assert.equal(findOne(ed.el, e => e.className === "pe-advanced").hidden, true);
  // Строка 1: слово.
  q("Строка 1: название").value = "Номер датчика"; q("Строка 1: название").dispatch("input");
  q("Строка 1: правильный ответ").value = "датчик 4; Д4"; q("Строка 1: правильный ответ").dispatch("input");
  // Строка 2: число с допуском и единицей.
  findAll(ed.el, e => e.tag === "button" && /＋ Строка/.test(text(e)))[0].click();
  q("Строка 2: название").value = "Показание прибора"; q("Строка 2: название").dispatch("input");
  sel("Строка 2: тип ответа").value = "number"; sel("Строка 2: тип ответа").dispatch("change");
  q("Строка 2: правильный ответ").value = "12,5"; q("Строка 2: правильный ответ").dispatch("input");
  q("Строка 2: допуск").value = "0,1"; q("Строка 2: допуск").dispatch("input");
  q("Строка 2: единица").value = "В"; q("Строка 2: единица").dispatch("input");
  // Строка 3: проверит сам.
  findAll(ed.el, e => e.tag === "button" && /＋ Строка/.test(text(e)))[0].click();
  q("Строка 3: название").value = "Рекомендуемое действие"; q("Строка 3: название").dispatch("input");
  sel("Строка 3: тип ответа").value = "manual"; sel("Строка 3: тип ответа").dispatch("change");
  assert.match(text(ed.el), /проверите вы сами/);
  assert.equal(q("Строка 3: правильный ответ"), null, "для ручной проверки ключа нет");
  const t = ed.getTask();
  assert.deepEqual(t.columns, ["Параметр", "Значение"]);
  assert.deepEqual(t.rows.map(r => r[0].text), ["Номер датчика", "Показание прибора", "Рекомендуемое действие"]);
  assert.deepEqual(t.rows[0][1], { t: "answer", mode: "text", accept: ["датчик 4", "Д4"], points: 1 });
  assert.deepEqual([t.rows[1][1].mode, t.rows[1][1].accept, t.rows[1][1].tolerance, t.rows[1][1].unit], ["number", ["12,5"], 0.1, "В"]);
  assert.equal(t.rows[2][1].mode, "manual");
  assert.ok(changes.length >= 8);
});

test("простая таблица: заголовки столбцов, удаление строк, последняя строка не удаляется", () => {
  const ed = buildPracticalEditor({ team: "b" });
  const h0 = findOne(ed.el, e => e.attrs.id === "pe-b-h0");
  h0.value = "Параметр"; h0.dispatch("input");
  const h1 = findOne(ed.el, e => e.attrs.id === "pe-b-h1");
  h1.value = "Ответ"; h1.dispatch("input");
  assert.deepEqual(ed.getTask().columns, ["Параметр", "Ответ"]);
  const del = () => findAll(ed.el, e => e.tag === "button" && /Удалить строку/.test(e.attrs["aria-label"] || ""));
  assert.equal(del()[0].disabled, true);
  findAll(ed.el, e => e.tag === "button" && /＋ Строка/.test(text(e)))[0].click();
  assert.equal(del().length, 2);
  del()[1].click();
  assert.equal(ed.getTask().rows.length, 1);
});

test("режимы: сложная таблица открывается в расширенном виде, вернуться к простому можно только когда она простая", () => {
  const complex = { title: "Т", columns: ["a", "b", "c"], rows: [[{ t: "label", text: "x" }, { t: "answer", mode: "text", accept: ["1"] }, { t: "answer", mode: "text", accept: ["2"] }]] };
  const ed = buildPracticalEditor({ team: "a", task: complex });
  assert.equal(findOne(ed.el, e => e.className === "pe-advanced").hidden, false);
  const modeBtn = findOne(ed.el, e => e.tag === "button" && e.getAttribute("data-action") === "mode");
  assert.equal(modeBtn.disabled, true);
  assert.match(text(ed.el), /простой вид недоступен/);
  // Убираем лишний столбец — простой вид снова доступен, данные сохраняются.
  findAll(ed.el, e => e.tag === "button" && /Удалить столбец 3/.test(e.attrs["aria-label"] || ""))[0].click();
  const btn2 = findOne(ed.el, e => e.tag === "button" && e.getAttribute("data-action") === "mode");
  assert.equal(btn2.disabled, false);
  btn2.click();
  assert.equal(findOne(ed.el, e => e.className === "pe-simple").hidden, false);
  assert.equal(findOne(ed.el, e => e.tag === "input" && (e.attrs["aria-label"] || "") === "Строка 1: название").value, "x");
  // setTask подбирает режим сам.
  ed.setTask(complex);
  assert.equal(findOne(ed.el, e => e.className === "pe-advanced").hidden, false);
});

// ---------- отчёт ----------

const L = (t) => ({ t: "label", text: t });
const A = (accept) => ({ t: "answer", mode: "text", accept });
const task = (t) => ({ title: t, columns: ["П", "З"], rows: [[L("x"), A(["да"])]] });
const plan = normalizePlan({ topic: "Датчики", materialId: "m", entryTestId: "e", finalTestId: "f", tasks: { a: task("А"), b: task("Б") } });
const det = (uid, name, c) => ({ uid, name, status: "graded", grade: c * 9, earned: c, max: 10, answered: 10, total: 10, correctCount: c });
function sampleReport() {
  const a = splitTask(task("А")), b = splitTask(task("Б"));
  const ea = evaluateSubmission({ pub: a.publicTask, keys: a.keys, cells: { r0c1: "да" } });
  const eb = evaluateSubmission({ pub: b.publicTask, keys: b.keys, cells: { r0c1: "нет" } });
  return buildLessonReport({
    plan, run: { ...newRun(plan, { id: "R" }), done: { entry_test: 1 } }, hostName: "Иванов", dateMs: 1700000000000,
    entry: { studentsDetail: [det("u1", "Анна", 4), det("u2", "Очень Длинное Фамилия-Двойная Имя Отчество", 8)] },
    final: { studentsDetail: [det("u1", "Анна", 9)] },
    battle: { winner: "a", tie: false, scores: { a: 30, b: 10 }, players: [{ uid: "u1", teamId: "a", battleGrade: 80, accuracyPercent: 80, participationPercent: 100, participatedQuestions: 5, availableQuestions: 5 }] },
    practical: { tasks: { a: a.publicTask, b: b.publicTask }, evaluations: { a: ea, b: eb }, comparison: compareTeams(ea, eb), submissions: { a: { by: "u1" }, b: { by: "u9" } }, expected: { a: { r0c1: "да" } } }
  });
}

test("отчёт: общая статистика, победители, практические таблицы, честные «нет данных»", () => {
  const view = buildReportView(sampleReport());
  const t = text(view);
  assert.match(t, /Датчики/);
  assert.match(t, /преподаватель: Иванов/);
  assert.match(t, /участников: 2/);
  assert.match(t, /Победила Команда А/);
  assert.match(t, /счёт 30 : 10/);
  assert.match(t, /Команда А: А — 1 из 1/);
  assert.match(t, /Ожидается: да/, "ожидаемый ответ виден в отчёте преподавателя");
  assert.match(t, /Личный вклад: не оценён/);
  assert.match(t, /нет данных/, "у участника без итогового теста — «нет данных», не 0 %");
  assert.match(t, /не объективный уровень профессиональной компетентности/);
  assert.ok(findOne(view, e => e.className === "lr-table-wrap"), "таблица прокручивается внутри своего блока");
});

test("отчёт: состав рекомендации прозрачен, в режиме просмотра итоговая оценка не редактируется", () => {
  const view = buildReportView(sampleReport());
  const t = text(view);
  assert.match(t, /Входной тест: 40% × доля/);
  assert.match(t, /Практика \(результат команды\)/);
  assert.match(t, /Battle \(личная часть\)/);
  assert.equal(findAll(view, e => e.tag === "select").length, 0);
  assert.match(t, /не выставлена/);
});

test("отчёт: преподаватель сам выставляет итоговую оценку и основание", () => {
  const got = [];
  const view = buildReportView(sampleReport(), { editable: true, decisions: {}, onDecision: (uid, v) => got.push([uid, v]) });
  const sel = findOne(view, e => e.tag === "select" && /Итоговая оценка: Анна/.test(e.attrs["aria-label"] || ""));
  sel.value = "5"; sel.dispatch("change");
  const reason = findOne(view, e => e.tag === "input" && /Основание оценки: Анна/.test(e.attrs["aria-label"] || ""));
  reason.value = "Активна"; reason.dispatch("input");
  assert.deepEqual(got.at(-1), ["u1", { grade: 5, reason: "Активна" }]);
  sel.value = ""; sel.dispatch("change");
  assert.deepEqual(got.at(-1), ["u1", null], "оценку можно снять");
});

test("отчёт из истории показывается как записан, даже если в записи нет части полей", () => {
  const view = buildReportView({ lesson: { topic: "Старое занятие" }, people: [], summary: {}, stages: [], completion: {} });
  assert.match(text(view), /Старое занятие/);
  assert.match(text(view), /Выполнение занятия: 0%/);
});

// ---------- страницы и маршруты ----------

test("страница сценариев: без связи показывает понятную ошибку, а не падает", async () => {
  const mod = await import("../ui/pages/lessons.js");
  globalThis.__SB.routeParam = "";
  const page = await mod.default();
  await new Promise(r => setImmediate(r));
  assert.match(text(page), /Сценарии занятий/);
  assert.ok(findOne(page, e => e.attrs.role === "alert") || /Сценариев пока нет/.test(text(page)));
  assert.ok(!/permission-denied|TypeError|undefined/.test(text(page)));
});

test("страница истории: пустой/ошибочный список — понятный текст", async () => {
  const mod = await import("../ui/pages/lesson-history.js");
  const page = await mod.default();
  await new Promise(r => setImmediate(r));
  assert.match(text(page), /Проведённые занятия/);
  assert.ok(!/TypeError|undefined/.test(text(page)));
});

test("маршруты занятия доступны только сотрудникам; пункт меню — преподавателю и администратору", () => {
  const app = readFileSync(new URL("../shared/app.js", import.meta.url), "utf8");
  for (const route of ["lessons", "lesson-history", "lesson-report"]) {
    assert.match(app, new RegExp(`"${route}":\\s*\\{[^}]*auth: true, roles: STAFF`), `маршрут ${route}`);
  }
  const side = readFileSync(new URL("../ui/components/sidebar.js", import.meta.url), "utf8");
  assert.match(side, /id: "lessons"[^}]*roles: \["teacher", "admin"\]/);
});
