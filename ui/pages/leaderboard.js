import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { subscribeOrgAttempts } from "../../core/attempts.js";
import { aggregateLeaderboard } from "../../core/analytics-logic.js";
import { getSubjects } from "../../core/subjects.js";

// Активная подписка страницы: роутер вызывает module.cleanup() при уходе.
let activeUnsub = null;
export function cleanup() {
  if (activeUnsub) {
    try { activeUnsub(); } catch (e) { /* уже отписаны */ }
    activeUnsub = null;
  }
}

export default async function LeaderboardPage() {
  cleanup(); // защита от повторного входа без ухода (перезапуск маршрута)
  const page = h("div", { class: "page" });
  page.appendChild(h("h1", {}, "Рейтинг студентов"));

  const loader = h("div", { class: "spinner" });
  page.appendChild(loader);

  const subjects = await getSubjects();

  const filters = h("div", { class: "filter-bar" });
  const subjectSelect = h("select", { class: "chip" }, h("option", { value: "" }, "Все предметы"));
  subjects.forEach(s => subjectSelect.appendChild(h("option", { value: s.id }, s.title)));

  filters.appendChild(subjectSelect);
  page.appendChild(filters);

  const grid = h("div", { class: "leaderboard-grid" });
  page.appendChild(grid);

  let attempts = [];
  let component = null; // ui/components/leaderboard.js — загружается один раз
  let currentSubject = "";
  let lastRowsSig = null; // подпись строк: перестраиваем список только при изменении

  function draw() {
    if (!component) return;
    const data = aggregateLeaderboard(attempts, { subjectId: currentSubject || null });
    const sig = `${currentSubject}|${data.map(r => `${r.userId}:${r.average}:${r.count}:${r.name}`).join(",")}`;
    if (sig === lastRowsSig) return; // обновление без перерисовки списка
    lastRowsSig = sig;
    grid.textContent = "";
    if (!data.length) {
      grid.appendChild(h("div", { class: "empty-state" }, "Нет результатов для отображения."));
      return;
    }
    const rows = data.map((r, i) => ({
      uid: r.userId,
      place: i + 1,
      name: r.name,
      score: r.average, // для таблицы используем среднее
      percent: r.average,
      answered: r.count,
      finished: r.count
    }));
    grid.appendChild(component.leaderList(rows, { board: true }));
  }

  subjectSelect.onchange = () => {
    currentSubject = subjectSelect.value;
    lastRowsSig = null; // смена фильтра — принудительная перерисовка списка
    draw();
  };

  // Живая подписка вместо разового чтения: новые проверенные попытки
  // появляются в рейтинге сами, без перезагрузки страницы. Обновляется
  // только список (grid), страница целиком не пересобирается и не мигает.
  try {
    activeUnsub = subscribeOrgAttempts(State.profile.orgId, {
      onAttempts: fresh => {
        attempts = fresh;
        loader.remove();
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

  // Компонент карточек подгружается один раз; снапшот может прийти раньше.
  import("../components/leaderboard.js").then(lb => {
    component = lb;
    lastRowsSig = null;
    draw();
  });

  return page;
}
