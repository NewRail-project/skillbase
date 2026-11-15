import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { listOrgAttempts } from "../../core/attempts.js";
import { loadPublicProfiles, displayName } from "../../core/profile.js";
import { toCsv } from "../../shared/csv.js";
import { icons } from "../../shared/icons.js";
import { t as tr, lt } from "../../core/i18n.js";
import { gradeDistribution, performanceDynamics, averagePercent } from "../../core/analytics-logic.js";
import { barChart, lineChart } from "../components/charts.js";

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
    .filter(x => x.value !== null).sort((a, b) => b.value - a.value).slice(0, 8);

  const best = new Map();
  for (const r of graded) best.set(r.student, Math.max(best.get(r.student) ?? 0, r.percent));
  const leaders = [...best].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([label, value]) => ({ label, value }));
  const needHelp = [...best].filter(([, v]) => v < 50).sort((a, b) => a[1] - b[1]).slice(0, 5)
    .map(([label, value]) => ({ label, value }));

  const section = (title, node) => h("section", { class: "panel" },
    h("div", { class: "panel-head" }, h("h2", {}, title)),
    h("div", { class: "panel-body" }, node));
  const wrap = h("div", { class: "analytics-after-test" },
    h("div", { class: "stat-grid" },
      h("div", { class: "stat" }, h("div", { class: "stat-value" }, `${Math.max(...percents)}%`), h("div", { class: "stat-label" }, "лучший результат")),
      h("div", { class: "stat" }, h("div", { class: "stat-value" }, `${Math.min(...percents)}%`), h("div", { class: "stat-label" }, "худший результат")),
      h("div", { class: "stat" }, h("div", { class: "stat-value" }, String(new Set(graded.map(r => r.student)).size)), h("div", { class: "stat-label" }, "участников"))),
    dist ? section("Распределение оценок", barChart(dist.buckets.map(b => ({ label: b.label, value: b.count, hint: String(b.count) })),
      { ariaLabel: "Распределение оценок", max: Math.max(1, ...dist.buckets.map(b => b.count)) })) : null,
    dynamics ? section("Динамика среднего балла", lineChart(dynamics.map(p => ({ label: p.label, value: p.avgPercent })),
      { ariaLabel: "Динамика среднего балла по неделям" })) : null,
    testBars.length > 1 ? section("Сравнение тестов", barChart(testBars, { ariaLabel: "Средний балл по тестам" })) : null,
    leaders.length ? section("Лучшие результаты", barChart(leaders, { ariaLabel: "Лучшие результаты" })) : null,
    needHelp.length ? section("Нужна помощь (ниже 50%)", barChart(needHelp, { ariaLabel: "Ученики с низким результатом" })) : null);
  const details = h("details", { class: "analytics-details", open: "open" },
    h("summary", { class: "btn secondary" }, "Аналитика по тестам"), wrap);
  return details;
}

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

  const search = h("input", { type: "search", placeholder: lt("res.search"), "aria-label": lt("res.search") });
  const filters = h("div", { class: "filter-bar" }, search);
  page.appendChild(filters);

  const panel = h("section", { class: "panel panel-flush" });
  const body = h("div", { class: "list" });
  panel.appendChild(body);
  page.appendChild(panel);

  let rows = [];

  function draw() {
    const query = search.value.trim().toLowerCase();
    const visible = rows.filter(r =>
      !query ||
      r.student.toLowerCase().includes(query) ||
      r.email.toLowerCase().includes(query) ||
      r.test.toLowerCase().includes(query)
    );

    body.textContent = "";
    if (!visible.length) {
      body.appendChild(h("div", { class: "empty-state" },
        h("div", { class: "empty-state-icon", innerHTML: icons.chart }),
        h("h2", {}, rows.length ? "Ничего не найдено" : "Попыток пока нет"),
        h("p", { class: "muted" }, rows.length
          ? "Измените поисковый запрос."
          : lt("res.emptyHint"))
      ));
      return;
    }

    const table = h("div", { class: "table-wrap" });
    const el = h("table", { class: "table" },
      h("thead", {}, h("tr", {},
        h("th", {}, lt("res.colUser")),
        h("th", {}, lt("res.colTest")),
        h("th", {}, "Результат"),
        h("th", {}, "Статус"),
        h("th", {}, "Отправлено"),
        h("th", {}, "Проверка")
      ))
    );
    const tbody = h("tbody");
    visible.forEach(r => {
      const statusLabel = r.status === "graded"
        ? "Проверено"
        : r.status === "in_progress"
          ? "Не завершена"
          : "Ожидает";
      const badge = r.status === "graded"
        ? "badge-success"
        : r.status === "in_progress"
          ? "badge-warning"
          : "badge-info";
      tbody.appendChild(h("tr", {},
        h("td", {},
          h("div", { class: "list-row-title" },
            r.student,
            r.guest ? h("span", { class: "badge badge-neutral", style: "margin-left:6px" }, "Гость") : null
          ),
          h("div", { class: "list-row-sub" }, r.email || "—")
        ),
        h("td", {}, r.test || "—"),
        h("td", {}, r.percent === null ? "—" : `${r.score} / ${r.total} · ${r.percent}%`),
        h("td", {}, h("span", { class: "badge " + badge }, statusLabel)),
        h("td", { class: "muted" }, r.submitted),
        h("td", {},
          h("a", {
            class: "btn secondary",
            href: `#review/${encodeURIComponent(r.id)}`
          }, r.status === "graded" ? "Открыть" : "Проверить")
        )
      ));
    });
    el.appendChild(tbody);
    table.appendChild(el);
    body.appendChild(table);
  }

  search.addEventListener("input", draw);

  body.appendChild(h("div", { class: "panel-body" }, h("div", { class: "spinner" })));

  try {
    const attempts = await listOrgAttempts(State.profile.orgId, {
      groupIdFilter: isStaff() && State.profile?.teacherGroups ? State.profile.teacherGroups : null
    });
    let names = new Map();
    try {
      const profiles = await loadPublicProfiles(
        attempts.map(a => a.userId),
        State.profile.orgId
      );
      names = new Map(profiles.map(profile => [
        profile.id,
        displayName(profile, { viewerIsStaff: true, uid: profile.id })
      ]));
    } catch (nameErr) {
      console.warn("Не удалось загрузить имена участников:", nameErr);
    }

    rows = attempts.map(a => {
      // Гостевая попытка: ФИО хранится в самой попытке (userName),
      // публичного профиля и аккаунта у гостя нет.
      const guestAttempt = a.guest === true;
      const name = guestAttempt
        ? (a.userName || "Гость")
        : (names.get(a.userId)
          || a.userName
          || (a.userEmail ? a.userEmail.split("@")[0] : "Участник"));
      return {
        id: a.id,
        student: name,
        // Дословная пометка вместо почты: гостю аккаунт не создавался.
        email: guestAttempt ? "гостевая попытка" : (a.userEmail || ""),
        guest: guestAttempt,
        test: a.testTitle || a.testId || "—",
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

    const graded = rows.filter(r => r.percent !== null);
    const avg = graded.length
      ? Math.round(graded.reduce((s, r) => s + r.percent, 0) / graded.length)
      : null;
    const pending = rows.filter(r => r.status === "submitted").length;

    stats.append(
      h("div", { class: "stat" },
        h("div", { class: "stat-value" }, String(rows.length)),
        h("div", { class: "stat-label" }, "всего попыток")
      ),
      h("div", { class: "stat" },
        h("div", { class: "stat-value" }, String(graded.length)),
        h("div", { class: "stat-label" }, "проверено")
      ),
      h("div", { class: "stat" },
        h("div", { class: "stat-value" }, avg === null ? "—" : avg + "%"),
        h("div", { class: "stat-label" }, "средний результат")
      ),
      h("div", { class: "stat" },
        h("div", { class: "stat-value" }, String(pending)),
        h("div", { class: "stat-label" }, "ожидают проверки")
      )
    );

    const analytics = analyticsPanel(rows);
    if (analytics) stats.after(analytics);

    if (rows.length) {
      exportBtn.disabled = false;
      exportBtn.addEventListener("click", () => downloadCsv(rows));
    }
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
