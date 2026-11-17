// ui/pages/leaderboard.js — УЧЕБНЫЙ рейтинг студентов (маршрут #leaderboard).
// Средний балл оценённых попыток; фильтры по дисциплине и группе. Live-рейтинг
// комнат (ui/components/leaderboard.js) здесь не используется и не смешивается.
// Данные: живая подписка на попытки организации — новые результаты
// появляются сами; список перерисовывается только при изменении подписи строк.
import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { subscribeOrgAttempts } from "../../core/attempts.js";
import { rankedLeaderboard } from "../../core/analytics-logic.js";
import { teacherCanSeeAttempt } from "../../core/access.js";
import { getSubjects } from "../../core/subjects.js";
import { listOrgUsers } from "../../core/admins.js";
import { gradeLabel } from "../../core/score-format.js";

// Активная подписка страницы: роутер вызывает module.cleanup() при уходе.
let activeUnsub = null;
export function cleanup() {
  if (activeUnsub) {
    try { activeUnsub(); } catch (e) { /* уже отписаны */ }
    activeUnsub = null;
  }
}

// Строка таблицы рейтинга: место (медали у первых трёх), ФИО, средний балл
// с полосой, число попыток, лучший балл. Оценка — в баллах.
function rateRow(row) {
  const medal = row.place <= 3 ? ` rate-medal-${row.place}` : "";
  return h("tr", { class: `rate-row${medal}` },
    h("td", { class: "rate-col-place" }, h("span", { class: "rate-place", "aria-label": `${row.place} место` }, String(row.place))),
    h("td", { class: "rate-col-name" }, row.name),
    h("td", { class: "rate-col-score" },
      h("span", { class: "rate-score" }, gradeLabel(row.average)),
      h("span", { class: "rate-track", role: "img", "aria-label": `Средний балл ${row.average}` },
        h("span", { class: `rate-fill is-${row.level}`, style: `width:${row.average}%` }))),
    h("td", { class: "num" }, String(row.count)),
    h("td", { class: "num" }, gradeLabel(row.best)));
}

function rateTable(rows) {
  return h("div", { class: "analytics-table-wrap" },
    h("table", { class: "rate-table" },
      h("thead", {}, h("tr", {},
        h("th", {}, "Место"), h("th", {}, "ФИО"), h("th", {}, "Средний балл"),
        h("th", { class: "num" }, "Попыток"), h("th", { class: "num" }, "Лучший"))),
      h("tbody", {}, rows.map(rateRow))));
}

export default async function LeaderboardPage() {
  cleanup(); // защита от повторного входа без ухода (перезапуск маршрута)
  const page = h("div", { class: "page" });
  page.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Рейтинг"),
      h("h1", {}, "Рейтинг студентов"),
      h("p", { class: "page-sub" }, "Учебный рейтинг: средний балл (0–100) оценённых попыток. Live-рейтинг комнат считается отдельно."))));

  const loader = h("div", { class: "spinner" });
  page.appendChild(loader);

  const subjects = await getSubjects();

  const subjectSelect = h("select", { "aria-label": "Фильтр по дисциплине" }, h("option", { value: "" }, "Все дисциплины"));
  subjects.forEach(s => subjectSelect.appendChild(h("option", { value: s.id }, s.title)));
  const groupSelect = h("select", { "aria-label": "Фильтр по группе" }, h("option", { value: "" }, "Все группы"));
  page.appendChild(h("div", { class: "analytics-filters" },
    h("div", { class: "analytics-filter" }, subjectSelect),
    h("div", { class: "analytics-filter" }, groupSelect)));

  const summary = h("p", { class: "rate-summary" });
  page.appendChild(summary);
  const grid = h("div", { class: "leaderboard-grid" });
  page.appendChild(grid);

  let attempts = [];
  let names = new Map(); // uid → ФИО из списка учеников
  let currentSubject = "";
  let currentGroup = "";
  let lastRowsSig = null; // подпись строк: перестраиваем список только при изменении

  // Группы, доступные для выбранной дисциплины; несовместимый выбор сбрасывается.
  function syncGroups() {
    const groups = [...new Set(attempts
      .filter(a => a.groupId && (!currentSubject || a.subjectId === currentSubject))
      .map(a => a.groupId))].sort((a, b) => a.localeCompare(b, "ru"));
    if (currentGroup && !groups.includes(currentGroup)) currentGroup = "";
    groupSelect.textContent = "";
    groupSelect.appendChild(h("option", { value: "", selected: !currentGroup }, "Все группы"));
    groups.forEach(g => groupSelect.appendChild(h("option", { value: g, selected: g === currentGroup }, g)));
  }

  function draw() {
    const data = rankedLeaderboard(attempts, {
      orgId: State.profile.orgId, subjectId: currentSubject || null,
      groupId: currentGroup || null, names
    });
    const sig = `${currentSubject}|${currentGroup}|${data.map(r => `${r.userId}:${r.place}:${r.average}:${r.count}:${r.best}:${r.name}`).join(",")}`;
    if (sig === lastRowsSig) return; // обновление без перерисовки списка
    lastRowsSig = sig;
    grid.textContent = "";
    if (!data.length) {
      summary.textContent = "";
      grid.appendChild(h("div", { class: "empty-state" }, "Нет результатов для отображения."));
      return;
    }
    const overall = Math.round(data.reduce((s, r) => s + r.average, 0) / data.length);
    summary.textContent = `Студентов в рейтинге: ${data.length} · средний балл: ${gradeLabel(overall)}`;
    grid.appendChild(rateTable(data));
  }

  subjectSelect.onchange = () => {
    currentSubject = subjectSelect.value;
    lastRowsSig = null; // смена фильтра — принудительная перерисовка списка
    syncGroups();
    draw();
  };
  groupSelect.onchange = () => {
    currentGroup = groupSelect.value;
    lastRowsSig = null;
    draw();
  };

  // Живая подписка вместо разового чтения: новые проверенные попытки
  // появляются в рейтинге сами, без перезагрузки страницы. Обновляется
  // только список (grid), страница целиком не пересобирается и не мигает.
  try {
    activeUnsub = subscribeOrgAttempts(State.profile.orgId, {
      onAttempts: fresh => {
        attempts = fresh.filter(a => teacherCanSeeAttempt(a, State.profile));
        loader.remove();
        syncGroups();
        draw();
      },
      onError: () => {
        loader.remove();
        grid.textContent = "";
        grid.appendChild(h("div", { class: "empty-state" },
          "Не удалось загрузить результаты. Проверьте подключение к сети."));
      }
    });
  } catch (err) {
    console.error("Рейтинг:", err);
    loader.remove();
    grid.appendChild(h("div", { class: "empty-state" }, "Не удалось загрузить результаты."));
  }

  // ФИО учеников: в попытке имя может отсутствовать. Не критично — при
  // отказе (нет прав на список) остаются имена из попыток.
  listOrgUsers(State.profile.orgId).then(users => {
    names = new Map(users.filter(u => u.role === "student" && u.fullName).map(u => [u.uid, u.fullName]));
    lastRowsSig = null;
    draw();
  }).catch(() => { /* имена из попыток */ });

  return page;
}
