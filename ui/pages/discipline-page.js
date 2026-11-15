// ui/pages/discipline-page.js — отдельная страница дисциплины (#discipline/<id>).
// Темы с датами, группами и статусом; материалы и тесты дисциплины;
// статистика. Персонал создаёт/правит темы и саму дисциплину в пределах
// своих прав — правила Firestore остаются границей.
import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { getSubject, getTopics, createTopic, updateSubject, moveTopic } from "../../core/subjects.js";
import {
  TITLE_MAX, DESCRIPTION_MAX, STATUS_ARCHIVED, STATUS_ACTIVE,
  TOPIC_STATUS_DRAFT, TOPIC_STATUS_PLANNED, TOPIC_STATUS_PUBLISHED, TOPIC_STATUS_ARCHIVED,
  activeTopics
} from "../../core/subjects-logic.js";
import { topicStatusLabel, studentTopicState, formatTopicDate, dateMs } from "../../core/schedule-logic.js";
import { listMaterials } from "../../core/material-library.js";
import { listMyTests, listPublishedTests } from "../../core/editor.js";
import { listOrgAttempts } from "../../core/attempts.js";
import { listOrgUsers } from "../../core/admins.js";
import { disciplineAnalytics } from "../../core/analytics-logic.js";
import { formDialog } from "../components/form-dialog.js";
import { confirmAction } from "../components/confirm.js";
import { toast } from "../components/toast.js";
import { loading } from "../components/loading.js";
import { error as errorState } from "../components/error.js";

const encode = encodeURIComponent;
const pct = (v) => (v === null || v === undefined ? "—" : `${v}%`);

export default async function DisciplinePage() {
  const page = h("div", { class: "page" });
  const staff = isStaff();
  const id = (State.routeParam || "").split("/")[0];
  const body = h("div", {});
  page.appendChild(body);

  if (!id) {
    body.append(h("section", { class: "panel" }, h("p", { class: "muted" }, "Дисциплина не выбрана."),
      h("a", { class: "btn secondary", href: "#disciplines" }, "К каталогу дисциплин")));
    return page;
  }

  let discipline = null;
  let topics = [];
  let linked = { materials: [], tests: [] };
  let stats = null;

  async function load() {
    body.replaceChildren(loading());
    try {
      discipline = await getSubject(id);
      if (!discipline || (!staff && discipline.status === STATUS_ARCHIVED)) {
        body.replaceChildren(h("section", { class: "panel" }, h("div", { class: "empty-state" },
          h("h2", {}, "Дисциплина не найдена"),
          h("p", { class: "muted" }, "Дисциплина не существует или скрыта из списков."),
          h("a", { class: "btn secondary", href: "#disciplines" }, "К каталогу дисциплин"))));
        return;
      }
      topics = await getTopics(id);
      await loadLinked();
      await loadStats();
      draw();
    } catch (err) {
      console.error("Страница дисциплины:", err);
      body.replaceChildren(errorState({ text: err?.message || "Не удалось загрузить дисциплину.", onRetry: load }));
    }
  }

  // Материалы и тесты дисциплины. Старые данные могут быть привязаны только
  // к теме (topicId без subjectId) — такие элементы тоже относим к дисциплине.
  async function loadLinked() {
    const topicIds = new Set(topics.map(t => t.id));
    const belongs = (item) => item.subjectId === discipline.id
      || (!item.subjectId && topicIds.has(item.topicId));
    const [materialsAll, testsAll] = await Promise.all([
      listMaterials().catch(() => []),
      staff
        ? listMyTests(State.user?.uid, State.profile?.orgId, State.profile?.role).catch(() => [])
        : listPublishedTests(State.profile?.orgId).catch(() => [])
    ]);
    linked = {
      materials: materialsAll.filter(belongs)
        .filter(m => staff || (m.status !== "draft" && m.status !== "archived")),
      tests: testsAll.filter(belongs)
    };
  }

  // Статистика: сотрудникам — по попыткам дисциплины; студенту — только
  // количество доступных тем (чужие результаты ему не показываем).
  async function loadStats() {
    const visibleTopics = activeTopics(topics);
    if (!staff) {
      stats = { topics: visibleTopics.length };
      return;
    }
    const [attempts, users] = await Promise.all([
      listOrgAttempts(State.profile.orgId, { subjectId: id }).catch(() => []),
      listOrgUsers(State.profile.orgId).catch(() => [])
    ]);
    const students = users.filter(u => u.role === "student");
    stats = disciplineAnalytics({ attempts, topics: visibleTopics, students, nowMs: Date.now() });
  }

  function draw() {
    const now = Date.now();
    const visible = staff ? topics : activeTopics(topics);
    const isArchived = discipline.status === STATUS_ARCHIVED;
    const actionButtons = [
      h("button", { type: "button", class: "btn primary", onclick: addTopic }, "Добавить тему"),
      h("button", { type: "button", class: "btn secondary", onclick: editDiscipline }, "Изменить"),
      h("button", { type: "button", class: "btn secondary", onclick: toggleArchive },
        isArchived ? "Вернуть из архива" : "В архив")
    ];

    body.replaceChildren(
      h("div", { class: "page-head" },
        h("div", {},
          h("div", { class: "eyebrow" }, h("a", { href: "#disciplines" }, "← Дисциплины")),
          h("h1", {}, discipline.title),
          discipline.description ? h("p", { class: "page-sub" }, discipline.description) : null),
        staff ? h("div", { class: "page-head-actions" }, h("div", { class: "btn-row" }, ...actionButtons)) : null),
      statsPanel(),
      upcomingPanel(now),
      h("section", { class: "panel" },
        h("div", { class: "panel-head" }, h("h2", {}, "Темы"),
          staff ? h("a", { class: "btn secondary", href: "#analytics" }, "Аналитика") : null),
        visible.length
          ? h("ul", { class: "list" }, visible.map((t, i) => topicRow(t, i, visible.length, now)))
          : h("div", { class: "empty-state" }, h("p", { class: "muted" },
              staff ? "Тем пока нет — добавьте первую." : "Тем пока нет."))),
      linkedPanel("Материалы", linked.materials, m => `#material/${encode(m.id)}`),
      linkedPanel("Тесты", linked.tests, t => `#test/${encode(t.id)}`)
    );
  }

  // Ближайшие сроки: темы с датой сдачи или занятия в будущем, по возрастанию.
  function upcomingPanel(now) {
    const items = activeTopics(topics)
      .map(t => ({ t, ms: dateMs(t.dueDate) ?? dateMs(t.lessonDate) }))
      .filter(x => x.ms !== null && x.ms >= now)
      .sort((a, b) => a.ms - b.ms)
      .slice(0, 3);
    if (!items.length) return null;
    const rows = items.map(({ t, ms }) => {
      const title = h("div", { class: "list-row-title" }, t.title);
      const when = h("div", { class: "list-row-sub" }, formatTopicDate(ms));
      return h("li", { class: "list-row" }, h("div", { class: "list-row-main" }, title, when));
    });
    return h("section", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Ближайшие сроки")),
      h("ul", { class: "list" }, rows));
  }

  function statsPanel() {
    if (!stats) return null;
    const cells = staff
      ? [
          ["Тем", String(stats.topicsCount)],
          ["Завершено тем", String(stats.completedTopics)],
          ["Освоение", pct(stats.masteryPercent)],
          ["Средний балл", pct(stats.averageScore)],
          ["Лучший балл", pct(stats.bestScore)],
          ["Попыток", String(stats.attemptsCount)]
        ]
      : [["Доступных тем", String(stats.topics)]];
    return h("section", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Статистика")),
      h("div", { class: "panel-body" },
        h("div", { class: "quick-actions" },
          cells.map(([label, value]) => h("div", { class: "quick-action" },
            h("b", {}, value), h("span", {}, label))))));
  }

  function linkedPanel(title, items, hrefOf) {
    if (!items.length) return null;
    return h("section", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, title)),
      h("ul", { class: "list" }, items.map(item => h("li", { class: "list-row" },
        h("div", { class: "list-row-main" },
          h("div", { class: "list-row-title" }, h("a", { href: hrefOf(item) }, item.title || "Без названия")),
          item.topicId ? h("div", { class: "list-row-sub" }, topics.find(t => t.id === item.topicId)?.title || "") : null)))));
  }

  function topicRow(t, index, total, now) {
    const topic = t;
    const st = studentTopicState(t, now);
    const groups = Array.isArray(t.groups) ? t.groups : (t.groupId ? [t.groupId] : []);
    const badges = [];
    if (staff) {
      badges.push(h("span", { class: `badge ${t.status === TOPIC_STATUS_PUBLISHED || t.status === STATUS_ACTIVE ? "badge-success" : "badge-neutral"}` }, topicStatusLabel(t.status)));
    } else if (st.state !== "available") {
      badges.push(h("span", { class: `badge ${st.state === "overdue" ? "badge-danger" : "badge-neutral"}` }, st.label));
    }
    const dates = [];
    if (dateMs(t.lessonDate) !== null) dates.push(`занятие ${formatTopicDate(t.lessonDate)}`);
    if (dateMs(t.dueDate) !== null) dates.push(`сдать до ${formatTopicDate(t.dueDate)}`);
    dates.push(`группы: ${groups.length ? groups.join(", ") : "—"}`);
    return h("li", { class: "list-row" },
      h("div", { class: "list-row-main" },
        h("div", { class: "list-row-title" }, h("a", { href: `#topic/${encode(topic.id)}` }, t.title)),
        h("div", { class: "list-row-sub" }, dates.join(" · "))),
      h("div", { class: "btn-row" }, ...badges,
        staff ? h("a", { class: "btn secondary", href: `#topic-analytics/${encode(topic.id)}` }, "Статистика") : null,
        staff ? h("button", { type: "button", class: "btn secondary", "aria-label": "Выше", disabled: index === 0,
          onclick: () => move(t, -1) }, "↑") : null,
        staff ? h("button", { type: "button", class: "btn secondary", "aria-label": "Ниже", disabled: index === total - 1,
          onclick: () => move(t, 1) }, "↓") : null));
  }

  async function move(topic, delta) {
    try { await moveTopic(topic.id, delta); await load(); }
    catch (err) { toast(err?.message || "Не удалось изменить порядок.", "error"); }
  }

  async function addTopic() {
    await formDialog({
      idPrefix: "topic-create", title: "Новая тема",
      fields: [
        { key: "title", label: "Название темы", maxlength: TITLE_MAX },
        { key: "description", label: "Описание (необязательно)", type: "textarea", maxlength: DESCRIPTION_MAX },
        { key: "groupId", label: "Учебная группа", maxlength: 100, hint: "Пусто — тема для всех групп" },
        { key: "status", label: "Статус", type: "select", value: TOPIC_STATUS_DRAFT,
          options: [
            { value: TOPIC_STATUS_DRAFT, label: "Черновик" },
            { value: TOPIC_STATUS_PLANNED, label: "Запланирована" },
            { value: TOPIC_STATUS_PUBLISHED, label: "Опубликована" }
          ] }
      ],
      submitLabel: "Создать",
      onSubmit: async (v) => {
        try { await createTopic({ subjectId: id, title: v.title, description: v.description, status: v.status, groupId: v.groupId.trim() }); }
        catch (err) { return err?.message || "Не удалось создать тему."; }
        toast("Тема создана", "success");
        await load();
        return null;
      }
    });
  }

  async function editDiscipline() {
    await formDialog({
      idPrefix: "discipline-edit", title: "Изменить дисциплину",
      fields: [
        { key: "title", label: "Название дисциплины", value: discipline.title, maxlength: TITLE_MAX },
        { key: "description", label: "Описание", value: discipline.description || "", type: "textarea", maxlength: DESCRIPTION_MAX }
      ],
      submitLabel: "Сохранить",
      onSubmit: async (v) => {
        try { await updateSubject(id, { title: v.title, description: v.description }); }
        catch (err) { return err?.message || "Не удалось сохранить."; }
        toast("Сохранено", "success");
        await load();
        return null;
      }
    });
  }

  async function toggleArchive() {
    const toArchive = discipline.status !== STATUS_ARCHIVED;
    const ok = await confirmAction({
      title: toArchive ? "Перевести дисциплину в архив?" : "Вернуть дисциплину из архива?",
      text: "Данные не удаляются: темы, материалы, тесты и результаты сохраняются.",
      confirmLabel: toArchive ? "В архив" : "Вернуть",
      tone: toArchive ? "danger" : "primary"
    });
    if (!ok) return;
    try {
      await updateSubject(id, { status: toArchive ? STATUS_ARCHIVED : STATUS_ACTIVE });
      toast(toArchive ? "Дисциплина в архиве" : "Дисциплина возвращена", "success");
      await load();
    } catch (err) { toast(err?.message || "Не удалось изменить статус.", "error"); }
  }

  await load();
  return page;
}
