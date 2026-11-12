import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { listOrgAttempts } from "../../core/attempts.js";
import { aggregateLeaderboard } from "../../core/analytics-logic.js";
import { getSubjects } from "../../core/subjects.js";
import { icons } from "../../shared/icons.js";

export default async function LeaderboardPage() {
  const page = h("div", { class: "page" });
  page.appendChild(h("h1", {}, "Рейтинг студентов"));

  const loader = h("div", { class: "spinner" });
  page.appendChild(loader);

  const [attempts, subjects] = await Promise.all([
    listOrgAttempts(State.profile.orgId),
    getSubjects()
  ]);

  loader.remove();

  const filters = h("div", { class: "filter-bar" });
  const subjectSelect = h("select", { class: "chip" }, h("option", { value: "" }, "Все предметы"));
  subjects.forEach(s => subjectSelect.appendChild(h("option", { value: s.id }, s.title)));

  filters.appendChild(subjectSelect);
  page.appendChild(filters);

  const grid = h("div", { class: "leaderboard-grid" });
  page.appendChild(grid);

  function render(subjectId) {
    const data = aggregateLeaderboard(attempts, { subjectId });
    grid.innerHTML = "";
    if (!data.length) {
      grid.appendChild(h("div", { class: "empty-state" }, "Нет результатов для отображения."));
      return;
    }

    const rows = data.map((r, i) => ({
      uid: r.userId,
      place: i + 1,
      name: r.name,
      score: r.average, // Для таблицы используем среднее как score
      percent: r.average,
      answered: r.count,
      finished: r.count
    }));

    import("../components/leaderboard.js").then(lb => {
      grid.appendChild(lb.leaderList(rows, { board: true }));
    });
  }

  subjectSelect.onchange = () => render(subjectSelect.value);
  render();

  return page;
}
