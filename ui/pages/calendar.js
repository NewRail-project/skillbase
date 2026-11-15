// ui/pages/calendar.js — расписание: занятия, открытие/закрытие тем, сроки сдачи.
// Берёт даты тем из дисциплин, доступных пользователю (студенту правила
// отдают только опубликованные темы его группы).
import { h } from "../../shared/dom.js";
import { getSubjects, getTopics } from "../../core/subjects.js";
import { STATUS_ARCHIVED } from "../../core/subjects-logic.js";
import { dateMs } from "../../core/schedule-logic.js";
import { loading } from "../components/loading.js";
import { error as errorState } from "../components/error.js";

const KINDS = [
  ["lessonDate", "Занятие"], ["openDate", "Открытие темы"],
  ["closeDate", "Закрытие темы"], ["dueDate", "Срок сдачи"], ["publishDate", "Публикация"]
];

// Чистая сборка событий: [{ ms, kind, topic, subject }] по возрастанию даты.
export function buildCalendarEvents(entries = []) {
  const events = [];
  for (const { subject, topics } of entries) {
    for (const topic of topics || []) {
      if (topic.status === STATUS_ARCHIVED) continue;
      for (const [field, label] of KINDS) {
        const ms = dateMs(topic[field]);
        if (ms !== null) events.push({ ms, kind: label, topic, subject });
      }
    }
  }
  return events.sort((a, b) => a.ms - b.ms);
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
      const events = buildCalendarEvents(subjects.map((subject, i) => ({ subject, topics: lists[i] })));
      if (!events.length) {
        body.replaceChildren(h("section", { class: "panel" }, h("div", { class: "empty-state" },
          h("h2", {}, "Событий пока нет"),
          h("p", { class: "muted" }, "Даты появятся, когда у тем будут заданы занятия и сроки."))));
        return;
      }
      const now = Date.now();
      const months = new Map();
      for (const e of events) {
        const key = new Date(e.ms).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
        if (!months.has(key)) months.set(key, []);
        months.get(key).push(e);
      }
      body.replaceChildren(...[...months].map(([month, list]) => h("section", { class: "panel" },
        h("div", { class: "panel-head" }, h("h2", {}, month)),
        h("ul", { class: "list" }, list.map(e => h("li", { class: "list-row" },
          h("div", { class: "list-row-main" },
            h("div", { class: "list-row-title" },
              h("a", { href: `#topic/${encodeURIComponent(e.topic.id)}` }, e.topic.title)),
            h("div", { class: "list-row-sub" }, `${e.subject.title} · ${e.kind}`)),
          h("span", { class: `badge ${e.ms < now ? "badge-neutral" : "badge-success"}` },
            new Date(e.ms).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }))))))));
    } catch (err) {
      console.error("Расписание:", err);
      body.replaceChildren(errorState({ text: err?.message || "Не удалось загрузить расписание.", onRetry: load }));
    }
  }
  await load();
  return page;
}
