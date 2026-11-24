// ui/pages/lessons.js — сценарии занятий (#lessons): список, редактор, запуск.
//   #lessons        — мои сценарии
//   #lessons/new    — новый сценарий
//   #lessons/<id>   — редактирование
//
// Сценарий связывает существующие механизмы: материал → входной тест (Live) →
// Battle → практика (две таблицы) → итоговый тест → отчёт. Здесь только
// подготовка: тесты, материалы и Battle создаются и проводятся штатными
// страницами. Ожидаемые ответы практики хранятся в закрытом документе плана
// (только сотрудники организации) и участникам не передаются.
import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { loadCss } from "../../shared/load-css.js";
import { loadTest, listMyTests } from "../../core/editor.js";
import { hasMaterial } from "../../core/materials.js";
import {
  listLessonPlans, loadLessonPlan, saveLessonPlan, deleteLessonPlan, startLesson, lessonErrorText
} from "../../core/lesson-store.js";
import {
  emptyPlan, normalizePlan, validatePlan, OPTIONAL_STAGES, STAGE_LABEL
} from "../../core/lesson-plan.js";
import { buildPracticalEditor } from "../components/practical-editor.js";
import { toast } from "../components/toast.js";

export default async function LessonsPage() {
  try { await loadCss("ui/css/lessons.css"); } catch (err) { console.warn("Стили занятий не загрузились:", err); }
  const param = decodeURIComponent((State.routeParam || "").split("/")[0] || "");
  return param ? editorPage(param === "new" ? null : param) : listPage();
}

const STAGE_HINT = {
  material: "Участники читают материал до начала.",
  entry_test: "Live-комната с тестом.",
  battle: "Командная битва после входного теста.",
  practical: "Две таблицы-задания, по одной на команду.",
  final_test: "Вторая Live-комната с итоговым тестом."
};

// ---------- Список ----------

async function listPage() {
  const body = h("div", {}, h("div", { class: "spinner" }));
  const page = h("div", { class: "page lessons-page" },
    h("div", { class: "page-head" },
      h("div", {}, h("div", { class: "eyebrow" }, "Открытое занятие"), h("h1", {}, "Сценарии занятий"),
        h("p", { class: "page-sub" }, "Материал, входной тест, Battle, практика, итоговый тест и отчёт — одним сценарием.")),
      h("div", { class: "page-head-actions" },
        h("a", { class: "btn secondary", href: "#lesson-history" }, "История занятий"),
        h("a", { class: "btn primary", href: "#lessons/new" }, "Новый сценарий"))),
    body);
  try {
    const plans = await listLessonPlans();
    body.replaceChildren(plans.length ? h("div", { class: "lessons-grid" }, ...plans.map(planCard))
      : h("div", { class: "panel" }, h("div", { class: "empty-state" },
        h("h2", {}, "Сценариев пока нет"),
        h("p", { class: "muted" }, "Создайте сценарий: выберите тему, материал, тесты и подготовьте задания практики."))));
  } catch (err) {
    console.error("Сценарии занятий:", err);
    body.replaceChildren(h("p", { class: "form-error", role: "alert" }, lessonErrorText(err)));
  }
  return page;
}

function planCard({ id, plan }) {
  const on = OPTIONAL_STAGES.filter(s => plan.stages[s]);
  const status = h("p", { class: "form-hint", role: "status" }, "");
  let starting = false;
  const startBtn = h("button", { type: "button", class: "btn primary" }, "Запустить занятие");
  startBtn.addEventListener("click", async () => {
    if (starting) return; // защита от повторного нажатия
    starting = true; startBtn.disabled = true; status.textContent = "Создаём комнату…";
    try {
      const test = await loadTest(plan.entryTestId || plan.finalTestId);
      const code = await startLesson({ planId: id, plan, test, profile: State.profile });
      toast(`Занятие запущено. Код комнаты: ${code}`, "success");
      window.location.hash = `#room/${code}`;
    } catch (err) {
      console.error("Запуск занятия:", err);
      status.textContent = lessonErrorText(err);
      status.setAttribute("role", "alert");
      starting = false; startBtn.disabled = false;
    }
  });
  const del = h("button", { type: "button", class: "btn secondary" }, "Удалить");
  del.addEventListener("click", async () => {
    if (!window.confirm(`Удалить сценарий «${plan.topic}»? Проведённые занятия в истории не изменятся.`)) return;
    try { await deleteLessonPlan(id); window.location.hash = "#lessons"; window.location.reload(); }
    catch (err) { status.textContent = lessonErrorText(err); }
  });
  return h("article", { class: "panel lesson-card" },
    h("h2", {}, plan.topic || "Без темы"),
    plan.subjectName ? h("p", { class: "muted" }, plan.subjectName) : null,
    h("ol", { class: "lesson-stage-list" }, ...on.map(s => h("li", {}, STAGE_LABEL[s]))),
    h("div", { class: "btn-row" }, startBtn, h("a", { class: "btn secondary", href: `#lessons/${encodeURIComponent(id)}` }, "Изменить"), del),
    status);
}

// ---------- Редактор ----------

async function editorPage(id) {
  const page = h("div", { class: "page lessons-page" }, h("div", { class: "spinner" }));
  let plan = emptyPlan();
  let tests = [];
  const withBook = new Set();
  try {
    if (id) plan = (await loadLessonPlan(id)) || emptyPlan();
    tests = await listMyTests(State.user?.uid, State.profile?.orgId, State.profile?.role || "teacher");
    const flags = await Promise.all(tests.map(async t => [t.id, await hasMaterial(t.id)]));
    flags.forEach(([tid, ok]) => { if (ok) withBook.add(tid); });
  } catch (err) {
    console.error("Редактор занятия:", err);
    page.replaceChildren(h("p", { class: "form-error", role: "alert" }, lessonErrorText(err)));
    return page;
  }

  const published = tests.filter(t => t.status === "published");
  const titleOf = (list, tid) => list.find(t => t.id === tid)?.title || "";
  const select = (idAttr, list, value, empty) => {
    const el = h("select", { id: idAttr },
      h("option", { value: "" }, empty),
      ...list.map(t => h("option", { value: t.id, selected: t.id === value }, t.title || t.id)));
    el.value = value || "";
    return el;
  };
  const text = (idAttr, value, extra = {}) => { const el = h("input", { id: idAttr, type: "text", ...extra }); el.value = value || ""; return el; };
  const num = (idAttr, value) => { const el = h("input", { id: idAttr, type: "number", inputmode: "numeric", min: "0", max: "100" }); el.value = String(value); return el; };

  const topic = text("ls-topic", plan.topic, { maxlength: "160" });
  const subject = text("ls-subject", plan.subjectName, { maxlength: "120" });
  const material = select("ls-material", tests.filter(t => withBook.has(t.id)), plan.materialId, "— выберите материал (тест с книгой) —");
  const entry = select("ls-entry", published, plan.entryTestId, "— выберите опубликованный тест —");
  const fin = select("ls-final", published, plan.finalTestId, "— выберите опубликованный тест —");
  const stageBoxes = {};
  const stageRows = OPTIONAL_STAGES.map(s => {
    const cb = h("input", { id: `ls-stage-${s}`, type: "checkbox", checked: plan.stages[s] });
    cb.checked = plan.stages[s];
    stageBoxes[s] = cb;
    cb.addEventListener("change", sync);
    return h("label", { class: "ls-stage", for: `ls-stage-${s}` }, cb, h("span", {}, h("b", {}, STAGE_LABEL[s]), h("small", {}, STAGE_HINT[s])));
  });
  const w = { entry: num("ls-w-entry", plan.grading.weights.entry), battle: num("ls-w-battle", plan.grading.weights.battle), practical: num("ls-w-practical", plan.grading.weights.practical), final: num("ls-w-final", plan.grading.weights.final) };
  const th = { five: num("ls-t-five", plan.grading.thresholds.five), four: num("ls-t-four", plan.grading.thresholds.four), three: num("ls-t-three", plan.grading.thresholds.three) };
  const editors = { a: buildPracticalEditor({ team: "a", task: plan.tasks.a }), b: buildPracticalEditor({ team: "b", task: plan.tasks.b }) };
  const practicalBox = h("section", { class: "panel", "aria-label": "Практическая диагностика" },
    h("h2", {}, "Практическая диагностика"),
    h("p", { class: "muted" }, "Две разных таблицы. Ожидаемые ответы видны только вам: участникам уходит таблица без них."),
    editors.a.el, editors.b.el);
  const errors = h("div", { class: "form-error", role: "alert" });
  const status = h("p", { class: "form-hint", role: "status" }, "");

  function sync() { practicalBox.hidden = !stageBoxes.practical.checked; }
  sync();

  const collect = () => normalizePlan({
    topic: topic.value, subjectName: subject.value,
    materialId: material.value, materialTitle: titleOf(tests, material.value),
    entryTestId: entry.value, entryTestTitle: titleOf(tests, entry.value),
    finalTestId: fin.value, finalTestTitle: titleOf(tests, fin.value),
    stages: Object.fromEntries(OPTIONAL_STAGES.map(s => [s, stageBoxes[s].checked])),
    tasks: { a: editors.a.getTask(), b: editors.b.getTask() },
    grading: { weights: Object.fromEntries(Object.entries(w).map(([k, el]) => [k, el.value])), thresholds: Object.fromEntries(Object.entries(th).map(([k, el]) => [k, el.value])) }
  });

  let saving = false;
  const saveBtn = h("button", { type: "button", class: "btn primary" }, "Сохранить сценарий");
  saveBtn.addEventListener("click", async () => {
    if (saving) return;
    const next = collect();
    const problems = validatePlan(next);
    errors.replaceChildren(...problems.map(p => h("p", {}, p)));
    if (problems.length) return;
    saving = true; saveBtn.disabled = true; status.textContent = "Сохраняем…";
    try {
      await saveLessonPlan(id, next);
      toast("Сценарий сохранён.", "success");
      window.location.hash = "#lessons";
    } catch (err) {
      console.error("Сохранение сценария:", err);
      errors.replaceChildren(h("p", {}, lessonErrorText(err)));
      status.textContent = "";
      saving = false; saveBtn.disabled = false;
    }
  });

  const field = (idAttr, label, control, hint) => h("div", { class: "ls-field" }, h("label", { for: idAttr }, label), control, hint ? h("small", { class: "form-hint" }, hint) : null);
  page.replaceChildren(
    h("div", { class: "page-head" },
      h("div", {}, h("div", { class: "eyebrow" }, "Открытое занятие"), h("h1", {}, id ? "Изменить сценарий" : "Новый сценарий")),
      h("div", { class: "page-head-actions" }, h("a", { class: "btn secondary", href: "#lessons" }, "К списку"))),
    h("section", { class: "panel" },
      h("h2", {}, "Основное"),
      field("ls-topic", "Тема занятия", topic),
      field("ls-subject", "Предмет (необязательно)", subject)),
    h("section", { class: "panel" }, h("h2", {}, "Этапы"), h("div", { class: "ls-stages" }, ...stageRows)),
    h("section", { class: "panel" },
      h("h2", {}, "Материал и тесты"),
      field("ls-material", "Теоретический материал", material, "Материал открывается в обычной читалке, включая книжный режим."),
      field("ls-entry", "Входной тест", entry),
      field("ls-final", "Итоговый тест", fin, "Короткий тест после практики. Можно выбрать тот же тест, что и входной.")),
    practicalBox,
    h("section", { class: "panel" },
      h("h2", {}, "Рекомендуемая оценка"),
      h("p", { class: "muted" }, "Веса компонентов. Если какого-то результата нет (этап отключён, пропущен, участник отсутствовал), его вес перераспределяется между остальными, а не превращается в ноль."),
      h("div", { class: "ls-grid" },
        field("ls-w-entry", "Вес: входной тест", w.entry), field("ls-w-battle", "Вес: Battle (личная часть)", w.battle),
        field("ls-w-practical", "Вес: практика (команда)", w.practical), field("ls-w-final", "Вес: итоговый тест", w.final)),
      h("div", { class: "ls-grid" },
        field("ls-t-five", "«5» от, %", th.five), field("ls-t-four", "«4» от, %", th.four), field("ls-t-three", "«3» от, %", th.three)),
      h("p", { class: "form-hint" }, "Это только рекомендация. Окончательную оценку вы выставляете сами в отчёте.")),
    errors, h("div", { class: "btn-row" }, saveBtn), status);
  return page;
}
