// ui/pages/discipline-catalog.js — каталог дисциплин (#disciplines).
// Карточки дисциплин с поиском и фильтром статуса; клик открывает отдельную
// страницу дисциплины (#discipline/<id>) со списком тем. Персонал управляет
// дисциплинами и видит архив; студенты — только активные.
import { h } from "../../shared/dom.js";
import { isStaff } from "../../core/auth.js";
import { lt } from "../../core/i18n.js";
import { getSubjects, getTopics, createSubject, updateSubject } from "../../core/subjects.js";
import { TITLE_MAX, DESCRIPTION_MAX, STATUS_ARCHIVED, STATUS_ACTIVE, activeTopics, disciplineProgress, shortDescription, nextScheduledTopic } from "../../core/subjects-logic.js";
import { formatTopicDate, dateMs } from "../../core/schedule-logic.js";
import { formDialog } from "../components/form-dialog.js";
import { confirmAction } from "../components/confirm.js";
import { toast } from "../components/toast.js";
import { loading } from "../components/loading.js";
import { error as errorState } from "../components/error.js";

const encode = encodeURIComponent;

function nearestTopic(topics) {
  const now = Date.now();
  const dated = topics
    .map(t => ({ t, ms: dateMs(t.dueDate) ?? dateMs(t.lessonDate) }))
    .filter(x => x.ms !== null && x.ms >= now)
    .sort((a, b) => a.ms - b.ms);
  return dated[0]?.t || null;
}

export default async function DisciplineCatalogPage() {
  const page = h("div", { class: "page" });
  const staff = isStaff();
  const body = h("div", {});
  const search = h("input", {
    type: "search",
    id: "discipline-search",
    placeholder: "Поиск по названию и описанию",
    "aria-label": "Поиск по названию и описанию"
  });
  const filter = h("select", {
    id: "discipline-filter",
    "aria-label": "Фильтр по статусу",
    onchange: () => { state.filter = filter.value; draw(); }
  },
  h("option", { value: "all" }, "Все дисциплины"),
  h("option", { value: "active", selected: true }, "Активные"),
  h("option", { value: "archived" }, "В архиве"));
  const state = { items: [], query: "", filter: "active" };

  const addBtn = staff ? h("button", { type: "button", class: "btn primary", onclick: () => openCreate() }, "Добавить дисциплину") : null;
  page.append(
    h("div", { class: "page-head" },
      h("div", {},
        h("div", { class: "eyebrow" }, staff ? "Управление" : "Обучение"),
        h("h1", {}, lt("title.disciplines")),
        h("p", { class: "page-sub" }, "Выберите дисциплину, чтобы открыть её темы, материалы и тесты.")),
      staff ? h("div", { class: "page-head-actions" }, addBtn) : null),
    h("div", { class: "filters" }, search, filter),
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

  function matchFilter(status) {
    if (state.filter === "active") return status !== STATUS_ARCHIVED;
    if (state.filter === "archived") return status === STATUS_ARCHIVED;
    return true;
  }

  function draw() {
    const items = state.items.filter(({ subject }) =>
      matchFilter(subject.status) &&
      (!state.query || `${subject.title} ${subject.description || ""}`.toLowerCase().includes(state.query)));
    const active = items.filter(({ subject }) => subject.status !== STATUS_ARCHIVED);
    const archivedAll = items.filter(({ subject }) => subject.status === STATUS_ARCHIVED);
    if (!state.items.length) {
      body.replaceChildren(h("section", { class: "panel" }, h("div", { class: "empty-state" },
        h("h2", {}, "Дисциплин пока нет"),
        h("p", { class: "muted" }, staff
          ? "Создайте первую дисциплину кнопкой выше."
          : "Преподаватели ещё не завели дисциплины."))));
      return;
    }
    if (!items.length) {
      body.replaceChildren(h("section", { class: "panel" }, h("div", { class: "empty-state" },
        h("h2", {}, "Ничего не найдено"),
        h("p", { class: "muted" }, "Попробуйте изменить запрос или фильтр."))));
      return;
    }
    const result = [];
    if (active.length) result.push(h("div", { class: "card-grid" }, active.map(card)));
    if (staff && archivedAll.length) drawArchive(result, archivedAll);
    body.replaceChildren(...result);
  }

  function card({ subject, topics }) {
    const active = activeTopics(topics);
    // Ближайший срок: сначала запланированная дата старого образца (startDate),
    // иначе ближайший срок сдачи или занятия среди активных тем.
    const next = nextScheduledTopic(topics) || nearestTopic(active);
    const progress = disciplineProgress(topics);
    return h("div", { class: "panel discipline-card" },
      h("div", { class: "panel-body" },
        h("h2", {}, h("a", { href: `#discipline/${encode(subject.id)}` }, subject.title)),
        // Поле teacher правила запрещают записывать: только старые данные.
        typeof subject.teacher === "string" && subject.teacher.trim()
          ? h("p", { class: "muted" }, `Преподаватель: ${subject.teacher.trim()}`) : null,
        subject.description ? h("p", { class: "muted" }, shortDescription(subject.description, 140)) : null,
        next ? h("p", { class: "muted" }, `Следующая: ${next.title}`) : null,
        h("div", { class: "btn-row" },
          h("span", { class: `badge ${progress > 0 ? "badge-success" : "badge-neutral"}` },
            `${active.length} из ${topics.length} тем`),
          subject.status === STATUS_ARCHIVED ? h("span", { class: "badge badge-warning" }, "В архиве") : null),
        staff ? h("div", { class: "btn-row" }, cardButtons(subject)) : null));
  }

  function cardButtons(subject) {
    const archived = subject.status === STATUS_ARCHIVED;
    return [
      h("button", {
        type: "button", class: "btn secondary btn-sm",
        onclick: () => toggleArchive(subject, !archived)
      }, archived ? "Вернуть" : "В архив"),
      h("button", {
        type: "button", class: "btn secondary btn-sm", onclick: () => openEdit(subject)
      }, "Изменить")
    ];
  }

  function drawArchive(into, archivedItems) {
    into.push(h("section", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Архивные дисциплины")),
      h("ul", { class: "list" }, archivedItems.map(({ subject }) => h("li", { class: "list-row" },
        h("div", { class: "list-row-main" },
          h("div", { class: "list-row-title" },
            h("a", { href: `#discipline/${encode(subject.id)}` }, subject.title)),
          h("div", { class: "list-row-sub" }, "архив")),
        h("div", { class: "topic-actions" }, cardButtons(subject)))))));
  }

  async function toggleArchive(subject, archived) {
    const ok = await confirmAction({
      title: archived ? "Отправить в архив?" : "Вернуть из архива?",
      text: archived
        ? `«${subject.title}» скроется от студентов. Темы, материалы и история попыток сохранятся.`
        : `«${subject.title}» снова появится у студентов.`,
      confirmLabel: archived ? "В архив" : "Вернуть"
    });
    if (!ok) return;
    try {
      await updateSubject(subject.id, { status: archived ? STATUS_ARCHIVED : STATUS_ACTIVE });
      toast(archived ? "Дисциплина в архиве" : "Дисциплина восстановлена", "success");
      await load();
    } catch (err) {
      toast(err?.message || "Не удалось изменить статус", "error");
    }
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

  async function openEdit(subject) {
    await formDialog({
      idPrefix: "discipline-edit", title: "Изменить дисциплину",
      fields: [
        { key: "title", label: "Название дисциплины", value: subject.title, maxlength: TITLE_MAX },
        { key: "description", label: "Описание", type: "textarea", value: subject.description || "", maxlength: DESCRIPTION_MAX }
      ],
      submitLabel: "Сохранить",
      onSubmit: async (v) => {
        try { await updateSubject(subject.id, { title: v.title, description: v.description }); }
        catch (err) { return err?.message || "Не удалось сохранить дисциплину."; }
        toast("Изменения сохранены", "success");
        await load();
        return null;
      }
    });
  }

  await load();
  return page;
}
