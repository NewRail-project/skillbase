import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { listOrgAttempts, deleteAttempts } from "../../core/attempts.js";
import { loadPublicProfiles, displayName } from "../../core/profile.js";
import { toCsv } from "../../shared/csv.js";
import { icons } from "../../shared/icons.js";
import { t as tr, lt } from "../../core/i18n.js";
import { gradeDistribution, performanceDynamics, averagePercent } from "../../core/analytics-logic.js";
import { barChart, lineChart } from "../components/charts.js";
import { gradeLabel, attemptResultLabel } from "../../core/score-format.js";
import { getSubjects } from "../../core/subjects.js";
import { confirmAction } from "../components/confirm.js";
import { toast } from "../components/toast.js";
import {
  filterResultRows, filterOptions, planDeletion, impactLines, needsTypedConfirmation, DELETE_PHRASE, canDeleteAttempt
} from "../../core/results-manage-logic.js";

function formatDate(value) {
  if (!value) return "—";
  const date = value.toDate ? value.toDate() : value.seconds ? new Date(value.seconds * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

function explainError(err) {
  if (err?.code === "permission-denied") {
    return "Правила Firestore не разрешают чтение попыток организации.";
  }
  if (err?.code === "failed-precondition") {
    return "Firestore отклонил запрос. Проверьте права доступа и настройки индексов.";
  }
  return "Не удалось загрузить результаты. Проверьте подключение к сети.";
}

function downloadCsv(rows) {
  const data = rows.map(r => ({
    [tr("res.colUser")]: r.student,
    "Почта": r.email,
    [tr("res.colTest")]: r.test,
    "Балл": r.score,
    "Всего": r.total,
    "Процент": r.percent === null ? "" : r.percent,
    "Статус": r.status === "graded"
      ? "Проверено"
      : r.status === "in_progress" ? "Не завершена" : "Ожидает",
    "Отправлено": r.submitted
  }));
  const blob = new Blob([toCsv(data)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: `skillbase-results-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Аналитика обычных тестов: распределение оценок, динамика, сравнение
// тестов, лидеры и ученики, которым нужна помощь. Считается по тем же
// проверенным попыткам, что и таблица ниже (черновики и неоценённые
// попытки в итог не входят).
function analyticsPanel(rows) {
  const graded = rows.filter(r => r.percent !== null);
  if (!graded.length) return null;
  const percents = graded.map(r => r.percent);
  const dist = gradeDistribution(percents);
  const dynamics = performanceDynamics(graded.map(r => r.raw), Date.now());

  const byTest = new Map();
  for (const r of graded) {
    if (!byTest.has(r.test)) byTest.set(r.test, []);
    byTest.get(r.test).push(r.percent);
  }
  const testBars = [...byTest].map(([label, list]) => ({ label, value: averagePercent(list) }))
    .map(x => ({ ...x, hint: gradeLabel(x.value) }))
    .filter(x => x.value !== null).sort((a, b) => b.value - a.value).slice(0, 8);

  const best = new Map();
  for (const r of graded) best.set(r.student, Math.max(best.get(r.student) ?? 0, r.percent));
  const leaders = [...best].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([label, value]) => ({ label, value, hint: gradeLabel(value) }));
  const needHelp = [...best].filter(([, v]) => v < 50).sort((a, b) => a[1] - b[1]).slice(0, 5)
    .map(([label, value]) => ({ label, value, hint: gradeLabel(value) }));

  const section = (title, node) => h("section", { class: "panel" },
    h("div", { class: "panel-head" }, h("h2", {}, title)),
    h("div", { class: "panel-body" }, node));
  const wrap = h("div", { class: "analytics-after-test" },
    h("div", { class: "stat-grid" },
      h("div", { class: "stat" }, h("div", { class: "stat-value" }, gradeLabel(Math.max(...percents))), h("div", { class: "stat-label" }, "лучший результат")),
      h("div", { class: "stat" }, h("div", { class: "stat-value" }, gradeLabel(Math.min(...percents))), h("div", { class: "stat-label" }, "худший результат")),
      h("div", { class: "stat" }, h("div", { class: "stat-value" }, String(new Set(graded.map(r => r.student)).size)), h("div", { class: "stat-label" }, "участников"))),
    dist ? section("Распределение оценок", barChart(dist.buckets.map(b => ({ label: b.label, value: b.count, hint: String(b.count) })),
      { ariaLabel: "Распределение оценок", max: Math.max(1, ...dist.buckets.map(b => b.count)) })) : null,
    dynamics ? section("Динамика среднего балла", lineChart(dynamics.map(p => ({ label: p.label, value: p.avgPercent })),
      { ariaLabel: "Динамика среднего балла по неделям" })) : null,
    testBars.length > 1 ? section("Сравнение тестов", barChart(testBars, { ariaLabel: "Средний балл по тестам" })) : null,
    leaders.length ? section("Лучшие результаты", barChart(leaders, { ariaLabel: "Лучшие результаты" })) : null,
    needHelp.length ? section("Нужна помощь (ниже 50 б.)", barChart(needHelp, { ariaLabel: "Ученики с низким результатом" })) : null);
  const details = h("details", { class: "analytics-details", open: "open" },
    h("summary", { class: "btn secondary" }, "Аналитика по тестам"), wrap);
  return details;
}

function attemptMs(a) {
  const v = a.submittedAt || a.startedAt;
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

const STATUS_LABEL = { graded: "Проверено", in_progress: "Не завершена", submitted: "Ожидает" };

export default async function ResultsPage() {
  const page = h("div", { class: "page" });

  const head = h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Аналитика"),
      h("h1", {}, lt("res.title")),
      h("p", { class: "page-sub" }, lt("res.sub"))
    ),
    h("div", { class: "page-head-actions" })
  );
  page.appendChild(head);

  const exportBtn = h("button", { type: "button", class: "btn secondary", disabled: "disabled" }, "Экспорт CSV");
  head.querySelector(".page-head-actions").appendChild(exportBtn);

  const stats = h("section", { class: "stat-grid" });
  page.appendChild(stats);
  let analyticsNode = null;

  // ---- Фильтры: поиск, группа, дисциплина, тест, статус, период ----
  const search = h("input", { type: "search", placeholder: lt("res.search"), "aria-label": lt("res.search") });
  const mkSelect = (label) => h("select", { "aria-label": label }, h("option", { value: "" }, label));
  const groupSel = mkSelect("Все группы");
  const subjectSel = mkSelect("Все дисциплины");
  const testSel = mkSelect("Все тесты");
  const statusSel = h("select", { "aria-label": "Статус" },
    h("option", { value: "" }, "Любой статус"),
    h("option", { value: "graded" }, "Проверено"),
    h("option", { value: "submitted" }, "Ожидает проверки"),
    h("option", { value: "in_progress" }, "Не завершена"));
  const fromInput = h("input", { type: "date", "aria-label": "Период: с" });
  const toInput = h("input", { type: "date", "aria-label": "Период: по" });
  const resetBtn = h("button", { type: "button", class: "btn secondary btn-sm" }, "Сбросить");
  const filters = h("div", { class: "filter-bar results-filters" },
    search, groupSel, subjectSel, testSel, statusSel,
    h("label", { class: "results-period" }, h("span", { class: "muted" }, "с"), fromInput),
    h("label", { class: "results-period" }, h("span", { class: "muted" }, "по"), toInput),
    resetBtn);
  page.appendChild(filters);

  // ---- Панель выбора и массового удаления ----
  const selectedCount = h("b", {}, "0");
  const bulkDelete = h("button", { type: "button", class: "btn danger btn-sm", disabled: "disabled" }, "Удалить выбранные");
  const clearSel = h("button", { type: "button", class: "btn secondary btn-sm" }, "Снять выбор");
  const bulkBar = h("div", { class: "results-bulk", role: "region", "aria-label": "Выбранные результаты", hidden: "hidden" },
    h("span", {}, "Выбрано: ", selectedCount), bulkDelete, clearSel);
  page.appendChild(bulkBar);

  const panel = h("section", { class: "panel panel-flush" });
  const body = h("div", { class: "list" });
  panel.appendChild(body);
  page.appendChild(panel);

  let rows = [];
  let subjectNames = new Map();
  const selected = new Set();
  let visibleRows = [];
  const me = () => State.profile;
  const canDelete = (r) => canDeleteAttempt(r.raw, me()).allowed;

  const currentFilter = () => ({
    query: search.value, groupId: groupSel.value, subjectId: subjectSel.value, testId: testSel.value,
    status: statusSel.value, from: fromInput.value, to: toInput.value
  });

  function fillSelect(sel, options, keep) {
    const first = sel.firstChild;
    sel.replaceChildren(first, ...options.map(o => h("option", { value: o.value }, o.label)));
    sel.value = options.some(o => o.value === keep) ? keep : "";
  }
  function refreshFilterOptions() {
    const opts = filterOptions(rows);
    fillSelect(groupSel, opts.groups.map(g => ({ value: g, label: `Группа ${g}` })), groupSel.value);
    fillSelect(subjectSel, opts.subjects.map(id => ({ value: id, label: subjectNames.get(id) || "Дисциплина" })), subjectSel.value);
    fillSelect(testSel, opts.tests.map(t => ({ value: t.id, label: t.title })), testSel.value);
  }

  function updateBulkBar() {
    selectedCount.textContent = String(selected.size);
    bulkBar.hidden = selected.size === 0;
    bulkDelete.disabled = selected.size === 0;
  }

  // Статистика и аналитика строятся из текущих rows: после удаления обновляются.
  function renderSummary() {
    stats.replaceChildren();
    analyticsNode?.remove();
    analyticsNode = null;
    const graded = rows.filter(r => r.percent !== null);
    const avg = graded.length ? Math.round(graded.reduce((sum, r) => sum + r.percent, 0) / graded.length) : null;
    const pending = rows.filter(r => r.status === "submitted").length;
    const stat = (value, label) => h("div", { class: "stat" }, h("div", { class: "stat-value" }, value), h("div", { class: "stat-label" }, label));
    stats.append(stat(String(rows.length), "всего попыток"), stat(String(graded.length), "проверено"),
      stat(gradeLabel(avg), "средний балл"), stat(String(pending), "ожидают проверки"));
    analyticsNode = analyticsPanel(rows);
    if (analyticsNode) stats.after(analyticsNode);
    exportBtn.disabled = rows.length === 0;
  }

  async function deleteRows(ids) {
    const plan = planDeletion(rows, ids, me());
    if (!plan.allowed.length) {
      toast(plan.blocked[0]?.reason || "Нечего удалять.", "error");
      return;
    }
    const n = plan.allowed.length;
    const names = plan.allowed.slice(0, 4).map(r => `${r.student} — ${r.test}`);
    const details = [
      ...impactLines(plan.summary).map((line, i) => h("p", { class: i === 0 ? "" : "muted" }, line)),
      h("ul", { class: "muted" }, ...names.map(x => h("li", {}, x)), n > 4 ? h("li", {}, `…и ещё ${n - 4}`) : null)
    ];
    if (plan.blocked.length) details.push(h("p", { class: "warning-msg" }, `Не будет удалено: ${plan.blocked.length} (${plan.blocked[0].reason})`));
    const ok = await confirmAction({
      title: n === 1 ? "Удалить результат?" : `Удалить результатов: ${n}?`,
      details, confirmLabel: "Удалить безвозвратно", tone: "danger",
      requirePhrase: needsTypedConfirmation(n) ? DELETE_PHRASE : null
    });
    if (!ok) return;
    bulkDelete.disabled = true;
    let result;
    try {
      result = await deleteAttempts(plan.allowed.map(r => r.id));
    } catch (err) {
      console.error("Удаление результатов:", err);
      toast("Не удалось удалить результаты. Проверьте подключение.", "error");
      updateBulkBar();
      return;
    }
    const gone = new Set(result.deleted);
    rows = rows.filter(r => !gone.has(r.id));
    gone.forEach(id => selected.delete(id));
    if (result.failed.length) {
      const denied = result.failed.some(f => f.code === "permission-denied");
      toast(`Удалено: ${result.deleted.length}. Не удалось: ${result.failed.length}.${denied ? " Правила Firestore не разрешили удаление — проверьте, что обновлённые правила опубликованы." : ""}`, "error");
    } else {
      toast(n === 1 ? "Результат удалён." : `Удалено результатов: ${result.deleted.length}.`, "success");
    }
    refreshFilterOptions();
    renderSummary();
    draw();
  }

  function draw() {
    visibleRows = filterResultRows(rows, currentFilter());
    // Скрытое фильтром не должно оставаться выбранным: массовое удаление
    // действует только на то, что пользователь видит.
    const visibleIds = new Set(visibleRows.map(r => r.id));
    for (const id of [...selected]) if (!visibleIds.has(id)) selected.delete(id);
    updateBulkBar();

    body.textContent = "";
    if (!visibleRows.length) {
      body.appendChild(h("div", { class: "empty-state" },
        h("div", { class: "empty-state-icon", innerHTML: icons.chart }),
        h("h2", {}, rows.length ? "Ничего не найдено" : "Попыток пока нет"),
        h("p", { class: "muted" }, rows.length ? "Измените поиск или фильтры." : lt("res.emptyHint"))
      ));
      return;
    }

    const deletableVisible = visibleRows.filter(canDelete);
    const allBox = h("input", { type: "checkbox", "aria-label": "Выбрать все показанные результаты" });
    allBox.checked = deletableVisible.length > 0 && deletableVisible.every(r => selected.has(r.id));
    allBox.disabled = deletableVisible.length === 0;
    allBox.addEventListener("change", () => {
      deletableVisible.forEach(r => (allBox.checked ? selected.add(r.id) : selected.delete(r.id)));
      draw();
    });

    const table = h("div", { class: "table-wrap" });
    const el = h("table", { class: "table table-stack" },
      h("thead", {}, h("tr", {},
        h("th", {}, h("label", { class: "results-check" }, allBox, h("span", {}, lt("res.colUser")))),
        h("th", {}, lt("res.colTest")),
        h("th", {}, "Оценка (баллы)"),
        h("th", {}, "Статус"),
        h("th", {}, "Отправлено"),
        h("th", {}, "Действия")
      ))
    );
    const tbody = h("tbody");
    visibleRows.forEach(r => {
      const badge = r.status === "graded" ? "badge-success" : r.status === "in_progress" ? "badge-warning" : "badge-info";
      const deletable = canDelete(r);
      const box = h("input", { type: "checkbox", "aria-label": `Выбрать: ${r.student}, ${r.test}` });
      box.checked = selected.has(r.id);
      box.disabled = !deletable;
      if (!deletable) box.title = canDeleteAttempt(r.raw, me()).reason;
      box.addEventListener("change", () => {
        if (box.checked) selected.add(r.id); else selected.delete(r.id);
        updateBulkBar();
        allBox.checked = deletableVisible.length > 0 && deletableVisible.every(x => selected.has(x.id));
      });
      tbody.appendChild(h("tr", { "data-selected": selected.has(r.id) ? "1" : "0" },
        h("td", {},
          h("label", { class: "results-check" }, box,
            h("span", {},
              h("div", { class: "list-row-title" },
                r.student,
                r.guest ? h("span", { class: "badge badge-neutral", style: "margin-left:6px" }, "Гость") : null),
              h("div", { class: "list-row-sub" }, r.email || "—")))),
        h("td", {}, r.test || "—"),
        h("td", {}, attemptResultLabel({ percent: r.percent, score: r.score, total: r.total })),
        h("td", {}, h("span", { class: "badge " + badge }, STATUS_LABEL[r.status] || "Ожидает")),
        h("td", { class: "muted" }, r.submitted),
        h("td", { class: "results-actions" },
          h("a", { class: "btn secondary btn-sm", href: `#review/${encodeURIComponent(r.id)}` }, r.status === "graded" ? "Открыть" : "Проверить"),
          deletable
            ? h("button", { type: "button", class: "btn secondary btn-sm danger-text", "aria-label": `Удалить результат: ${r.student}`, onclick: () => deleteRows([r.id]) }, "Удалить")
            : null)
      ));
    });
    el.appendChild(tbody);
    table.appendChild(el);
    body.appendChild(table);
  }

  for (const control of [search, groupSel, subjectSel, testSel, statusSel, fromInput, toInput]) {
    control.addEventListener(control === search ? "input" : "change", draw);
  }
  resetBtn.addEventListener("click", () => {
    search.value = ""; groupSel.value = ""; subjectSel.value = ""; testSel.value = ""; statusSel.value = "";
    fromInput.value = ""; toInput.value = "";
    draw();
  });
  clearSel.addEventListener("click", () => { selected.clear(); draw(); });
  bulkDelete.addEventListener("click", () => deleteRows([...selected]));

  body.appendChild(h("div", { class: "panel-body" }, h("div", { class: "spinner" })));

  try {
    const attempts = await listOrgAttempts(State.profile.orgId, {
      groupIdFilter: isStaff() && State.profile?.teacherGroups && State.profile.teacherGroups.length ? State.profile.teacherGroups : null
    });
    let names = new Map();
    try {
      const profiles = await loadPublicProfiles(attempts.map(a => a.userId), State.profile.orgId);
      names = new Map(profiles.map(profile => [profile.id, displayName(profile, { viewerIsStaff: true, uid: profile.id })]));
    } catch (nameErr) {
      console.warn("Не удалось загрузить имена участников:", nameErr);
    }
    try {
      subjectNames = new Map((await getSubjects()).map(x => [x.id, x.title || "Дисциплина"]));
    } catch (subjErr) {
      console.warn("Названия дисциплин не загружены:", subjErr);
    }

    rows = attempts.map(a => {
      // Гостевая попытка: ФИО хранится в самой попытке (userName),
      // публичного профиля и аккаунта у гостя нет.
      const guestAttempt = a.guest === true;
      const name = guestAttempt
        ? (a.userName || "Гость")
        : (names.get(a.userId) || a.userName || (a.userEmail ? a.userEmail.split("@")[0] : "Участник"));
      return {
        id: a.id,
        userId: a.userId,
        student: name,
        // Дословная пометка вместо почты: гостю аккаунт не создавался.
        email: guestAttempt ? "гостевая попытка" : (a.userEmail || ""),
        guest: guestAttempt,
        test: a.testTitle || a.testId || "—",
        testId: a.testId || "",
        groupId: a.groupId || "",
        subjectId: a.subjectId || "",
        assignmentId: a.assignmentId || "",
        ms: attemptMs(a),
        score: a.score ?? 0,
        total: a.total ?? 0,
        percent: a.status === "graded" && a.total
          ? (Number.isFinite(a.percent) ? a.percent : Math.round((a.score / a.total) * 100))
          : null,
        status: a.status || "submitted",
        submitted: formatDate(a.submittedAt || a.startedAt),
        raw: a
      };
    });

    refreshFilterOptions();
    renderSummary();
    exportBtn.addEventListener("click", () => downloadCsv(visibleRows.length ? visibleRows : rows));
    draw();
  } catch (err) {
    console.error("Результаты:", err);
    body.textContent = "";
    body.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "empty-state-icon", innerHTML: icons.chart }),
      h("h2", {}, "Результаты недоступны"),
      h("p", { class: "muted" }, explainError(err)),
      h("button", { type: "button", class: "btn secondary", onclick: () => window.location.reload() }, "Повторить")
    ));
  }

  return page;
}
