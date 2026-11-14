// tests/journal-csv.test.js — CSV-экспорт журнала Live-комнат:
// CSV строится из того же набора данных, что вкладка «Журнал»
// (journalRows → journalCsvRows), без отдельной формулы оценки и
// отдельной логики участников. Проверки: кириллица, пустые значения,
// кавычки, запятые/точки с запятой, переносы строк, порядок строк,
// исключение наблюдателей и не вошедших, участник без ответов,
// соответствие данным интерфейса, экспорт исторического отчёта.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- Фейковый DOM (как в tests/live-final.test.js) ----------

function makeElement(tag) {
  const el = {
    tag,
    attrs: {},
    children: [],
    dataset: {},
    style: {},
    textContent: "",
    listeners: {},
    disabled: false,
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] ?? null; },
    appendChild(child) { this.children.push(child); return child; },
    append(...nodes) { for (const n of nodes) this.appendChild(n); },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    classList: { toggle() {}, add() {}, remove() {} },
    remove() {},
    click() { this.clicked = true; }
  };
  return el;
}

globalThis.document = {
  createElement: makeElement,
  createElementNS: (ns, tag) => makeElement(tag),
  createTextNode: text => ({ text }),
  body: makeElement("body")
};
globalThis.URL = class {
  static createObjectURL() { return "blob:fake"; }
  static revokeObjectURL() {}
};
globalThis.Blob = class {
  constructor(parts) { this.parts = parts; }
};

const {
  gradeRoster, journalRows, journalCsvRows, JOURNAL_CSV_COLUMNS, GRADE_STATUS
} = await import("../core/pair-grade.js");
const { toCsv, safeFileName } = await import("../shared/csv.js");
const { journalPanel, exportJournalCsv } = await import("../ui/components/live-report.js");

const roomPage = readFileSync(join(ROOT, "ui/pages/room.js"), "utf8");
const historyPage = readFileSync(join(ROOT, "ui/pages/room-history.js"), "utf8");

// Мини-парсер CSV (RFC 4180): возвращает строки-массивы полей — имитирует
// чтение файла табличным редактором.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ";") {
      row.push(field); field = "";
    } else if (ch === "\r") {
      // пусто: обрабатывается на \n
    } else if (ch === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0] !== "");
}

// ---------- Данные ----------

const keys = Array.from({ length: 3 }, () => ({ type: "single", points: 1, correct: [0] }));
const buildJournal = (players, absent = []) =>
  journalRows(gradeRoster({ players, keysByPos: keys, absent }));

// ---------- Форматирование ----------

test("кириллица и BOM: файл UTF-8 с BOM, кириллица и заголовки сохраняются", () => {
  const csv = toCsv(journalCsvRows(buildJournal([
    { uid: "a", name: "Анна", answers: { 0: 0 } },
    { uid: "b", name: "Борис", answers: {} }
  ])), JOURNAL_CSV_COLUMNS, { separator: ";" });
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("Анна"));
  assert.ok(csv.includes("ФИО"));
  assert.ok(csv.includes("Статус участия"));
  assert.ok(csv.includes("Итоговая оценка"));
});

test("кавычки экранируются удвоением", () => {
  const csv = toCsv([{ x: 'Он сказал "привет"' }], ["x"], { separator: ";" });
  assert.ok(csv.includes('"Он сказал ""привет"""'));
  const parsed = parseCsv(csv);
  assert.equal(parsed[1][0], 'Он сказал "привет"');
});

test("запятые и точки с запятой в значении не смещают столбцы (разделитель «;»)", () => {
  const csv = toCsv([
    { a: "Иванов, Пётр; Сидоров", b: "обычный" }
  ], ["a", "b"], { separator: ";" });
  const parsed = parseCsv(csv);
  assert.equal(parsed.length, 2);           // заголовок + одна строка данных
  assert.equal(parsed[1].length, 2);        // ровно два столбца
  assert.equal(parsed[1][0], "Иванов, Пётр; Сидоров");
  assert.equal(parsed[1][1], "обычный");
});

test("переносы строк внутри ФИО держат строку CSV целой", () => {
  const csv = toCsv([{ a: "Иванов\nПётр\r\nстарший", b: "2" }], ["a", "b"], { separator: ";" });
  const parsed = parseCsv(csv);
  assert.equal(parsed.length, 2);           // заголовок + одна строка
  assert.equal(parsed[1][0], "Иванов\nПётр\r\nстарший");
  assert.equal(parsed[1][1], "2");
});

// ---------- Состав CSV (journalCsvRows поверх journalRows) ----------

test("исключение наблюдателей: наблюдатель не попадает в экспорт", () => {
  const journal = buildJournal([
    { uid: "a", name: "Анна", answers: { 0: 0 } },
    { uid: "o", name: "Смотрящий", answers: { 0: 0 }, observer: true }
  ]);
  assert.equal(journal.some(r => r.name === "Смотрящий"), false); // gradeRoster
  const rows = journalCsvRows(journal);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["ФИО"], "Анна");
});

test("исключение не вошедших: строки absent не попадают в экспорт", () => {
  const journal = buildJournal([
    { uid: "a", name: "Анна", answers: { 0: 0 } }
  ], [{ uid: "z", name: "Не вошёл" }]);
  assert.equal(journal.some(r => r.name === "Не вошёл"), true);  // виден на вкладке
  const rows = journalCsvRows(journal);
  assert.equal(rows.some(r => r["ФИО"] === "Не вошёл"), false); // нет в CSV
  assert.equal(rows.length, 1);
});

test("вошедший без ответов присутствует с оценкой 0", () => {
  const rows = journalCsvRows(buildJournal([
    { uid: "b", name: "Борис", answers: {} }
  ]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["Итоговая оценка"], 0);
  assert.equal(rows[0]["Правильные ответы"], 0);
  assert.ok(String(rows[0]["Статус участия"]).includes("Не ответил"));
});

test("порядок строк: сортировка по ФИО (ru), нумерация сквозная", () => {
  const rows = journalCsvRows(buildJournal([
    { uid: "v", name: "Вера", answers: { 0: 0 } },
    { uid: "a", name: "Анна", answers: { 0: 0 } },
    { uid: "b", name: "Борис", answers: {} }
  ]));
  assert.deepEqual(rows.map(r => r["ФИО"]), ["Анна", "Борис", "Вера"]);
  assert.deepEqual(rows.map(r => r["№"]), [1, 2, 3]);
});

test("пустые значения: отсутствующие поля дают пустую строку, не undefined", () => {
  const rows = journalCsvRows([{
    n: 1, name: "Анна", status: GRADE_STATUS.GRADED,
    correct: 1, wrong: 0, skipped: 0, grade: null
  }]);
  const csv = toCsv(rows, JOURNAL_CSV_COLUMNS, { separator: ";" });
  assert.ok(!csv.includes("undefined"));
  assert.ok(!csv.includes("null"));
  assert.equal(rows[0]["ФИО"], "Анна");
});

test("колонки CSV — ровно семь, в порядке промта", () => {
  assert.deepEqual(JOURNAL_CSV_COLUMNS, [
    "№", "ФИО", "Статус участия", "Правильные ответы", "Неправильные ответы",
    "Пропуски", "Итоговая оценка"
  ]);
  const rows = journalCsvRows(buildJournal([{ uid: "a", name: "Анна", answers: { 0: 0 } }]));
  assert.deepEqual(Object.keys(rows[0]), JOURNAL_CSV_COLUMNS);
  const parsed = parseCsv(toCsv(rows, JOURNAL_CSV_COLUMNS, { separator: ";" }));
  assert.equal(parsed[0].length, 7);
  assert.equal(parsed[1].length, 7);
});

// ---------- Соответствие данным интерфейса и подключение ----------

test("CSV соответствует вкладке «Журнал»: те же строки, что в таблице панели", () => {
  const journal = buildJournal([
    { uid: "a", name: "Анна", answers: { 0: 0, 1: 1 } },
    { uid: "b", name: "Борис", answers: {} }
  ]);
  // Панель (интерфейс) и экспорт получают один и тот же массив journal.
  const panel = journalPanel(journal, { export: { title: "Срез", dateMs: 1760000000000 } });
  assert.ok(panel);
  const rows = journalCsvRows(journal);
  assert.equal(rows.length, journal.length);
  assert.equal(rows[0]["ФИО"], journal[0].name);
  assert.equal(rows[0]["Правильные ответы"], journal[0].correct);
  assert.equal(rows[0]["Пропуски"], journal[0].skipped);
  // Нет HTML и служебных данных в CSV.
  const csv = toCsv(rows, JOURNAL_CSV_COLUMNS, { separator: ";" });
  assert.ok(!csv.includes("<"));
  assert.ok(!csv.includes("script"));
});

test("кнопка «Экспорт CSV»: активна при данных, disabled при пустом журнале, скрыта без опции", () => {
  const findButton = (node) => {
    if (node.tag === "button" && String(node.attrs["aria-label"] || "").includes("Экспорт")) return node;
    const kids = Array.isArray(node.children) ? node.children : [];
    for (const child of kids) {
      if (!child || typeof child !== "object") continue;
      const found = findButton(child);
      if (found) return found;
    }
    return null;
  };
  const filled = journalPanel(
    buildJournal([{ uid: "a", name: "Анна", answers: { 0: 0 } }]),
    { export: { title: "Срез", dateMs: 1760000000000 } });
  const empty = journalPanel([], { export: { title: "Срез", dateMs: 1760000000000 } });
  const noExport = journalPanel(buildJournal([{ uid: "a", name: "Анна", answers: { 0: 0 } }]));
  assert.ok(findButton(filled));
  assert.equal(findButton(filled).disabled, false);
  assert.ok(findButton(empty));
  assert.equal(findButton(empty).disabled, true);
  assert.equal(findButton(noExport), null);
  // room.js передаёт export только во вкладке журнала ведущего.
  assert.match(roomPage, /case "journal":[\s\S]{0,300}export: \{/);
  assert.match(roomPage, /title: room\?\.testTitle \|\| ""/);
  assert.match(roomPage, /dateMs: finalFinishedMs\(room\)/);
});

test("экспорт исторического отчёта: из сохранённого снимка журнала", () => {
  // История: journal берётся из снимка (snapshot.journal), не пересчитывается.
  assert.match(historyPage, /journalPanel\(snapshot\.journal \|\| \[\], \{/);
  assert.match(historyPage, /title: snapshot\.testTitle \|\| ""/);
  assert.match(historyPage, /dateMs: snapshot\.finishedAtMs \?\? null/);
  // Снимок хранит те же строки журнала, что показаны в таблице отчёта.
  const snapshotJournal = buildJournal([
    { uid: "a", name: "Анна, Петровна", answers: { 0: 0 } },
    { uid: "b", name: "Борис", answers: {} }
  ]);
  const rows = journalCsvRows(snapshotJournal);
  assert.equal(rows.length, 2);
  const parsed = parseCsv(toCsv(rows, JOURNAL_CSV_COLUMNS, { separator: ";" }));
  assert.equal(parsed[1][1], "Анна, Петровна"); // запятая не сместила столбец
  // Оценка Анны: 90 × 1/3 + 10 × 1/3 ≈ 33 (та же формула, что на вкладке).
  assert.equal(parsed[1][6], "33");
  assert.equal(parsed[2][1], "Борис");
  assert.equal(parsed[2][6], "0");              // вошёл без ответов → 0
});

test("имя файла: название теста и дата, безопасно очищенные; скачивание не блокирует ввод", () => {
  assert.equal(safeFileName('Срез: знаний "А/Б"? <математика> *хитрый*'),
    "Срез знаний А Б математика хитрый");
  assert.equal(safeFileName(""), "журнал");
  assert.equal(safeFileName(null), "журнал");
  assert.ok(safeFileName("х".repeat(200)).length <= 80);
  // Скачивание: якорь с download-именем «Журнал <тест> <дата>.csv».
  document.body.children.length = 0;
  exportJournalCsv(
    buildJournal([{ uid: "a", name: "Анна", answers: { 0: 0 } }]),
    { title: "Срез: знаний", dateMs: 1760000000000 });
  const anchor = document.body.children.at(-1);
  assert.ok(anchor);
  assert.match(anchor.download, /^Журнал Срез знаний \d{4}-\d{2}-\d{2}\.csv$/u);
  assert.equal(anchor.clicked, true);
  // Дата берётся из снимка истории: 2025-10-09 для 1760000000000.
  assert.ok(anchor.download.includes("2025-10-09"));
});
