// ui/components/lesson-report-view.js — отрисовка итогового отчёта занятия.
// Работает по готовому объекту отчёта (core/lesson-report.js) — и для
// только что собранного, и для сохранённого в истории: исторический отчёт
// показывается как записан, без пересчёта.
import { h } from "../../shared/dom.js";
import { renderTable } from "./practical.js";
import { STAGE_LABEL } from "../../core/lesson-plan.js";

const fmt = (n, suffix = "") => (n === null || n === undefined || Number.isNaN(n) ? "—" : `${Math.round(Number(n) * 10) / 10}${suffix}`);
const TEAM = { a: "Команда А", b: "Команда Б" };
const STAGE_STATE = { done: "пройден", missed: "пропустил", not_held: "не проводился", off: "не запланирован" };

function card(title, value, sub) {
  return h("div", { class: "lr-card" }, h("p", { class: "lr-card-title" }, title), h("p", { class: "lr-card-value" }, value), sub ? h("p", { class: "lr-card-sub" }, sub) : null);
}

function winnerText(s) {
  if (!s?.available) return "не проводилась";
  if (s.tie) return "Ничья";
  return s.winner ? `Победила ${TEAM[s.winner]}` : "—";
}

export function buildReportView(report, { editable = false, decisions = {}, onDecision = () => {} } = {}) {
  const L = report.lesson || {};
  const S = report.summary || {};
  const date = L.dateMs ? new Date(L.dateMs).toLocaleDateString("ru-RU") : "—";

  const head = h("header", { class: "lr-head" },
    h("p", { class: "lr-kicker" }, "Итоговый отчёт занятия"),
    h("h1", {}, L.topic || "Занятие"),
    h("p", { class: "lr-meta" }, `${date} · преподаватель: ${L.hostName || "—"} · участников: ${report.participants ?? 0}`),
    h("p", { class: "lr-meta" }, `Выполнение занятия: ${report.completion?.percent ?? 0}% (этапов ${report.completion?.done ?? 0} из ${report.completion?.planned ?? 0}${report.completion?.skipped ? `, пропущено ${report.completion.skipped}` : ""})`));

  const stages = h("ol", { class: "lr-stages" }, ...(report.stages || []).filter(s => s.status !== "off").map(s =>
    h("li", { "data-status": s.status }, `${s.label}: ${{ done: "завершён", skipped: "пропущен", current: "не завершён", next: "не начат", upcoming: "не начат" }[s.status] || s.status}`)));

  const cards = h("div", { class: "lr-cards" },
    card("Входной тест", S.entry?.available ? fmt(S.entry.averagePercent, "%") : "—", S.entry?.available ? `средний результат, участников: ${S.entry.participants}` : "нет данных"),
    card("Итоговый тест", S.final?.available ? fmt(S.final.averagePercent, "%") : "—", S.final?.available ? `средний результат, участников: ${S.final.participants}` : "нет данных"),
    card("Динамика", S.dynamics?.available ? `${S.dynamics.averageDelta > 0 ? "+" : ""}${fmt(S.dynamics.averageDelta)} п.п.` : "—", S.dynamics?.available ? `выросли: ${S.dynamics.improved}, снизились: ${S.dynamics.declined}` : "нужны оба теста"),
    card("Battle", winnerText(S.battle), S.battle?.available ? `счёт ${fmt(S.battle.scores?.a)} : ${fmt(S.battle.scores?.b)}` : ""),
    card("Практика", winnerText(S.practical), S.practical?.available ? `А ${fmt(S.practical.a?.percent, "%")} · Б ${fmt(S.practical.b?.percent, "%")}` : ""));

  const parts = [head, stages, cards];

  // Практические таблицы (только чтение).
  if (report.practical?.teams && Object.keys(report.practical.teams).length) {
    parts.push(h("section", { class: "lr-section", "aria-label": "Практическая диагностика" },
      h("h2", {}, "Практическая диагностика"),
      ...["a", "b"].filter(t => report.practical.teams[t]).map(team => {
        const t = report.practical.teams[team];
        const table = renderTable({ columns: t.columns, rows: t.rows }, {
          values: Object.fromEntries(Object.entries(t.cells).map(([id, c]) => [id, c.answer])),
          verdicts: Object.fromEntries(Object.entries(t.cells).map(([id, c]) => [id, c.ok])),
          expected: Object.fromEntries(Object.entries(t.cells).filter(([, c]) => c.expected).map(([id, c]) => [id, c.expected]))
        });
        return h("article", { class: "lr-practical" },
          h("h3", {}, `${TEAM[team]}: ${t.title || "задание"} — ${fmt(t.score)} из ${fmt(t.max)} (${fmt(t.percent, "%")})`),
          t.description ? h("p", { class: "muted" }, t.description) : null, table.el);
      })));
  }

  // Индивидуальные результаты.
  const head2 = ["Участник", "Входной", "Итоговый", "Динамика", "Battle", "Практика (команда)", "Участие", "Вклад", "Командная работа", "Рекомендуемая оценка за занятие", "Готовность", "Итоговая оценка"];
  const rows = (report.people || []).map(p => {
    const rec = p.recommended || {};
    const decided = decisions[p.uid] || p.decision || null;
    const comps = h("details", { class: "lr-comps" },
      h("summary", {}, rec.grade ? `${rec.grade} (${fmt(rec.percent, "%")})` : "не выставлена"),
      h("ul", {}, ...(rec.components || []).map(c => h("li", {}, c.used
        ? `${c.label}: ${fmt(c.percent, "%")} × доля ${fmt(c.share, "%")}${c.team ? " (командный)" : ""}`
        : `${c.label}: не учитывается (нет данных)`))),
      rec.note ? h("p", { class: "lr-note" }, rec.note) : null);
    let decisionCell;
    if (editable) {
      const sel = h("select", { "aria-label": `Итоговая оценка: ${p.name}` },
        h("option", { value: "" }, "— решить —"), ...[5, 4, 3, 2].map(g => h("option", { value: String(g), selected: decided?.grade === g }, String(g))));
      sel.value = decided ? String(decided.grade) : "";
      const reason = h("input", { type: "text", placeholder: "Основание (по желанию)", "aria-label": `Основание оценки: ${p.name}`, maxlength: "300" });
      reason.value = decided?.reason || "";
      const push = () => onDecision(p.uid, sel.value ? { grade: Number(sel.value), reason: reason.value } : null);
      sel.addEventListener("change", push); reason.addEventListener("input", push);
      decisionCell = h("td", {}, sel, reason);
    } else {
      decisionCell = h("td", {}, decided ? `${decided.grade}${decided.reason ? ` — ${decided.reason}` : ""}` : "не выставлена");
    }
    const stageLine = Object.entries(p.stages || {}).filter(([, v]) => v !== "off").map(([k, v]) => `${STAGE_LABEL[k]}: ${STAGE_STATE[v]}`).join("; ");
    return h("tr", { "data-uid": p.uid },
      h("th", { scope: "row", class: "lr-name" }, h("span", {}, p.name), h("small", {}, stageLine)),
      h("td", {}, p.entry?.available ? `${fmt(p.entry.percent, "%")} (${p.entry.correct}/${p.entry.total})` : "нет данных"),
      h("td", {}, p.final?.available ? `${fmt(p.final.percent, "%")} (${p.final.correct}/${p.final.total})` : "нет данных"),
      h("td", {}, p.dynamics?.available ? `${p.dynamics.delta > 0 ? "+" : ""}${fmt(p.dynamics.delta)} п.п. — ${p.dynamics.label}` : p.dynamics?.label || "—"),
      h("td", {}, p.battle?.available ? `${TEAM[p.battle.teamId] || "—"} · оценка ${fmt(p.battle.grade)}${p.battle.isCaptain ? " · капитан" : ""}` : (p.battle?.reason || "—")),
      h("td", {}, p.practical?.available ? `${fmt(p.practical.teamPercent, "%")}${p.practical.filledTable ? " · заполнил таблицу" : ""}. Личный вклад: не оценён` : "не оценивалась"),
      h("td", {}, fmt(p.metrics?.participation, "%")),
      h("td", {}, fmt(p.metrics?.contribution, "%")),
      h("td", {}, fmt(p.metrics?.teamwork, "%")),
      h("td", {}, comps),
      h("td", {}, p.readiness?.available ? h("span", {}, `${p.readiness.label} (${fmt(p.readiness.percent, "%")}, ${p.readiness.basis})`) : "нет данных"),
      decisionCell);
  });
  parts.push(h("section", { class: "lr-section", "aria-label": "Индивидуальные результаты" },
    h("h2", {}, "Индивидуальные результаты"),
    h("div", { class: "lr-table-wrap" }, h("table", { class: "lr-table" }, h("thead", {}, h("tr", {}, ...head2.map(c => h("th", { scope: "col" }, c)))), h("tbody", {}, ...rows)))));

  parts.push(h("section", { class: "lr-section lr-notes", "aria-label": "Как читать отчёт" },
    h("h2", {}, "Как читать отчёт"),
    h("ul", {},
      h("li", {}, "Рекомендуемая оценка — подсказка. Итоговую оценку выставляет преподаватель."),
      h("li", {}, "Если результата нет (этап пропущен, отключён или участник отсутствовал), он не считается нулём: вес перераспределяется между остальными компонентами."),
      h("li", {}, "Командный результат практики не заменяет личных результатов."),
      h("li", {}, "Показатель готовности — учебная оценка по этому занятию, а не объективный уровень профессиональной компетентности."),
      ...(report.notes || []).map(n => h("li", {}, n)))));
  return h("div", { class: "lesson-report" }, ...parts);
}
