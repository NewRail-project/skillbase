// ui/pages/calendar.js — расписание: занятия, открытие/закрытие тем, сроки сдачи.
// Берёт даты тем из дисциплин, доступных пользователю (студенту правила
// отдают только опубликованные темы его группы). Фильтры по дисциплине
// и группе применяются на клиенте: правила — не фильтры.
import { h } from "../../shared/dom.js";
import { getSubjects, getTopics } from "../../core/subjects.js";
import { STATUS_ARCHIVED } from "../../core/subjects-logic.js";
import {
  buildScheduleEvents, filterScheduleEvents, scheduleGroups, overdueEvents
} from "../../core/schedule-logic.js";
import { loading } from "../components/loading.js";
import { error as errorState } from "../components/error.js";

const KIND_LABELS = Object.freeze({
  lesson: "Занятие",
  open: "Открытие темы",
  close: "Закрытие темы",
  due: "Срок сдачи",
  assignment: "Срок задания"
});

const state = { subjectId: "", groupId: "", events: [] };

function eventLink(e) {
  if (e.topicId) return `#topic/${encodeURIComponent(e.topicId)}`;
  return null;
}

function eventRow(e, now) {
  const link = eventLink(e);
  const title = h("div", { class: "list-row-title" },
    link ? h("a", { href: link }, e.title) : e.title);
  return h("li", { class: "list-row" },
    h("div", { class: "list-row-main" },
      title,
      h("div", { class: "list-row-sub" }, KIND_LABELS[e.kind] || e.kind)),
    h("span", { class: `badge ${e.dateMs < now ? "badge-neutral" : "badge-success"}` },
      new Date(e.dateMs).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })));
}

function draw(body, subjects) {
  const now = Date.now();
  const filtered = filterScheduleEvents(state.events, {
    subjectId: state.subjectId || null,
    groupId: state.groupId || null
  });
  if (!filtered.length) {
    body.replaceChildren(h("section", { class: "panel" }, h("div", { class: "empty-state" },
      h("h2", {}, "Событий пока нет"),
      h("p", { class: "muted" }, "Даты появятся, когда у тем будут заданы занятия и сроки."))));
    return;
  }

  // Просроченные — отдельным блоком наверху: сначала догоняем, потом идём вперёд.
  const overdue = overdueEvents(filtered, now);
  const overdueSet = new Set(overdue);
  const upcoming = filtered.filter(e => !overdueSet.has(e));
  const months = new Map();
  for (const e of upcoming) {
    const key = new Date(e.dateMs).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(e);
  }

  const groups = scheduleGroups(state.events);
  const subjectFilter = h("select", {
    id: "calendar-subject-filter",
    "aria-label": "Фильтр по дисциплине",
    onchange: (ev) => { state.subjectId = ev.target.value; draw(body, subjects); }
  }, h("option", { value: "" }, "Все дисциплины"),
    ...subjects.map(s => h("option", { value: s.id, ...(state.subjectId === s.id ? { selected: true } : {}) }, s.title)));
  const groupFilter = h("select", {
    id: "calendar-group-filter",
    "aria-label": "Фильтр по группе",
    onchange: (ev) => { state.groupId = ev.target.value; draw(body, subjects); }
  }, h("option", { value: "" }, "Все группы"),
    ...groups.map(g => h("option", { value: g, ...(state.groupId === g ? { selected: true } : {}) }, g)));

  body.replaceChildren(
    h("div", { class: "filters" }, subjectFilter, groupFilter),
    overdue.length
      ? h("section", { class: "panel" },
        h("div", { class: "panel-head" }, h("h2", {}, "Просроченные")),
        h("ul", { class: "list" }, overdue.map(e => eventRow(e, now))))
      : null,
    ...[...months].map(([month, list]) => h("section", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, month)),
      h("ul", { class: "list" }, list.map(e => eventRow(e, now))))));
}

export default async function CalendarPage() {
  const page = h("div", { class: "page" });
  const body = h("div", {});
  page.append(h("div", { class: "page-head" }, h("div", {},
    h("div", { class: "eyebrow" }, "Обучение"), h("h1", {}, "Расписание"),
    h("p", { class: "page-sub" }, "Занятия, открытие тем и сроки сдачи по дисциплинам."))), body);

  async function load() {
    body.replaceChildren(loading());
    try {
      const subjects = (await getSubjects()).filter(s => s.status !== STATUS_ARCHIVED);
      const lists = await Promise.all(subjects.map(s => getTopics(s.id).catch(() => [])));
      state.events = buildScheduleEvents({ topics: lists.flat(), assignments: [] });
      draw(body, subjects);
    } catch (err) {
      console.error("Расписание:", err);
      body.replaceChildren(errorState({ text: err?.message || "Не удалось загрузить расписание.", onRetry: load }));
    }
  }
  await load();
  return page;
}
