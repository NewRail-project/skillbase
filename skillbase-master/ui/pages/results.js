import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { listOrgAttempts } from "../../core/attempts.js";
import { loadPublicProfiles, displayName } from "../../core/profile.js";
import { toCsv } from "../../shared/csv.js";
import { icons } from "../../shared/icons.js";

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
    "Участник": r.student,
    "Почта": r.email,
    "Тест": r.test,
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

export default async function ResultsPage() {
  const page = h("div", { class: "page" });

  const head = h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Аналитика"),
      h("h1", {}, "Результаты"),
      h("p", { class: "page-sub" }, "Попытки сотрудников вашей организации. Выгрузка — в CSV для Excel.")
    ),
    h("div", { class: "page-head-actions" })
  );
  page.appendChild(head);

  const exportBtn = h("button", { type: "button", class: "btn secondary", disabled: "disabled" }, "Экспорт CSV");
  head.querySelector(".page-head-actions").appendChild(exportBtn);

  const stats = h("section", { class: "stat-grid" });
  page.appendChild(stats);

  const search = h("input", { type: "search", placeholder: "Поиск по участнику или тесту", "aria-label": "Поиск по результатам" });
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
          : "Результаты появятся, когда участники пройдут опубликованные тесты.")
      ));
      return;
    }

    const table = h("div", { class: "table-wrap" });
    const el = h("table", { class: "table" },
      h("thead", {}, h("tr", {},
        h("th", {}, "Участник"),
        h("th", {}, "Тест"),
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
