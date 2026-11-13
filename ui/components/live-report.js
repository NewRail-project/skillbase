// ui/components/live-report.js — блоки итогового экрана Live для ведущего:
// журнал оценок (ФИО по алфавиту) и подробный отчёт.
// Компоненты чистые: получают готовые данные и возвращают DOM-узлы.
import { h } from "../../shared/dom.js";
import { GRADE_STATUS, journalAverage } from "../../core/pair-grade.js";

const LEVEL_LABEL = {
  strong: "Хорошо усвоил",
  ok: "Усвоил",
  needs_help: "Много ошибок",
  unfinished: "Пропускал вопросы",
  no_answers: "Не ответил ни на один вопрос"
};


const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

// Кольцо готовности группы (SVG): процент в центре.
export function gaugeChart(percent, label) {
  const value = Math.max(0, Math.min(100, Math.round(percent) || 0));
  const r = 44; const c = 2 * Math.PI * r;
  const tone = value >= 75 ? "good" : value >= 50 ? "mid" : "low";
  const svg = svgEl("svg", { viewBox: "0 0 120 120", width: 120, height: 120, "aria-hidden": "true" });
  svg.append(
    svgEl("circle", { class: "gauge-bg", cx: 60, cy: 60, r, fill: "none", "stroke-width": 12 }),
    svgEl("circle", { class: "gauge-fg", cx: 60, cy: 60, r, fill: "none", "stroke-width": 12,
      "stroke-linecap": "round", "stroke-dasharray": `${(c * value / 100).toFixed(1)} ${c.toFixed(1)}`,
      transform: "rotate(-90 60 60)" }));
  const text = svgEl("text", { x: 60, y: 66, "text-anchor": "middle", class: "gauge-num" });
  text.textContent = `${value}%`;
  svg.append(text);
  return h("div", { class: `gauge gauge-${tone}`, role: "img", "aria-label": `${label}: ${value}%` },
    svg, h("div", { class: "gauge-label" }, label));
}

// Столбчатая диаграмма распределения оценок.
export function distributionChart(distribution) {
  const top = Math.max(1, ...distribution.map(b => b.count));
  return h("div", { class: "columns", role: "img", "aria-label": "Распределение оценок" },
    distribution.map(b => h("div", { class: "col" },
      h("span", { class: "col-count" }, String(b.count)),
      h("span", { class: "col-bar", style: `height:${Math.round(b.count / top * 100)}%` }),
      h("span", { class: "col-label" }, b.label))));
}

// Составная полоса по вопросу: верно / неверно / пропуск.
export function questionStack(q) {
  return h("div", { class: "qstack", title: q.text },
    h("span", { class: "qstack-n" }, `В${q.position + 1}`),
    h("span", { class: "stack" },
      h("span", { class: "seg seg-ok", style: `width:${q.correctPercent}%` }),
      h("span", { class: "seg seg-bad", style: `width:${q.wrongPercent}%` }),
      h("span", { class: "seg seg-skip", style: `width:${q.skippedPercent}%` })),
    h("span", { class: "qstack-v" }, `${q.correctPercent}%`));
}

function stat(value, label) {
  return h("div", { class: "quick-action" }, h("b", {}, String(value)), h("span", {}, label));
}

// Журнал: ФИО по алфавиту + оценка за пару. Формулу показываем в подсказке.
export function journalPanel(journal, { grades = [] } = {}) {
  const byUid = new Map(grades.map(g => [g.uid, g]));
  // Средний балл по журналу: только выставленные оценки; «Не участвовал»
  // в среднее не входит.
  const average = journalAverage(grades);
  const body = journal.length
    ? h("table", { class: "live-table journal-table" },
      h("thead", {}, h("tr", {}, h("th", {}, "ФИО"), h("th", { class: "num" }, "Оценка за пару"))),
      h("tbody", {}, journal.map(row => {
        const g = byUid.get(row.uid);
        const why = g && g.status !== GRADE_STATUS.ABSENT
          ? `Верно ${g.correctCount} из ${g.total}, баллы ${g.earned}/${g.max}, ответил на ${g.answered} из ${g.total}`
          : "";
        return h("tr", { "data-uid": row.uid || "", title: why },
          h("td", {}, row.name),
          h("td", { class: `num${row.status === GRADE_STATUS.ABSENT ? " muted" : ""}` }, row.label));
      }),
      average != null
        ? h("tr", { class: "journal-average-row" },
            h("td", {}, "Средний балл по журналу"),
            h("td", { class: "num" }, String(average)))
        : null))
    : h("p", { class: "muted" }, "Пока нет участников.");
  return h("section", { class: "panel live-journal", "aria-label": "Оценки для журнала" },
    h("div", { class: "panel-head" }, h("h2", {}, "Оценки для журнала")),
    h("div", { class: "panel-body" },
      h("p", { class: "form-hint" },
        "Оценка = 90 × баллы / максимум + 10 × отвеченные / все вопросы. Скорость и место в рейтинге не учитываются."),
      body));
}

function barRow(label, percent, extra = "") {
  return h("div", { class: "bar-row" },
    h("span", { class: "bar-label" }, label),
    h("span", { class: "bar-track" }, h("span", { class: "bar-fill", style: `width:${Math.max(0, Math.min(100, percent))}%` })),
    h("span", { class: "bar-value" }, `${percent}%${extra}`));
}

export function reportPanel(report, { open = false, onToggle = null } = {}) {
  const { group, questions, students, topics, recommendations } = report;
  const details = h("details", { class: "panel live-report" });
  if (open) details.setAttribute("open", "");
  if (onToggle) details.addEventListener("toggle", () => onToggle(details.open));

  details.appendChild(h("summary", { class: "btn secondary live-report-toggle" }, "Открыть подробный отчёт"));

  const body = h("div", { class: "panel-body live-report-body" });

  body.appendChild(h("p", { class: `verdict verdict-${report.verdict?.level || "none"}` },
    h("b", {}, "Вывод: "), report.verdict?.text || ""));
  body.appendChild(h("h3", {}, "Общая статистика группы"));
  body.appendChild(h("div", { class: "quick-actions" },
    stat(group.participants, "участников"),
    stat(group.finished, "завершили тест"),
    stat(group.averageScore, "средний балл"),
    stat(`${group.averagePercent}%`, "верных в среднем"),
    stat(group.maxGrade, "максимум оценки"),
    stat(group.minGrade, "минимум оценки")));
  body.appendChild(h("div", { class: "chart-row" },
    gaugeChart(group.averagePercent, "Готовность группы"),
    distributionChart(group.distribution)));

  body.appendChild(h("h3", {}, "Анализ каждого вопроса"));
  body.appendChild(h("div", { class: "qstack-legend" },
    h("span", { class: "dot seg-ok" }), " верно ", h("span", { class: "dot seg-bad" }), " неверно ",
    h("span", { class: "dot seg-skip" }), " пропуск"));
  body.appendChild(h("div", { class: "qstacks" }, questions.map(questionStack)));
  body.appendChild(h("div", { class: "table-scroll" },
    h("table", { class: "live-table" },
      h("thead", {}, h("tr", {},
        ["№", "Верно", "Неверно", "Пропуски", "Время", "Частая ошибка"].map(t => h("th", {}, t)))),
      h("tbody", {}, questions.map(q => h("tr", { class: q.needsReview ? "needs-review" : "", title: q.text },
        h("td", {}, String(q.position + 1)),
        h("td", {}, `${q.correctPercent}%`),
        h("td", {}, `${q.wrongPercent}%`),
        h("td", {}, `${q.skippedPercent}%`),
        h("td", {}, q.averageTimeSec == null ? "—" : `${q.averageTimeSec} с`),
        h("td", {}, q.popularWrong ? `${q.popularWrong.text} (${q.popularWrong.count})` : "—")))))));

  body.appendChild(h("h3", {}, "Анализ учеников"));
  body.appendChild(h("div", { class: "bars" }, students.map(st => barRow(st.name, st.percent))));
  body.appendChild(h("ul", { class: "student-list" }, students.map(s => h("li", { class: `student student-${s.level}` },
    h("b", {}, s.name), ` — ${LEVEL_LABEL[s.level] || ""}: `,
    `верно ${s.correct}, ошибок ${s.wrong}, пропусков ${s.skipped}`,
    s.weakTopics.length ? h("span", { class: "muted" }, `. Повторить: ${s.weakTopics.join(", ")}`) : null))));

  body.appendChild(h("h3", {}, "Готовность группы по темам"));
  body.appendChild(topics.length
    ? h("div", { class: "bars" }, topics.map(t => barRow(t.topic, t.percent)))
    : h("p", { class: "muted" },
      "У вопросов этого теста не указаны темы. Укажите тему вопроса в редакторе — и здесь появится готовность по темам."));

  body.appendChild(h("h3", {}, "Рекомендации"));
  body.appendChild(h("ul", { class: "recommendations" },
    recommendations.map(r => h("li", { class: `rec rec-${r.kind}` }, r.text))));

  details.appendChild(body);
  return details;
}
