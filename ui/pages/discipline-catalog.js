// ui/pages/discipline-catalog.js — каталог дисциплин (#disciplines).
// Карточки дисциплин с поиском; клик открывает отдельную страницу
// дисциплины (#discipline/<id>) со списком тем. Персонал создаёт дисциплины.
import { h } from "../../shared/dom.js";
import { isStaff } from "../../core/auth.js";
import { lt } from "../../core/i18n.js";
import { getSubjects, getTopics, createSubject } from "../../core/subjects.js";
import { TITLE_MAX, DESCRIPTION_MAX, STATUS_ARCHIVED, activeTopics, shortDescription, nextScheduledTopic } from "../../core/subjects-logic.js";
import { formatTopicDate, dateMs } from "../../core/schedule-logic.js";
import { formDialog } from "../components/form-dialog.js";
import { toast } from "../components/toast.js";
import { loading } from "../components/loading.js";
import { error as errorState } from "../components/error.js";

function nearestTopic(topics) {
  const now = Date.now();
  const dated = topics
    .map(t => ({ t, ms: dateMs(t.dueDate) ?? dateMs(t.lessonDate) }))
    .filter(x => x.ms !== null && x.ms >= now)
    .sort((a, b) => a.ms - b.ms);
  return dated[0]?.t || null;
}

function topicsWord(n) {
  const a = n % 10, b = n % 100;
  if (n === 1) return "1 тема";
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return `${n} темы`;
  return `${n} тем`;
}

export default async function DisciplineCatalogPage() {
  const page = h("div", { class: "page" });
  const staff = isStaff();
  const body = h("div", {});
  const search = h("input", { type: "search", placeholder: "Найти дисциплину", "aria-label": "Поиск дисциплины", class: "input" });
  const state = { items: [], query: "" };

  const addBtn = staff ? h("button", { type: "button", class: "btn primary", onclick: () => openCreate() }, "Добавить дисциплину") : null;
  page.append(
    h("div", { class: "page-head" },
      h("div", {},
        h("div", { class: "eyebrow" }, staff ? "Управление" : "Обучение"),
        h("h1", {}, lt("title.disciplines")),
        h("p", { class: "page-sub" }, "Выберите дисциплину, чтобы открыть её темы, материалы и тесты.")),
      staff ? h("div", { class: "page-head-actions" }, addBtn) : null),
    h("div", { class: "field" }, search),
    body);

  search.addEventListener("input", () => { state.query = search.value.trim().toLowerCase(); draw(); });

  async function load() {
    body.replaceChildren(loading());
    try {
      const subjects = (await getSubjects()).filter(s => staff || s.status !== STATUS_ARCHIVED);
      const lists = await Promise.all(subjects.map(s => getTopics(s.id).catch(() => [])));
      state.items = subjects.map((subject, i) => ({ subject, topics: lists[i] }));
      draw();
    } catch (err) {
      console.error("Каталог дисциплин:", err);
      body.replaceChildren(errorState({ text: err?.message || "Не удалось загрузить дисциплины.", onRetry: load }));
    }
  }

  function draw() {
    const items = state.items.filter(({ subject }) =>
      !state.query || `${subject.title} ${subject.description || ""}`.toLowerCase().includes(state.query));
    if (!items.length) {
      body.replaceChildren(h("section", { class: "panel" }, h("div", { class: "empty-state" },
        h("h2", {}, state.query ? "Ничего не найдено" : "Дисциплин пока нет"),
        h("p", { class: "muted" }, state.query ? "Попробуйте изменить запрос."
          : staff ? "Создайте первую дисциплину кнопкой выше."
          : "Преподаватели ещё не завели дисциплины."))));
      return;
    }
    body.replaceChildren(h("div", { class: "card-grid" }, items.map(({ subject, topics }) => {
      const count = activeTopics(topics).length;
      // Ближайший срок: сначала запланированная дата старого образца (startDate),
      // иначе ближайший срок сдачи или занятия среди активных тем.
      const next = nextScheduledTopic(topics) || nearestTopic(activeTopics(topics));
      return h("a", { class: "panel discipline-card", href: `#discipline/${encodeURIComponent(subject.id)}` },
        h("div", { class: "panel-body" },
          h("h2", {}, subject.title),
          typeof subject.teacher === "string" && subject.teacher.trim()
            ? h("p", { class: "muted" }, `Преподаватель: ${subject.teacher.trim()}`) : null,
          subject.description ? h("p", { class: "muted" }, shortDescription(subject.description, 140)) : null,
          next ? h("p", { class: "muted" }, `Ближайшие сроки: ${next.title}`) : null,
          h("div", { class: "btn-row" },
            h("span", { class: "badge badge-neutral" }, topicsWord(count)),
            subject.status === STATUS_ARCHIVED ? h("span", { class: "badge badge-warning" }, "В архиве") : null)));
    })));
  }

  async function openCreate() {
    await formDialog({
      idPrefix: "discipline-create", title: "Новая дисциплина",
      fields: [
        { key: "title", label: "Название дисциплины", maxlength: TITLE_MAX },
        { key: "description", label: "Описание (необязательно)", type: "textarea", maxlength: DESCRIPTION_MAX }
      ],
      submitLabel: "Создать",
      onSubmit: async (v) => {
        try { await createSubject({ title: v.title, description: v.description }); }
        catch (err) { return err?.message || "Не удалось создать дисциплину."; }
        toast("Дисциплина создана", "success");
        await load();
        return null;
      }
    });
  }

  await load();
  return page;
}
