// ui/components/battle-summary-view.js — итоговая таблица Battle (участники по
// алфавиту, сводка команд, статистика вопросов). Один компонент для экрана
// участника, наблюдателя/проектора и истории занятия. Данные — результат
// buildBattleSummary (core/battle-summary.js); здесь только отрисовка.
// Нет значения — «—», а не выдуманное число. Подписи колонок (data-label)
// заданы явно: на телефоне таблицы показываются карточками (components.css).
import { h } from "../../shared/dom.js";
import { formatScore } from "../../core/battle-summary.js";

const DASH = "—";
const num = (v) => (v === null || v === undefined ? DASH : String(v));
const pct = (v) => (v === null || v === undefined ? DASH : `${Math.round(v * 10) / 10}%`);

function cell(label, content, extra = {}) {
  return h("td", { "data-label": label, ...extra }, content);
}

function teamsTable(s) {
  const row = (id) => {
    const t = s.teams[id];
    const q = s.questions.byTeam[id];
    const win = s.outcome.winnerId === id;
    return h("tr", { "data-team": id, "data-winner": win ? "1" : "0" },
      cell("Команда", h("b", {}, t.name + (win ? " — победитель" : ""))),
      cell("Очки", t.points === null ? DASH : formatScore(t.points)),
      cell("Верных ответов", num(t.correctAnswers)),
      cell("Раундов", num(t.rounds)),
      cell("Не засчитано", num(q.notCounted)),
      cell("Споров", num(q.tiebreak)),
      ...(s.practical ? [
        cell("Практика", s.practical.results[id] ? `${s.practical.results[id].score} из ${s.practical.results[id].max}` : DASH),
        cell("Итого с практикой", formatScore(s.practical.total[id]))
      ] : []));
  };
  const heads = ["Команда", "Очки", "Верных ответов", "Раундов", "Не засчитано", "Споров", ...(s.practical ? ["Практика", "Итого с практикой"] : [])];
  return h("div", { class: "table-wrap" },
    h("table", { class: "table table-stack bsum-table", "aria-label": "Сводка по командам" },
      h("thead", {}, h("tr", {}, ...heads.map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", {}, row("a"), row("b"))));
}

function questionsTable(s) {
  const q = s.questions;
  if (!q.total) return h("p", { class: "muted" }, "Основных вопросов не было.");
  const row = (id, name) => {
    const t = q.byTeam[id];
    return h("tr", {},
      cell("Команда", name),
      cell("Верно", num(t.correct)),
      cell("Неверно", num(t.wrong)),
      cell("Ответ не засчитан", num(t.notCounted)),
      cell("Капитан сам / голосование", `${t.self} / ${t.vote}`),
      cell("Споров", num(t.tiebreak)));
  };
  return h("div", { class: "table-wrap" },
    h("table", { class: "table table-stack bsum-table", "aria-label": "Статистика по вопросам" },
      h("thead", {}, h("tr", {}, ...["Команда", "Верно", "Неверно", "Ответ не засчитан", "Капитан сам / голосование", "Споров"].map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", {}, row("a", "Команда А"), row("b", "Команда Б"))),
    q.extra ? h("p", { class: "muted" }, `Решающих раундов капитанов: ${q.extra}.`) : null);
}

function playersTable(s) {
  const body = s.players.map((p) => {
    const voted = p.participated === null ? DASH : `${p.participated}${p.available !== null ? ` из ${p.available}` : ""}`;
    return h("tr", { "data-uid": p.uid, "data-role": p.role },
      cell("Участник", h("b", {}, p.name)),
      cell("Команда", p.teamId ? p.teamId.toUpperCase().replace("A", "А").replace("B", "Б") : DASH),
      cell("Роль", p.roleLabel),
      cell("Верных ответов команды", num(p.teamCorrect)),
      cell("Голосовал", voted),
      cell("Участие", pct(p.participationPercent)));
  });
  return h("div", { class: "table-wrap" },
    h("table", { class: "table table-stack bsum-table", "aria-label": "Участники по алфавиту" },
      h("thead", {}, h("tr", {}, ...["Участник", "Команда", "Роль", "Верных ответов команды", "Голосовал", "Участие"].map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", {}, ...body)),
    s.hasPersonal ? null : h("p", { class: "muted bsum-note" },
      "Личное участие в голосовании в публичных данных битвы не хранится — оно появляется в сохранённом отчёте занятия."));
}

// battleSummaryView(summary, { open }) — готовый блок; summary === null → заглушка.
export function battleSummaryView(summary, { open = true, title = "Итоговая таблица Battle" } = {}) {
  if (!summary) {
    return h("p", { class: "muted bsum-empty", role: "status" }, "Итоговая таблица не сохранена.");
  }
  const o = summary.outcome;
  return h("details", { class: "bsum", ...(open ? { open: "open" } : {}) },
    h("summary", {}, title),
    h("p", { class: "bsum-outcome" }, h("b", {}, o.text), ` · счёт ${summary.score.text}`),
    h("h3", {}, "Команды"), teamsTable(summary),
    h("h3", {}, "Вопросы"), questionsTable(summary),
    h("h3", {}, `Участники (${summary.players.length}) — по алфавиту`),
    summary.players.length ? playersTable(summary) : h("p", { class: "muted" }, "Состав не сохранён."));
}
