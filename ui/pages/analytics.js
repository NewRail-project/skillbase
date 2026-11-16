// ui/pages/analytics.js — аналитика для персонала (этап 6).
//
// Маршрут #analytics, только сотрудники. Страница-хаб:
//   • обзорные показатели, динамика успеваемости (линейный график);
//   • распределение оценок, сравнение дисциплин и тем, сравнение групп;
//   • учебный рейтинг учеников, отстающие, без активности;
//   • доля выполненных заданий и просроченные;
//   • блок «Слабые темы» — существующая логика страницы, сохранена.
//
// Данные: одна выборка listOrgAttempts (та же, что у результатов и
// leaderboard) + roster listOrgUsers + справочники. Подзапросов на смену
// фильтра нет: фильтры зависимы (дисциплина → тема/группа → ученик), а все
// разделы считаются ОДНОЙ функцией analyticsView (core/analytics-logic.js)
// из одной отфильтрованной выборки — карточки, графики и таблицы не могут
// разойтись. Страница только рисует готовую модель.
// Стратегия актуализации: пересчёт при открытии страницы и кнопке
// «Повторить» — подготовленных агрегатных документов в проекте нет, а
// писать их сотрудникам правила не разрешают. Формула оценки
// (scoreAttempt) не изменилась.
//
// Рейтинг здесь — УЧЕБНЫЙ (средний балл попыток). Live-рейтинг комнат
// живёт отдельно (live-report/duel) и не смешивается: Live-результаты не
// хранятся в attempts, поэтому в фильтре типа проверки их нет.
import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { listOrgAttempts } from "../../core/attempts.js";
import { getTopics, getSubjects } from "../../core/subjects.js";
import { listOrgUsers } from "../../core/admins.js";
import { listAssignments } from "../../core/assign.js";
import { teacherCanSeeAttempt } from "../../core/access.js";
import {
  analyticsView, normalizeFilters, hasActiveFilters, EMPTY_FILTERS,
  TOPIC_PASS_PERCENT
} from "../../core/analytics-logic.js";
import { lineChart, barChart, progressMeter } from "../components/charts.js";
import { loading } from "../components/loading.js";
import { error as errorState } from "../components/error.js";

const dateRu = (ms) => new Date(ms).toLocaleDateString("ru-RU");
const pct = (value) => (value === null || value === undefined ? "—" : `${value}%`);

export default async function AnalyticsPage() {
  const page = h("div", { class: "page" });
  if (!isStaff()) {
    page.append(h("section", { class: "panel" },
      h("p", { class: "muted" }, "Аналитика доступна сотрудникам организации.")));
    return page;
  }
  const profile = State.profile;

  page.append(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Управление"),
      h("h1", {}, "Аналитика"),
      h("p", { class: "page-sub" }, "Учебные результаты дисциплин, тем, групп и учеников. Рейтинг — учебный, по среднему баллу попыток.")),
    h("div", { class: "page-head-actions" },
      h("a", { class: "btn secondary", href: "#results" }, "Журнал попыток"))));

  const body = h("div", {});
  page.appendChild(body);

  const state = {
    loading: true,
    error: null,
    // Данные в зоне видимости роли (scope) — вход analyticsView.
    data: { attempts: [], students: [], subjects: [], topics: [], assignments: [], orgId: profile.orgId },
    filters: { ...EMPTY_FILTERS }
  };

  async function load() {
    state.loading = true;
    state.error = null;
    paintLoading();
    try {
      const [attempts, users, subjects, assignments] = await Promise.all([
        listOrgAttempts(profile.orgId),
        listOrgUsers(profile.orgId),
        getSubjects(),
        listAssignments(profile.orgId)
      ]);
      const topics = [];
      for (const subject of subjects) {
        for (const topic of await getTopics(subject.id)) {
          topics.push({ ...topic, subjectId: subject.id });
        }
      }
      // Зона видимости роли: админ — вся организация; преподаватель —
      // свои группы (teacherCanSeeAttempt — зеркало правил Firestore).
      // Ученики и задания сужаются теми же группами: иначе чужая группа
      // попадала в список фильтра группы.
      const groups = Array.isArray(profile.teacherGroups) ? profile.teacherGroups : null;
      state.data = {
        orgId: profile.orgId,
        attempts: attempts.filter(a => teacherCanSeeAttempt(a, profile)),
        students: users
          .filter(u => u.role === "student")
          .filter(u => !groups || groups.includes(u.groupId)),
        subjects: subjects.filter(s => s.status !== "archived"),
        topics,
        assignments: assignments.filter(a => !groups || groups.includes(a.groupId))
      };
      state.loading = false;
      paint();
    } catch (err) {
      console.error("Аналитика:", err);
      state.loading = false;
      state.error = err;
      paint();
    }
  }

  function paintLoading() {
    body.replaceChildren(loading());
  }

  // Любое изменение фильтра: применить, сбросить несовместимое
  // (normalizeFilters) и пересчитать ВСЮ страницу.
  function setFilter(name, value) {
    state.filters = normalizeFilters(state.data, { ...state.filters, [name]: value });
    paint();
  }
  function resetAll() {
    state.filters = { ...EMPTY_FILTERS };
    paint();
  }

  function paint() {
    body.replaceChildren();

    if (state.loading) return;
    if (state.error) {
      body.append(errorState({
        text: state.error?.message || "Не удалось загрузить аналитику. Проверьте подключение к сети.",
        onRetry: load
      }));
      return;
    }

    if (!state.data.attempts.length && !state.data.students.length) {
      body.append(panel("Нет данных", "В зоне видимости роли пока нет учеников и попыток. Аналитика появится после первых прохождений."));
      return;
    }

    const view = analyticsView(state.data, state.filters, { nowMs: Date.now() });
    state.filters = view.filters; // нормализованные: источник правды для UI

    paintFilters(view);
    body.append(overviewSection(view));
    body.append(dynamicsSection(view));
    body.append(distributionSection(view));
    body.append(disciplinesSection(view));
    body.append(groupsSection(view));
    body.append(studentsSection(view));
    body.append(assignmentsSection(view));
    body.append(weakTopicsSection(view));
  }

  // ---------- Фильтры ----------
  function filterField(key, ariaLabel, allLabel, items) {
    const f = state.filters;
    const select = h("select", {
      "aria-label": ariaLabel,
      onchange: e => setFilter(key, e.target.value)
    },
    h("option", { value: "", selected: !f[key] }, allLabel),
    ...items.map(item => h("option", { value: item.value, selected: f[key] === item.value }, item.label)));
    return h("div", { class: "analytics-filter" },
      select,
      f[key]
        ? h("button", {
          type: "button", class: "btn secondary analytics-filter-reset",
          "aria-label": `Сбросить: ${ariaLabel.toLowerCase()}`,
          onclick: () => setFilter(key, EMPTY_FILTERS[key])
        }, "×")
        : null);
  }

  function paintFilters(view) {
    const f = state.filters;
    const o = view.options;
    const periodSel = h("div", { class: "analytics-filter" },
      h("select", { "aria-label": "Фильтр по периоду", onchange: e => setFilter("period", e.target.value) },
        ...o.periods.map(p => h("option", { value: p.id, selected: f.period === p.id }, p.label))),
      f.period !== "all"
        ? h("button", {
          type: "button", class: "btn secondary analytics-filter-reset",
          "aria-label": "Сбросить: фильтр по периоду",
          onclick: () => setFilter("period", "all")
        }, "×")
        : null);

    body.append(h("div", { class: "analytics-filters" },
      filterField("subjectId", "Фильтр по дисциплине", "Все дисциплины",
        o.subjects.map(s => ({ value: s.id, label: s.title || s.id }))),
      filterField("topicId", "Фильтр по теме", "Все темы",
        o.topics.map(t => ({ value: t.id, label: t.title || t.id }))),
      filterField("groupId", "Фильтр по группе", "Все группы",
        o.groups.map(g => ({ value: g, label: g }))),
      filterField("userId", "Фильтр по ученику", "Все ученики",
        o.students.map(s => ({ value: s.uid, label: s.fullName || s.uid }))),
      periodSel,
      filterField("kind", "Фильтр по типу проверки", "Все проверки",
        o.kinds.map(k => ({ value: k.id, label: k.label })))));

    body.append(h("div", { class: "analytics-filters-foot" },
      hasActiveFilters(f)
        ? h("button", { type: "button", class: "btn secondary", onclick: resetAll }, "Сбросить все фильтры")
        : null,
      h("p", { class: "muted stat-hint" },
        "Live-проверки здесь не учитываются: их результаты — в Live-отчётах комнат и в учебные оценки не входят.")));
  }

  // ---------- Разделы ----------

  function panel(title, ...children) {
    return h("section", { class: "panel" },
      h("div", { class: "section-title" }, h("h2", {}, title)),
      ...children);
  }

  function stat(label, value, hint = "") {
    return h("div", { class: "stat" },
      h("div", { class: "stat-label" }, label),
      h("span", { class: "stat-value" }, value),
      hint ? h("p", { class: "muted stat-hint" }, hint) : null);
  }

  function emptyHint(text) {
    return h("p", { class: "muted" }, text);
  }

  function overviewSection(view) {
    const o = view.overview;
    const parts = [`оценено: ${o.gradedCount}`];
    if (o.pendingCount) parts.push(`на проверке: ${o.pendingCount}`);
    if (o.expiredCount) parts.push(`время вышло: ${o.expiredCount}`);
    if (o.inProgressCount) parts.push(`в процессе (не в счёт): ${o.inProgressCount}`);
    return h("section", { class: "panel" },
      h("div", { class: "section-title" }, h("h2", {}, "Обзор")),
      h("div", { class: "stat-grid" },
        stat("Учеников", String(o.studentsCount), `с попытками: ${o.studentsWithAttempts}`),
        stat("Тем", String(o.topicsCount)),
        stat("Попыток", String(o.attemptsCount), parts.join(" · ")),
        stat("Средний балл", pct(o.averageScore), o.bestScore === null ? "" : `лучший: ${o.bestScore}%`)),
      view.isEmpty
        ? h("div", {},
          h("p", { class: "muted" }, "Нет данных. Попыток по выбранным фильтрам нет. Ослабьте фильтры или выберите другой период."),
          hasActiveFilters(view.filters)
            ? h("button", { type: "button", class: "btn secondary", onclick: resetAll }, "Сбросить все фильтры")
            : null)
        : h("p", { class: "muted" }, "Показатели — по выбранным фильтрам."),
      o.guestAttempts
        ? h("p", { class: "muted stat-hint" }, `Включая гостевые попытки: ${o.guestAttempts} (гости не входят в списки учеников).`)
        : null);
  }

  function dynamicsSection(view) {
    return panel("Динамика успеваемости",
      view.dynamics
        ? lineChart(view.dynamics.map(p => ({ label: p.label, value: p.avgPercent })),
          { ariaLabel: "Динамика среднего балла по неделям" })
        : emptyHint("Недостаточно данных для динамики: нужно не меньше двух оценённых попыток в разные недели."));
  }

  function distributionSection(view) {
    const d = view.distribution;
    return panel("Распределение оценок",
      d
        ? barChart(d.buckets.map(b => ({
          label: b.label,
          value: Math.round(b.count / d.total * 100),
          hint: `${b.count} (${Math.round(b.count / d.total * 100)}%)`
        })), { ariaLabel: "Распределение оценённых попыток по диапазонам баллов" })
        : emptyHint("Оценённых попыток по выбранным фильтрам нет."));
  }

  function disciplinesSection(view) {
    if (!view.disciplines.length) return panel("Дисциплины", emptyHint("Дисциплин с данными по выбранным фильтрам нет."));
    return panel("Дисциплины",
      ...view.disciplines.map(({ subject, data }) => h("div", { class: "analytics-subject" },
        h("div", { class: "section-title" },
          h("h3", {}, subject.title),
          h("span", { class: "muted" }, data.averageScore === null ? "нет оценённых попыток" : `средний: ${data.averageScore}%`)),
        h("div", { class: "stat-grid" },
          stat("Учеников", String(data.studentsCount)),
          stat("Тем", String(data.topicsCount)),
          stat("Завершено тем", String(data.completedTopics), `незавершено: ${data.incompleteTopics}`),
          stat("Активность (30 дн.)", pct(data.activeStudentsPercent), `${data.activeStudents} из ${data.studentsCount}`)),
        progressMeter(data.masteryPercent, { label: "Освоение программы" }),
        h("div", { class: "btn-row" },
          h("a", { class: "btn secondary", href: `#discipline/${encodeURIComponent(subject.id)}` }, "К дисциплине")))));
  }

  function groupsSection(view) {
    const { bars, selected } = view.groups;
    const chart = bars.length
      ? barChart(bars.map(r => ({ label: r.label, value: r.averageScore, hint: `${r.averageScore}% (${r.count})` })),
        { ariaLabel: "Сравнение групп по среднему баллу" })
      : null;
    return panel("Группы",
      chart || emptyHint("Оценённых попыток по группам нет."),
      !selected ? emptyHint("Выберите группу в фильтре — появятся рейтинг, отстающие и сравнение тем.") : null,
      selected ? groupDetails(selected) : null);
  }

  function groupDetails(selected) {
    const completed = selected.completion;
    const topicBars = selected.topicComparison.length
      ? barChart(selected.topicComparison.map(t => ({
        label: t.title,
        value: t.averageScore,
        hint: `${t.averageScore}% (${t.count})`
      })), { ariaLabel: "Сравнение тем группы по среднему баллу" })
      : emptyHint("Оценённых попыток по темам группы нет.");
    return h("div", {},
      h("div", { class: "stat-grid" },
        stat("Учеников", String(selected.studentsCount)),
        stat("Средний балл", pct(selected.averageScore)),
        stat("Активность (30 дн.)", pct(selected.activeStudentsPercent)),
        stat("Задания выполнены", pct(completed?.percent), completed ? `${completed.done} из ${completed.total}` : "")),
      h("h3", { class: "sub-title" }, "Учебный рейтинг группы"),
      rankingTable(selected.ranking, { withReport: false, empty: "Учеников группы нет." }),
      h("h3", { class: "sub-title" }, "Сравнение тем"),
      topicBars,
      h("div", { class: "btn-row" },
        h("a", { class: "btn secondary", href: "#leaderboard" }, "Рейтинг по тестам")),
      selected.lagging.length
        ? h("div", {},
          h("h3", { class: "sub-title" }, `Отстающие (средний ниже ${TOPIC_PASS_PERCENT}%)`),
          listRows(selected.lagging.map(r => ({ title: r.name, value: pct(r.averageScore) }))))
        : null,
      selected.inactive.length
        ? h("div", {},
          h("h3", { class: "sub-title" }, "Без активности (30+ дней)"),
          listRows(selected.inactive.map(r => ({ title: r.name, value: r.lastActivityMs ? dateRu(r.lastActivityMs) : "нет попыток" }))))
        : null);
  }

  function rankingTable(rows, { withReport, empty }) {
    if (!rows.length) return emptyHint(empty);
    return h("div", { class: "analytics-table-wrap" },
      h("table", { class: "analytics-table" },
        h("thead", {}, h("tr", {},
          h("th", {}, "Ученик"), h("th", {}, "Средний"), h("th", {}, "Попыток"), h("th", {}, "Лучший"),
          h("th", {}, withReport ? "" : "Активность"))),
        h("tbody", {}, rows.map(r => h("tr", {},
          h("td", {}, r.name),
          h("td", {}, pct(r.averageScore)),
          h("td", {}, String(r.attemptsCount)),
          h("td", {}, pct(r.bestScore)),
          h("td", {}, withReport
            ? h("button", {
              type: "button", class: "btn secondary",
              onclick: () => setFilter("userId", r.uid)
            }, "Отчёт")
            : (r.inactive ? "нет 30+ дней" : "есть")))))));
  }

  function studentsSection(view) {
    const student = view.students.student;
    if (student) {
      const a = student.assignments;
      return panel(`Ученик: ${student.name}`,
        h("div", { class: "stat-grid" },
          stat("Средний балл", pct(student.averageScore), student.bestScore === null ? "" : `лучший: ${student.bestScore}%`),
          stat("Выполнено тестов", String(student.testsCompleted)),
          stat("Заданий выполнено", pct(a.percent), a.total ? `${a.done} из ${a.total}` : "заданий нет"),
          stat("Просрочено заданий", String(student.overdue.length))),
        student.subjectsProgress.length
          ? barChart(student.subjectsProgress.map(s => ({
            label: s.title, value: s.averageScore, hint: `${s.averageScore}%`
          })), { ariaLabel: "Результаты по дисциплинам" })
          : emptyHint("Оценённых попыток по выбранным фильтрам нет."),
        student.strongTopics.length ? listRows(student.strongTopics.slice(0, 5).map(t => ({ title: `Сильная тема: ${t.title}`, value: `${t.averageScore}%` }))) : null,
        student.weakTopics.length ? listRows(student.weakTopics.slice(0, 5).map(t => ({ title: `Слабая тема: ${t.title}`, value: `${t.averageScore}%` }))) : null,
        student.overdue.length ? listRows(student.overdue.map(x => ({ title: `Просрочено: ${x.testTitle}`, value: dateRu(x.deadlineMs) }))) : null,
        h("div", { class: "btn-row" },
          h("a", { class: "btn secondary", href: `#profile/${encodeURIComponent(student.uid)}` }, "Профиль ученика")));
    }
    // Рейтинг по учебным результатам (не Live-рейтинг): только ученики
    // выбранной области (группа/дисциплина), не вся организация.
    return panel("Ученики",
      rankingTable(view.students.rows, { withReport: true, empty: "Учеников по выбранным фильтрам нет." }),
      emptyHint("Рейтинг учебный (средний балл попыток). Live-рейтинг комнат считается отдельно."));
  }

  function assignmentsSection(view) {
    const c = view.assignments;
    return panel("Задания",
      h("div", { class: "stat-grid" },
        stat("Назначено", String(c.total)),
        stat("Выполнено", String(c.done), c.percent === null ? "" : `${c.percent}%`),
        stat("Просрочено (без попытки)", String(c.overdueRows.length))),
      c.total === 0
        ? emptyHint("Активных заданий по выбранным фильтрам нет.")
        : c.overdueRows.length
          ? listRows(c.overdueRows.slice(0, 10).map(r => ({
            title: `${r.name} — ${r.testTitle}`,
            value: dateRu(r.deadlineMs)
          })))
          : emptyHint("Просроченных заданий без попыток нет."),
      emptyHint("Статус заданий не зависит от периода и типа попыток: «выполнено» — факт сдачи."));
  }

  function weakTopicsSection(view) {
    // Существующая логика страницы «Слабые темы» — сохранена: средний
    // балл по темам, топ-5 худших (теперь — из общей выборки фильтров).
    const rows = view.weakTopics.length
      ? h("div", { class: "list" }, view.weakTopics.map(t => h("div", { class: "list-row" },
        h("div", { class: "list-row-main" },
          h("div", { class: "list-row-title" }, h("a", { href: `#topic-analytics/${encodeURIComponent(t.id)}` }, t.title)),
          h("div", { class: "list-row-sub" }, `попыток: ${t.count}`)),
        h("div", { class: `badge ${t.averageScore < 60 ? "badge-danger" : t.averageScore < 75 ? "badge-warning" : "badge-success"}` }, `${t.averageScore}%`))))
      : emptyHint("Недостаточно данных: нужны оценённые попытки с привязкой к темам.");
    return panel("Слабые темы",
      rows,
      h("div", { class: "btn-row" },
        h("a", { class: "btn secondary", href: "#leaderboard" }, "Рейтинг по тестам")));
  }

  function listRows(items) {
    return h("div", { class: "list" }, items.map(item => h("div", { class: "list-row" },
      h("div", { class: "list-row-main" },
        h("div", { class: "list-row-title" }, item.title)),
      h("span", { class: "muted" }, item.value))));
  }

  await load();
  return page;
}
