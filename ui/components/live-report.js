// ui/components/live-report.js — блоки итогового экрана Live для ведущего:
// журнал оценок (ФИО по алфавиту) и подробный отчёт.
// Компоненты чистые: получают готовые данные и возвращают DOM-узлы.
import { h } from "../../shared/dom.js";
import {
  GRADE_STATUS, JOURNAL_CSV_COLUMNS, journalAverage, journalCsvRows
} from "../../core/pair-grade.js";
import { toCsv, safeFileName, downloadCsv } from "../../shared/csv.js";

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

// Журнал: ФИО по алфавиту + оценка за пару. Колонки по ТЗ: №, ФИО, статус
// участия, верно / неверно / пропуски, оценка. Формулу показываем в подсказке.
// Экспорт журнала в CSV: тот же массив journal, что рендерит таблица
// вкладки (отдельного пересчёта нет — кнопка только сериализует).
// Разделитель «;» — русскоязычные табличные редакторы открывают такой
// файл без мастера импорта; BOM и CRLF — для корректной кодировки и
// переводов строк в Excel. Имя файла: журнал, название теста, дата —
// безопасно очищенные (safeFileName).
export function exportJournalCsv(journal, { title = "", dateMs = null } = {}) {
  const date = new Date(typeof dateMs === "number" ? dateMs : Date.now());
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const csv = toCsv(journalCsvRows(journal), JOURNAL_CSV_COLUMNS, { separator: ";" });
  downloadCsv(`Журнал ${safeFileName(title)} ${iso}.csv`, csv);
}

export function journalPanel(journal, { grades = [], export: exportMeta = null } = {}) {
  const byUid = new Map(grades.map(g => [g.uid, g]));
  // Средний балл по журналу: только выставленные оценки; «Не участвовал»
  // в среднее не входит.
  const average = journalAverage(grades);
  const body = journal.length ? buildJournalTable(journal, grades, byUid, average) : emptyJournal();
  // Кнопка видна только тем, кому передан экспорт (ведущий/история —
  // роли проверяют вызывающие страницы); пустой журнал — кнопка disabled.
  const exportBtn = exportMeta
    ? h("button", {
      class: "btn secondary journal-export",
      type: "button",
      disabled: !journal.length,
      onClick: () => exportJournalCsv(journal, exportMeta || {}),
      "aria-label": "Экспорт журнала в CSV"
    }, "Экспорт CSV")
    : null;
  return h("section", { class: "panel live-journal", "aria-label": "Оценки для журнала" },
    h("div", { class: "panel-head" }, h("h2", {}, "Оценки для журнала"),
      exportBtn ? h("div", { class: "panel-head-actions" }, exportBtn) : null),
    h("div", { class: "panel-body" },
      h("p", { class: "form-hint" },
        "Оценка = 90 × баллы / максимум + 10 × отвеченные / все вопросы. Скорость и место в рейтинге не учитываются."),
      body));
}

function emptyJournal() {
  return h("p", { class: "muted" }, "Пока нет участников.");
}

function buildJournalTable(journal, grades, byUid, average) {
  const thead = h("thead", {}, h("tr", {},
    ["№", "ФИО", "Статус", "Верно", "Неверно", "Пропуски", "Оценка за пару"]
      .map((t, i) => h("th", { class: i > 2 ? "num" : "" }, t))));
  const rows = journal.map(row => {
    const g = byUid.get(row.uid);
    const why = g && g.status !== GRADE_STATUS.ABSENT
      ? `Верно ${g.correctCount} из ${g.total}, баллы ${g.earned}/${g.max}, ответил на ${g.answered} из ${g.total}`
      : "";
    return h("tr", { "data-uid": row.uid || "", title: why },
      h("td", {}, String(row.n)),
      h("td", {}, row.name),
      h("td", { class: row.status === GRADE_STATUS.ZERO ? "muted" : "" }, row.statusLabel),
      h("td", { class: "num" }, String(row.correct)),
      h("td", { class: "num" }, String(row.wrong)),
      h("td", { class: "num" }, String(row.skipped)),
      h("td", { class: `num${row.status === GRADE_STATUS.ABSENT ? " muted" : ""}` }, row.label));
  });
  if (average != null) {
    rows.push(h("tr", { class: "journal-average-row" },
      h("td", { colspan: 6 }, "Средний балл по журналу"),
      h("td", { class: "num" }, String(average))));
  }
  return h("div", { class: "table-scroll" },
    h("table", { class: "live-table journal-table" },
      thead,
      h("tbody", {}, rows)));
}

function barRow(label, percent, extra = "") {
  return h("div", { class: "bar-row" },
    h("span", { class: "bar-label" }, label),
    h("span", { class: "bar-track" }, h("span", { class: "bar-fill", style: `width:${Math.max(0, Math.min(100, percent))}%` })),
    h("span", { class: "bar-value" }, `${percent}%${extra}`));
}

// Блоки подробного отчёта. Один набор разметки обслуживает и старый
// раскрывающийся отчёт (reportPanel), и вкладки итогового экрана
// (reportSection): готовые графики и таблицы не переписываются, а
// собираются из тех же данных buildLiveReport.
const REPORT_BLOCKS = {
  group(report) {
    const { group } = report;
    return [
      h("p", { class: `verdict verdict-${report.verdict?.level || "none"}` },
        h("b", {}, "Вывод: "), report.verdict?.text || ""),
      h("h3", {}, "Общая статистика группы"),
      h("div", { class: "quick-actions" },
        stat(group.participants, "участников"),
        stat(group.finished, "завершили тест"),
        stat(group.averageScore, "средний балл"),
        stat(`${group.averagePercent}%`, "верных в среднем"),
        stat(group.maxGrade, "максимум оценки"),
        stat(group.minGrade, "минимум оценки")),
      h("div", { class: "chart-row" },
        gaugeChart(group.averagePercent, "Готовность группы"),
        distributionChart(group.distribution))
    ];
  },
  questions(report) {
    return [
      h("h3", {}, "Анализ каждого вопроса"),
      h("div", { class: "qstack-legend" },
        h("span", { class: "dot seg-ok" }), " верно ", h("span", { class: "dot seg-bad" }), " неверно ",
        h("span", { class: "dot seg-skip" }), " пропуск"),
      h("div", { class: "qstacks" }, report.questions.map(questionStack)),
      h("div", { class: "table-scroll" },
        h("table", { class: "live-table" },
          h("thead", {}, h("tr", {},
            ["№", "Верно", "Неверно", "Пропуски", "Время", "Частая ошибка"].map(t => h("th", {}, t)))),
          h("tbody", {}, report.questions.map(q => h("tr", { class: q.needsReview ? "needs-review" : "", title: q.text },
            h("td", {}, String(q.position + 1)),
            h("td", {}, `${q.correctPercent}%`),
            h("td", {}, `${q.wrongPercent}%`),
            h("td", {}, `${q.skippedPercent}%`),
            h("td", {}, q.averageTimeSec == null ? "—" : `${q.averageTimeSec} с`),
            h("td", {}, q.popularWrong ? `${q.popularWrong.text} (${q.popularWrong.count})` : "—"))))))
    ];
  },
  students(report) {
    return [
      h("h3", {}, "Анализ учеников"),
      h("div", { class: "bars" }, report.students.map(st => barRow(st.name, st.percent))),
      h("ul", { class: "student-list" }, report.students.map(s => h("li", { class: `student student-${s.level}` },
        h("b", {}, s.name), ` — ${LEVEL_LABEL[s.level] || ""}: `,
        `верно ${s.correct}, ошибок ${s.wrong}, пропусков ${s.skipped}`,
        s.weakTopics.length ? h("span", { class: "muted" }, `. Повторить: ${s.weakTopics.join(", ")}`) : null)))
    ];
  },
  topics(report) {
    return [
      h("h3", {}, "Готовность группы по темам"),
      report.topics.length
        ? h("div", { class: "bars" }, report.topics.map(t => barRow(t.topic, t.percent)))
        : h("p", { class: "muted" },
          "У вопросов этого теста не указаны темы. Укажите тему вопроса в редакторе — и здесь появится готовность по темам.")
    ];
  },
  recs(report) {
    return [
      h("h3", {}, "Рекомендации"),
      h("ul", { class: "recommendations" },
        report.recommendations.map(r => h("li", { class: `rec rec-${r.kind}` }, r.text)))
    ];
  }
};

// Содержимое отчёта: все блоки или выбранные (порядок как в списке).
function reportBody(report, { sections = null } = {}) {
  const body = h("div", { class: "panel-body live-report-body" });
  const names = sections || Object.keys(REPORT_BLOCKS);
  for (const name of names) {
    const block = REPORT_BLOCKS[name];
    if (block) for (const node of block(report)) body.appendChild(node);
  }
  return body;
}

export function reportPanel(report, { open = false, onToggle = null, sections = null } = {}) {
  const details = h("details", { class: "panel live-report" });
  if (open) details.setAttribute("open", "");
  if (onToggle) details.addEventListener("toggle", () => onToggle(details.open));
  details.appendChild(h("summary", { class: "btn secondary live-report-toggle" }, "Открыть подробный отчёт"));
  details.appendChild(reportBody(report));
  return details;
}

// Плоская секция отчёта для вкладки итогового экрана: те же блоки, но
// без сворачивания (внутри вкладки details не нужен).
export function reportSection(report, { title, sections, note = "" } = {}) {
  return h("section", { class: "panel live-report", "aria-label": title },
    h("div", { class: "panel-head" }, h("h2", {}, title)),
    note ? h("p", { class: "form-hint", style: "margin:0 var(--space-3)" }, note) : null,
    reportBody(report, { sections }));
}

// ---------- Вкладки итогового экрана Live ----------

// Обзор: название теста, предмет/тема, дата завершения, участники и
// наблюдатели отдельно, средний результат, готовность группы, сводка.
// Все значения приходят готовыми (room.js собирает из комнаты и отчёта);
// отсутствующее показывается как «—», выдумывать данные нельзя.
export function overviewPanel({ title, subject, topic, finishedLabel,
  participants, observers, group, verdict } = {}) {
  const metaLine = [subject, topic].filter(Boolean).join(" · ");
  return h("section", { class: "panel live-overview", "aria-label": "Обзор итогов" },
    h("div", { class: "panel-head" }, h("h2", {}, "Обзор")),
    h("div", { class: "panel-body" },
      h("dl", { class: "overview-grid" },
        h("div", { class: "overview-item" }, h("dt", {}, "Тест"), h("dd", {}, title || "—")),
        h("div", { class: "overview-item" }, h("dt", {}, "Предмет и тема"),
          h("dd", {}, metaLine || "не указаны")),
        h("div", { class: "overview-item" }, h("dt", {}, "Завершён"),
          h("dd", {}, finishedLabel || "—")),
        h("div", { class: "overview-item" }, h("dt", {}, "Участники"),
          h("dd", {}, String(participants ?? 0))),
        h("div", { class: "overview-item" }, h("dt", {}, "Наблюдатели"),
          h("dd", {}, String(observers ?? 0))),
        group ? h("div", { class: "overview-item" },
          h("dt", {}, "Средний результат"),
          h("dd", {}, `${group.averageGrade ?? 0} · верных ${group.averagePercent ?? 0}%`)) : null,
        group ? h("div", { class: "overview-item" },
          h("dt", {}, "Завершили тест"),
          h("dd", {}, `${group.finished ?? 0} из ${group.participants ?? 0}`)) : null),
      group
        ? h("div", { class: "chart-row" }, gaugeChart(group.averagePercent, "Готовность группы"))
        : null,
      verdict
        ? h("p", { class: `verdict verdict-${verdict.level || "none"}` }, h("b", {}, "Сводка: "), verdict.text || "")
        : null));
}

// Участники: подробный результат каждого — ФИО, верно / ошибки / пропуски,
// процент, оценка; детализация по вопросам раскрывается отдельно.
// Персональные строки видит только преподаватель: панель вызывается
// только в виде ведущего (см. room.js), разбор ответов — из его данных.
export function studentsPanel(report, grades = []) {
  const students = report.students || [];
  const byUid = new Map((report.byUid ? [...report.byUid.values()] : grades).map(g => [g.uid, g]));
  const verdictMark = (b) => b.answered ? (b.correct ? "✓" : "✗") : "—";
  const body = students.length
    ? h("div", { class: "students-detail" }, students.map(s => {
      const g = byUid.get(s.uid);
      const breakdown = g?.breakdown || [];
      return h("details", { class: "student-detail" },
        h("summary", {},
          h("b", {}, s.name),
          h("span", { class: "student-detail-stats" },
            `верно ${s.correct} · ошибок ${s.wrong} · пропусков ${s.skipped}`),
          h("span", { class: "student-detail-grade" }, `${s.percent}% · оценка ${s.grade ?? "—"}`)),
        breakdown.length
          ? h("div", { class: "table-scroll" },
            h("table", { class: "live-table" },
              h("thead", {}, h("tr", {},
                ["№", "Результат", "Баллы"].map(t => h("th", {}, t)))),
              h("tbody", {}, breakdown.map(b => h("tr", { class: b.answered ? (b.correct ? "row-ok" : "row-bad") : "row-skip" },
                h("td", {}, `В${b.position + 1}`),
                h("td", {}, verdictMark(b) === "—" ? "пропуск" : b.correct ? "верно" : "неверно"),
                h("td", {}, `${b.points}/${b.max}`))))))
          : h("p", { class: "muted" }, "Вопросов в этой попытке нет — детализации нет."),
        s.weakTopics.length
          ? h("p", { class: "form-hint" }, `Повторить: ${s.weakTopics.join(", ")}`)
          : null);
    }))
    : h("p", { class: "muted" }, "Пока нет участников.");
  return h("section", { class: "panel live-students", "aria-label": "Участники" },
    h("div", { class: "panel-head" },
      h("h2", {}, "Участники"),
      h("span", { class: "badge badge-neutral" }, `${students.length}`)),
    h("div", { class: "panel-body" },
      h("p", { class: "form-hint" },
        "Процент — доля баллов от максимума. Оценка — учебная (не зависит от рейтинга и дуэлей)."),
      body));
}

// Рекомендации: только выводы buildRecommendations по реальным данным.
// Недостаточно данных → понятное состояние, а не выдуманный список.
export function recommendationsPanel(report) {
  const recs = report.recommendations || [];
  return h("section", { class: "panel live-recs", "aria-label": "Рекомендации" },
    h("div", { class: "panel-head" }, h("h2", {}, "Рекомендации")),
    h("div", { class: "panel-body" },
      h("p", { class: `verdict verdict-${report.verdict?.level || "none"}` },
        h("b", {}, "Вывод: "), report.verdict?.text || ""),
      recs.length
        ? h("ul", { class: "recommendations" },
          recs.map(r => h("li", { class: `rec rec-${r.kind}` }, r.text)))
        : h("p", { class: "muted" },
          "Данных пока недостаточно: рекомендации появятся, когда участники ответят на вопросы.")));
}
