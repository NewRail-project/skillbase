// ui/pages/lesson-history.js — история проведённых занятий: #lesson-history.
// Список: дата, тема, участники, результаты команд; клик — полный отчёт
// (#lesson-report/<код>). Доступ: преподаватель — свои занятия, администратор —
// занятия организации (правила lessonHistory). Записи неизменяемы.
import { h } from "../../shared/dom.js";
import { loadCss } from "../../shared/load-css.js";
import { listLessonHistory, lessonHistoryRow, sortLessonHistory, lessonErrorText } from "../../core/lesson-store.js";

const TEAM = { a: "Команда А", b: "Команда Б" };
const outcome = (x) => (!x ? "не проводилась" : x.tie ? "ничья" : x.winner ? `победила ${TEAM[x.winner]}` : "—");

export default async function LessonHistoryPage() {
  try { await loadCss("ui/css/lessons.css"); } catch (err) { console.warn("Стили занятий не загрузились:", err); }
  const body = h("div", {}, h("div", { class: "spinner" }));
  const page = h("div", { class: "page lessons-page" },
    h("div", { class: "page-head" },
      h("div", {}, h("div", { class: "eyebrow" }, "История"), h("h1", {}, "Проведённые занятия")),
      h("div", { class: "page-head-actions" }, h("a", { class: "btn secondary", href: "#lessons" }, "Сценарии занятий"))),
    body);
  try {
    const rows = sortLessonHistory((await listLessonHistory()).map(lessonHistoryRow));
    body.replaceChildren(rows.length ? h("div", { class: "lessons-grid" }, ...rows.map(card))
      : h("div", { class: "panel" }, h("div", { class: "empty-state" }, h("h2", {}, "Пока пусто"),
        h("p", { class: "muted" }, "Проведите занятие и сохраните отчёт: он появится здесь и останется неизменным."))));
  } catch (err) {
    console.error("История занятий:", err);
    body.replaceChildren(h("p", { class: "form-error", role: "alert" }, lessonErrorText(err)));
  }
  return page;
}

function card(r) {
  const date = r.dateMs ? new Date(r.dateMs).toLocaleDateString("ru-RU") : "—";
  return h("article", { class: "panel lesson-card" },
    h("h2", {}, r.topic),
    h("p", { class: "muted" }, `${date}${r.subjectName ? ` · ${r.subjectName}` : ""}`),
    h("ul", { class: "lesson-facts" },
      h("li", {}, `Участников: ${r.participants}`),
      h("li", {}, `Battle: ${outcome(r.battle)}`),
      h("li", {}, `Практика: ${outcome(r.practical)}`),
      r.completion === null ? null : h("li", {}, `Выполнение: ${r.completion}%`)),
    h("a", { class: "btn primary", href: `#lesson-report/${encodeURIComponent(r.code)}` }, "Открыть отчёт"));
}
