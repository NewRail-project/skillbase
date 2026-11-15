// ui/pages/analytics.js — аналитика для персонала (этап 6).
//
// Маршрут #analytics, только сотрудники. Страница-хаб:
//   • обзорные показатели, динамика успеваемости (линейный график);
//   • сравнение дисциплин и тем, сравнение групп (столбцы);
//   • учебный рейтинг учеников, отстающие, без активности;
//   • доля выполненных заданий и просроченные;
//   • блок «Слабые темы» — существующая логика страницы, сохранена.
//
// Данные: одна выборка listOrgAttempts (та же, что у результатов и
// leaderboard) + roster listOrgUsers + справочники. Тяжёлых подзапросов
// нет: все разрезы считаются чистой логикой core/analytics-logic.js
// на клиенте. Стратегия актуализации: пересчёт при открытии страницы и
// кнопке «Повторить» — подготовленных агрегатных документов в проекте
// нет, а писать их сотрудникам правила не разрешают. Формула оценки
// (scoreAttempt) не изменилась.
//
// Рейтинг здесь — УЧЕБНЫЙ (средний балл попыток). Live-рейтинг комнат
// живёт отдельно (live-report/duel) и не смешивается.
import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { listOrgAttempts } from "../../core/attempts.js";
import { getTopics, getSubjects } from "../../core/subjects.js";
import { listOrgUsers } from "../../core/admins.js";
import { listAssignments } from "../../core/assign.js";
import { teacherCanSeeAttempt } from "../../core/access.js";
import {
  filterAttempts, gradeDistribution, performanceDynamics, averagePercent,
  disciplineAnalytics, groupAnalytics, assignmentCompletion, studentAnalytics,
  PERIODS, TOPIC_PASS_PERCENT
} from "../../core/analytics-logic.js";
import { lineChart, barChart, progressMeter } from "../components/charts.js";
import { loading } from "../components/loading.js";
import { error as errorState } from "../components/error.js";

const DAY = 24 * 3600 * 1000;

export default async function AnalyticsPage() {
  const page = h("div", { class: "page" });
  if (!isStaff()) {
    page.append(h("section", { class: "panel" },
      h("p", { class: "muted" }, "Аналитика доступна сотрудникам организации.")));
    return page;
  }
  const profile = State.profile;
  const staff = isStaff();

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
    attempts: [],      // попытки в зоне видимости роли (scope)
    students: [],      // roster в зоне видимости роли
    subjects: [],
    topics: [],        // все темы организации { ...topic, subjectId }
    assignments: [],
    filters: { subjectId: "", topicId: "", groupId: "", userId: "", period: "all", kind: "" }
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
      state.attempts = attempts.filter(a => teacherCanSeeAttempt(a, profile));
      const groups = Array.isArray(profile.teacherGroups) ? profile.teacherGroups : null;
      state.students = users
        .filter(u => u.role === "student")
        .filter(u => !groups || groups.includes(u.groupId));
      state.subjects = subjects.filter(s => s.status !== "archived");
      state.topics = topics;
      state.assignments = assignments;
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

  function filtered() {
    const f = state.filters;
    const period = PERIODS.find(p => p.id === f.period) || PERIODS[0];
    const fromMs = period.days ? Date.now() - period.days * DAY : null;
    return filterAttempts(state.attempts, {
      subjectId: f.subjectId || null,
      topicId: f.topicId || null,
      groupId: f.groupId || null,
      userId: f.userId || null,
      kind: f.kind || null,
      fromMs
    });
  }

  function topicTitle(id) {
    return state.topics.find(t => t.id === id)?.title || id;
  }
  function subjectTitle(id) {
    return state.subjects.find(s => s.id === id)?.title || id;
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

    paintFilters();
    const attempts = filtered();
    const nowMs = Date.now();

    if (!state.attempts.length && !state.students.length) {
      body.append(panel("Нет данных", "В зоне видимости роли пока нет учеников и попыток. Аналитика появится после первых прохождений."));
      return;
    }

    // ---------- Обзор ----------
    const graded = attempts.filter(a => a.status === "graded" && Number.isFinite(a.percent));
    const avg = averagePercent(graded.map(a => a.percent));
    const overview = h("section", { class: "panel" },
      h("div", { class: "section-title" }, h("h2", {}, "Обзор")),
      h("div", { class: "stat-grid" },
        stat("Учеников", String(state.students.length)),
        stat("Тем", String(scopeTopics().length)),
        stat("Попыток", String(attempts.length), `оценено: ${graded.length}`),
        stat("Средний балл", avg === null ? "—" : `${avg}%`, graded.length ? `лучший: ${Math.max(...graded.map(a => a.percent))}%` : "")),
      !attempts.length
        ? h("p", { class: "muted" }, "Попыток по выбранным фильтрам нет. Ослабьте фильтры или выберите другой период.")
        : h("p", { class: "muted" }, "Показатели — по выбранным фильтрам."));
    body.append(overview);

    // ---------- Динамика успеваемости ----------
    body.append(dynamicsSection(attempts, nowMs));

    // ---------- Дисциплины ----------
    body.append(disciplinesSection(attempts, nowMs));

    // ---------- Группы ----------
    body.append(groupsSection(attempts, nowMs));

    // ---------- Ученики ----------
    body.append(studentsSection(attempts, nowMs));

    // ---------- Задания ----------
    body.append(assignmentsSection(attempts, nowMs));

    // ---------- Слабые темы (существующая логика страницы) ----------
    body.append(weakTopicsSection(attempts));
  }

  function scopeTopics() {
    const f = state.filters;
    return state.topics
      .filter(t => !t.status || t.status !== "archived")
      .filter(t => !f.subjectId || t.subjectId === f.subjectId)
      .filter(t => !f.groupId || !t.groupId || t.groupId === f.groupId);
  }

  // ---------- Фильтры ----------
  function paintFilters() {
    const f = state.filters;
    const groupsInScope = new Set();
    for (const a of state.attempts) if (a.groupId) groupsInScope.add(a.groupId);
    for (const s of state.students) if (s.groupId) groupsInScope.add(s.groupId);
    for (const a of state.assignments) if (a.groupId) groupsInScope.add(a.groupId);

    const subjectSel = h("select", { "aria-label": "Фильтр по дисциплине", onchange: e => { f.subjectId = e.target.value; f.topicId = ""; e.target.closest(".analytics-filters").querySelectorAll("select")[1].value = ""; paint(); } },
      h("option", { value: "", selected: !f.subjectId }, "Все дисциплины"),
      ...state.subjects.map(s => h("option", { value: s.id, selected: f.subjectId === s.id }, s.title)));

    const topicsForSubject = state.topics.filter(t => !f.subjectId || t.subjectId === f.subjectId);
    const topicSel = h("select", { "aria-label": "Фильтр по теме", onchange: e => { f.topicId = e.target.value; paint(); } },
      h("option", { value: "", selected: !f.topicId }, "Все темы"),
      ...topicsForSubject.map(t => h("option", { value: t.id, selected: f.topicId === t.id }, t.title)));

    const groupSel = h("select", { "aria-label": "Фильтр по группе", onchange: e => { f.groupId = e.target.value; paint(); } },
      h("option", { value: "", selected: !f.groupId }, "Все группы"),
      ...[...groupsInScope].sort().map(g => h("option", { value: g, selected: f.groupId === g }, g)));

    const studentSel = h("select", { "aria-label": "Фильтр по ученику", onchange: e => { f.userId = e.target.value; paint(); } },
      h("option", { value: "", selected: !f.userId }, "Все ученики"),
      ...state.students.map(s => h("option", { value: s.uid, selected: f.userId === s.uid }, s.fullName || s.uid)));

    const periodSel = h("select", { "aria-label": "Фильтр по периоду", onchange: e => { f.period = e.target.value; paint(); } },
      ...PERIODS.map(p => h("option", { value: p.id, selected: f.period === p.id }, p.label)));

    const kindSel = h("select", { "aria-label": "Фильтр по типу проверки", onchange: e => { f.kind = e.target.value; paint(); } },
      h("option", { value: "", selected: !f.kind }, "Все проверки"),
      h("option", { value: "assignment", selected: f.kind === "assignment" }, "По заданию"),
      h("option", { value: "free", selected: f.kind === "free" }, "Свободные прохождения"));

    body.append(h("div", { class: "analytics-filters" },
      subjectSel, topicSel, groupSel, studentSel, periodSel, kindSel));
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

  function dynamicsSection(attempts, nowMs) {
    const points = performanceDynamics(attempts, nowMs);
    return panel("Динамика успеваемости",
      points
        ? lineChart(points.map(p => ({ label: p.label, value: p.avgPercent })),
          { ariaLabel: "Динамика среднего балла по неделям" })
        : emptyHint("Недостаточно данных для динамики: нужно не меньше двух оценённых попыток в разные недели."));
  }

  function disciplinesSection(attempts, nowMs) {
    const rows = state.subjects.map(subject => {
      const topics = state.topics.filter(t => t.subjectId === subject.id && (!t.status || t.status !== "archived"));
      const studentIds = new Set(attempts.filter(a => a.subjectId === subject.id).map(a => a.userId));
      const data = disciplineAnalytics({
        attempts: attempts.filter(a => a.subjectId === subject.id),
        topics,
        // «Ученики дисциплины» — ученики с попытками по ней (состав групп
        // к дисциплине не привязан).
        students: state.students.filter(s => studentIds.has(s.uid)),
        nowMs
      });
      return { subject, data };
    }).filter(row => row.data.attemptsCount > 0 || row.data.topicsCount > 0);
    if (!rows.length) return panel("Дисциплины", emptyHint("Дисциплин или тем пока нет."));
    return panel("Дисциплины",
      ...rows.map(({ subject, data }) => h("div", { class: "analytics-subject" },
        h("div", { class: "section-title" },
          h("h3", {}, subject.title),
          h("span", { class: "muted" }, data.averageScore === null ? "нет оценённых попыток" : `средний: ${data.averageScore}%`)),
        h("div", { class: "stat-grid" },
          stat("Учеников", String(data.studentsCount)),
          stat("Тем", String(data.topicsCount)),
          stat("Завершено тем", String(data.completedTopics), `незавершено: ${data.incompleteTopics}`),
          stat("Активность (30 дн.)", data.activeStudentsPercent === null ? "—" : `${data.activeStudentsPercent}%`, `${data.activeStudents} из ${data.studentsCount}`)),
        progressMeter(data.masteryPercent, { label: "Освоение программы" }),
        h("div", { class: "btn-row" },
          h("a", { class: "btn secondary", href: `#discipline/${encodeURIComponent(subject.id)}` }, "К дисциплине")))));
  }

  function groupsSection(attempts, nowMs) {
    const groups = new Map();
    for (const a of attempts) {
      const gid = a.groupId || "";
      if (!groups.has(gid)) groups.set(gid, []);
      groups.get(gid).push(a);
    }
    if (!groups.size) return panel("Группы", emptyHint("Попыток с группой нет."));
    const rows = [...groups.entries()]
      .map(([gid, list]) => ({
        gid,
        avg: averagePercent(list.filter(a => a.status === "graded" && Number.isFinite(a.percent)).map(a => a.percent))
      }))
      .filter(row => row.avg !== null)
      .sort((a, b) => b.avg - a.avg);
    const bars = barChart(rows.map(r => ({
      label: r.gid || "Без группы",
      value: r.avg
    })), { ariaLabel: "Сравнение групп по среднему баллу" });

    const f = state.filters;
    const selected = f.groupId
      ? groupAnalytics({
        attempts,
        students: state.students.filter(s => (s.groupId || "") === f.groupId),
        topics: scopeTopics(),
        nowMs
      })
      : null;

    const completed = selected
      ? assignmentCompletion({
        attempts,
        students: state.students.filter(s => (s.groupId || "") === f.groupId),
        assignments: state.assignments.filter(a => a.groupId === f.groupId),
        nowMs
      })
      : null;

    return panel("Группы",
      bars || emptyHint("Оценённых попыток по группам нет."),
      !selected && !f.groupId ? emptyHint("Выберите группу в фильтре — появятся рейтинг, отстающие и сравнение тем.") : null,
      selected ? groupDetails(selected, completed) : null);
  }

  function groupDetails(selected, completed) {
    const topicBars = selected.topicComparison.length
      ? barChart(selected.topicComparison.map(t => ({
        label: t.title,
        value: t.averageScore,
        hint: `${t.averageScore}% (${t.count})`
      })), { ariaLabel: "Сравнение тем группы по среднему баллу" })
      : emptyHint("Оценённых попыток по темам группы нет.");
    const ranking = selected.ranking.length
      ? h("table", { class: "analytics-table" },
        h("thead", {}, h("tr", {},
          h("th", {}, "Ученик"), h("th", {}, "Средний"), h("th", {}, "Попыток"), h("th", {}, "Лучший"), h("th", {}, "Активность"))),
        h("tbody", {}, selected.ranking.map(r => h("tr", {},
          h("td", {}, r.name),
          h("td", {}, r.averageScore === null ? "—" : `${r.averageScore}%`),
          h("td", {}, String(r.attemptsCount)),
          h("td", {}, r.bestScore === null ? "—" : `${r.bestScore}%`),
          h("td", {}, r.inactive ? "нет 30+ дней" : "есть")))))
      : emptyHint("Учеников группы с попытками нет.");
    return h("div", {},
      h("div", { class: "stat-grid" },
        stat("Учеников", String(selected.studentsCount)),
        stat("Средний балл", selected.averageScore === null ? "—" : `${selected.averageScore}%`),
        stat("Активность (30 дн.)", selected.activeStudentsPercent === null ? "—" : `${selected.activeStudentsPercent}%`),
        stat("Задания выполнены", completed?.percent === null || completed?.percent === undefined ? "—" : `${completed.percent}%`, completed ? `${completed.done} из ${completed.total}` : "")),
      h("h3", { class: "sub-title" }, "Учебный рейтинг группы"),
      ranking,
      h("h3", { class: "sub-title" }, "Сравнение тем"),
      topicBars,
      h("div", { class: "btn-row" },
        h("a", { class: "btn secondary", href: "#leaderboard" }, "Рейтинг по тестам")),
      selected.lagging.length
        ? h("div", {},
          h("h3", { class: "sub-title" }, `Отстающие (средний ниже ${TOPIC_PASS_PERCENT}%)`),
          listRows(selected.lagging.map(r => ({ title: r.name, value: r.averageScore === null ? "—" : `${r.averageScore}%` }))))
        : null,
      selected.inactive.length
        ? h("div", {},
          h("h3", { class: "sub-title" }, "Без активности (30+ дней)"),
          listRows(selected.inactive.map(r => ({ title: r.name, value: r.lastActivityMs ? new Date(r.lastActivityMs).toLocaleDateString("ru-RU") : "нет попыток" }))))
        : null);
  }

  function studentsSection(attempts, nowMs) {
    const f = state.filters;
    if (f.userId) {
      const student = state.students.find(s => s.uid === f.userId);
      const data = studentAnalytics({
        attempts,
        subjects: state.subjects,
        topics: state.topics,
        assignments: state.assignments.filter(a => a.groupId === (student?.groupId || "")),
        nowMs
      });
      return panel(`Ученик: ${student?.fullName || f.userId}`,
        h("div", { class: "stat-grid" },
          stat("Средний балл", data.averageScore || 0 ? `${data.averageScore}%` : "—", data.bestScore ? `лучший: ${data.bestScore}%` : ""),
          stat("Выполнено тестов", String(data.testsCompleted)),
          stat("Изучено материалов", String(data.studiedMaterialsCount)),
          stat("Просрочено заданий", String(data.overdueAssignments.length))),
        dynamicsSection(attempts, nowMs),
        data.subjectsProgress.length
          ? barChart(data.subjectsProgress.filter(s => s.averageScore !== null).map(s => ({
            label: s.title, value: s.averageScore, hint: s.averageScore === null ? "—" : `${s.averageScore}%`
          })), { ariaLabel: "Результаты по дисциплинам" })
          : emptyHint("Попыток по дисциплинам нет."),
        data.strongTopics.length ? listRows(data.strongTopics.slice(0, 5).map(t => ({ title: `Сильная тема: ${t.title}`, value: `${t.averageScore}%` }))) : null,
        data.weakTopics.length ? listRows(data.weakTopics.slice(0, 5).map(t => ({ title: `Слабая тема: ${t.title}`, value: `${t.averageScore}%` }))) : null,
        data.overdueAssignments.length ? listRows(data.overdueAssignments.map(a => ({ title: `Просрочено: ${a.testTitle}`, value: new Date(a.deadlineMs).toLocaleDateString("ru-RU") }))) : null,
        h("div", { class: "btn-row" },
          h("a", { class: "btn secondary", href: `#profile/${encodeURIComponent(f.userId)}` }, "Профиль ученика")));
    }

    // Рейтинг по учебным результатам (не Live-рейтинг).
    const byStudent = new Map();
    for (const a of attempts.filter(x => x.status === "graded" && Number.isFinite(x.percent))) {
      if (!byStudent.has(a.userId)) byStudent.set(a.userId, []);
      byStudent.get(a.userId).push(a.percent);
    }
    const lastActivity = new Map();
    for (const a of attempts) {
      const ms = a.finishedAt?.toMillis?.() || a.startedAt?.toMillis?.() || 0;
      if (ms > (lastActivity.get(a.userId) || 0)) lastActivity.set(a.userId, ms);
    }
    const ranking = state.students.map(s => {
      const scores = byStudent.get(s.uid) || [];
      const ms = lastActivity.get(s.uid) || null;
      return {
        uid: s.uid,
        name: s.fullName || s.uid,
        averageScore: averagePercent(scores),
        attemptsCount: scores.length,
        bestScore: scores.length ? Math.max(...scores) : null,
        inactive: ms === null || nowMs - ms > 30 * DAY
      };
    }).sort((a, b) => (b.averageScore ?? -1) - (a.averageScore ?? -1)
      || a.name.localeCompare(b.name, "ru", { sensitivity: "base" }));
    if (!state.students.length) return panel("Ученики", emptyHint("Учеников в зоне видимости роли нет."));
    return panel("Ученики",
      h("table", { class: "analytics-table" },
        h("thead", {}, h("tr", {},
          h("th", {}, "Ученик"), h("th", {}, "Средний"), h("th", {}, "Попыток"), h("th", {}, "Лучший"), h("th", {}))),
        h("tbody", {}, ranking.map(r => h("tr", {},
          h("td", {}, r.name),
          h("td", {}, r.averageScore === null ? "—" : `${r.averageScore}%`),
          h("td", {}, String(r.attemptsCount)),
          h("td", {}, r.bestScore === null ? "—" : `${r.bestScore}%`),
          h("td", {}, h("a", {
            class: "btn secondary",
            href: "#",
            onclick: (e) => { e.preventDefault(); state.filters.userId = r.uid; paint(); }
          }, "Отчёт")))))),
      emptyHint("Рейтинг учебный (средний балл попыток). Live-рейтинг комнат считается отдельно."));
  }

  function assignmentsSection(attempts, nowMs) {
    const f = state.filters;
    const completed = assignmentCompletion({
      attempts,
      students: f.groupId ? state.students.filter(s => s.groupId === f.groupId) : state.students,
      assignments: state.assignments.filter(a => !f.groupId || a.groupId === f.groupId),
      nowMs
    });
    return panel("Задания",
      h("div", { class: "stat-grid" },
        stat("Назначено", String(completed.total)),
        stat("Выполнено", String(completed.done), completed.percent === null ? "" : `${completed.percent}%`),
        stat("Просрочено (без попытки)", String(completed.overdueRows.length))),
      completed.total === 0
        ? emptyHint("Активных заданий по выбранным фильтрам нет.")
        : completed.overdueRows.length
          ? listRows(completed.overdueRows.slice(0, 10).map(r => ({
            title: `${r.name} — ${r.testTitle}`,
            value: new Date(r.deadlineMs).toLocaleDateString("ru-RU")
          })))
          : emptyHint("Просроченных заданий без попыток нет."));
  }

  function weakTopicsSection(attempts) {
    // Существующая логика страницы «Слабые темы» — сохранена: средний
    // балл по темам, топ-5 худших.
    const completed = attempts.filter(a => a.status === "graded" && a.topicId);
    const topicMap = new Map();
    completed.forEach(a => {
      if (!topicMap.has(a.topicId)) topicMap.set(a.topicId, { scoreSum: 0, count: 0, title: topicTitle(a.topicId) });
      const t = topicMap.get(a.topicId);
      t.scoreSum += a.percent;
      t.count += 1;
    });
    const weakTopics = Array.from(topicMap.entries())
      .map(([id, data]) => ({ id, title: data.title, avg: Math.round(data.scoreSum / data.count), count: data.count }))
      .sort((a, b) => a.avg - b.avg)
      .slice(0, 5);
    const rows = weakTopics.length
      ? h("div", { class: "list" }, weakTopics.map(t => h("div", { class: "list-row" },
        h("div", { class: "list-row-main" },
          h("div", { class: "list-row-title" }, h("a", { href: `#topic-analytics/${encodeURIComponent(t.id)}` }, t.title)),
          h("div", { class: "list-row-sub" }, `попыток: ${t.count}`)),
        h("div", { class: "badge badge-warning" }, `${t.avg}%`))))
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
