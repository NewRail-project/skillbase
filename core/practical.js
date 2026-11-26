// core/practical.js — практическая диагностика двух команд: таблицы-задания,
// проверка по ключам, подсчёт результата, сравнение команд.
// Чистый модуль: без DOM и Firebase, проверяется в Node.
//
// БЕЗОПАСНОСТЬ. Задание существует в двух видах:
//   · полное (план преподавателя) — ячейки-ответы несут ключи `accept`;
//   · публичное (splitTask → publicTask) — ключей нет вообще; именно оно
//     пишется в документ комнаты, который читают участники;
//   · ключи (splitTask → keys) уходят в закрытый документ только для ведущего.
// В клиентский код и публичные данные ключи не попадают.
//
// Ячейка таблицы:
//   { t: "label",  text }                         — готовый текст (заголовок строки)
//   { t: "answer", mode, accept?, tolerance?, unit?, points? } — поле для ответа
//     mode: "text" (слова/фразы), "number" (число), "manual" (проверяет преподаватель)
//   Идентификатор ячейки — r{строка}c{столбец}, нумерация с нуля.

export const TEAMS = ["a", "b"];
export const LIMITS = Object.freeze({
  maxRows: 20, maxCols: 6, maxTitle: 120, maxDescription: 1000,
  maxCell: 200, maxAnswer: 200, maxAccept: 10
});
export const MODES = Object.freeze(["text", "number", "manual"]);
export const MODE_LABEL = Object.freeze({ text: "Текст", number: "Число", manual: "Вручную" });

export const cellId = (row, col) => `r${row}c${col}`;
const clip = (v, n) => String(v ?? "").slice(0, n);

// ---------- Создание и нормализация ----------

export function emptyTask() {
  return {
    title: "", description: "",
    columns: ["Параметр", "Значение"],
    rows: [[{ t: "label", text: "" }, { t: "answer", mode: "text", accept: [] }]]
  };
}

function normalizeCell(raw) {
  if (raw && raw.t === "answer") {
    const mode = MODES.includes(raw.mode) ? raw.mode : "text";
    const accept = (Array.isArray(raw.accept) ? raw.accept : [])
      .map(a => clip(a, LIMITS.maxAnswer).trim()).filter(Boolean).slice(0, LIMITS.maxAccept);
    const out = { t: "answer", mode, accept };
    const tol = Number(raw.tolerance);
    if (mode === "number" && Number.isFinite(tol) && tol > 0) out.tolerance = tol;
    if (raw.unit) out.unit = clip(raw.unit, 20).trim();
    const pts = Number(raw.points);
    out.points = Number.isFinite(pts) && pts > 0 ? Math.min(pts, 100) : 1;
    return out;
  }
  return { t: "label", text: clip(raw?.text, LIMITS.maxCell) };
}

export function normalizeTask(raw) {
  const base = emptyTask();
  if (!raw || typeof raw !== "object") return base;
  const columns = (Array.isArray(raw.columns) ? raw.columns : base.columns)
    .slice(0, LIMITS.maxCols).map(c => clip(c, LIMITS.maxCell));
  const rows = (Array.isArray(raw.rows) ? raw.rows : [])
    .slice(0, LIMITS.maxRows)
    .map(r => Array.from({ length: columns.length }, (_, i) => normalizeCell((Array.isArray(r) ? r : [])[i])));
  return {
    title: clip(raw.title, LIMITS.maxTitle).trim(),
    description: clip(raw.description, LIMITS.maxDescription).trim(),
    columns: columns.length ? columns : base.columns,
    rows: rows.length ? rows : base.rows
  };
}

// Ошибки подготовки — понятные русские фразы (показываются в редакторе).
export function validateTask(task, { team = "" } = {}) {
  const who = team ? `Задание команды ${team === "a" ? "А" : "Б"}: ` : "";
  const errors = [];
  const t = task || {};
  if (!String(t.title || "").trim()) errors.push(`${who}укажите название задания.`);
  if (!Array.isArray(t.columns) || t.columns.length < 1) errors.push(`${who}нужен хотя бы один столбец.`);
  if (!Array.isArray(t.rows) || t.rows.length < 1) errors.push(`${who}нужна хотя бы одна строка.`);
  if (t.columns?.length > LIMITS.maxCols) errors.push(`${who}столбцов не больше ${LIMITS.maxCols}.`);
  if (t.rows?.length > LIMITS.maxRows) errors.push(`${who}строк не больше ${LIMITS.maxRows}.`);
  let answers = 0;
  (t.rows || []).forEach((row, r) => (row || []).forEach((cell, c) => {
    if (cell?.t !== "answer") return;
    answers += 1;
    const where = `строка ${r + 1}, столбец ${c + 1}`;
    if (cell.mode !== "manual" && !(cell.accept || []).some(a => String(a).trim())) {
      errors.push(`${who}${where}: задайте ожидаемый ответ или выберите проверку вручную.`);
    }
    if (cell.mode === "number") {
      for (const a of cell.accept || []) {
        if (!Number.isFinite(parseNumber(a, cell.unit))) errors.push(`${who}${where}: «${a}» не число.`);
      }
    }
  }));
  if (answers === 0) errors.push(`${who}добавьте хотя бы одну ячейку для ответа.`);
  return errors;
}

// ---------- Разделение: публичное задание и ключи ----------

// Публичное задание: те же строки, но у ячеек-ответов нет `accept`.
export function publicTask(task) {
  const t = normalizeTask(task);
  return {
    title: t.title, description: t.description, columns: t.columns,
    rows: t.rows.map(row => row.map(cell => cell.t === "answer"
      ? { t: "answer", mode: cell.mode, ...(cell.unit ? { unit: cell.unit } : {}), points: cell.points }
      : { t: "label", text: cell.text }))
  };
}

// Ключи: { r0c1: { mode, accept[], tolerance?, unit?, points } } — только ответы.
export function taskKeys(task) {
  const t = normalizeTask(task);
  const keys = {};
  t.rows.forEach((row, r) => row.forEach((cell, c) => {
    if (cell.t !== "answer") return;
    keys[cellId(r, c)] = {
      mode: cell.mode, accept: cell.accept, points: cell.points,
      ...(cell.tolerance ? { tolerance: cell.tolerance } : {}),
      ...(cell.unit ? { unit: cell.unit } : {})
    };
  }));
  return keys;
}

export const splitTask = (task) => ({ publicTask: publicTask(task), keys: taskKeys(task) });

// Идентификаторы всех ячеек для ответа в публичном задании.
export function answerCellIds(pub) {
  const ids = [];
  (pub?.rows || []).forEach((row, r) => (row || []).forEach((cell, c) => {
    if (cell?.t === "answer") ids.push(cellId(r, c));
  }));
  return ids;
}

// ---------- Проверка ответов ----------

// Текст: пробелы схлопываются, регистр и «ё/е» не различаются, крайняя
// пунктуация отбрасывается. Никакого нечёткого сравнения: «похоже» не значит
// «верно» (ложные совпадения хуже пропуска — спорное решает преподаватель).
export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/ё/gi, "е")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/^[\s.,;:!?"'«»()-]+|[\s.,;:!?"'«»()-]+$/g, "");
}

// Число: запятая и точка — десятичный разделитель, пробелы внутри (в т.ч.
// неразрывные) игнорируются, единица измерения снимается, если задана.
export function parseNumber(value, unit = "") {
  let s = String(value ?? "").normalize("NFKC").trim().toLowerCase();
  if (unit) {
    const u = String(unit).normalize("NFKC").trim().toLowerCase();
    if (u && s.endsWith(u)) s = s.slice(0, -u.length);
  }
  s = s.replace(/[\s\u00A0]/g, "").replace(",", ".").replace("−", "-");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return Number(s);
}

// Вердикт одной ячейки: true | false | null (ждёт ручной проверки).
// Пустой ответ — всегда false (но не для ручной проверки: там решает человек).
export function checkAnswer(raw, key) {
  if (!key || key.mode === "manual") return null;
  const answer = String(raw ?? "").trim();
  if (!answer) return false;
  const accept = Array.isArray(key.accept) ? key.accept : [];
  if (key.mode === "number") {
    const got = parseNumber(answer, key.unit);
    if (!Number.isFinite(got)) return false;
    const tol = Number(key.tolerance) || 0;
    return accept.some(a => {
      const want = parseNumber(a, key.unit);
      return Number.isFinite(want) && Math.abs(got - want) <= tol + 1e-9;
    });
  }
  const norm = normalizeText(answer);
  return accept.some(a => normalizeText(a) === norm);
}

// ---------- Результат команды ----------

const round2 = (v) => Math.round(v * 100) / 100;

// evaluateSubmission({ pub, keys, cells, overrides })
//   cells     — ответы команды { r0c1: "текст" }
//   overrides — решения преподавателя { r0c1: true|false } поверх автопроверки
// Возвращает по каждой ячейке итоговый вердикт и его источник:
//   source: "auto" | "teacher" | "pending" (ручная проверка ещё не сделана).
export function evaluateSubmission({ pub, keys = {}, cells = {}, overrides = {} } = {}) {
  const out = {};
  let score = 0;
  let max = 0;
  let pending = 0;
  let answered = 0;
  for (const id of answerCellIds(pub)) {
    const key = keys[id];
    const points = Number(key?.points) || 1;
    const raw = String(cells[id] ?? "").trim();
    if (raw) answered += 1;
    const auto = checkAnswer(raw, key);
    let ok;
    let source;
    if (typeof overrides[id] === "boolean") { ok = overrides[id]; source = "teacher"; }
    else if (auto === null) { ok = null; source = "pending"; }
    else { ok = auto; source = "auto"; }
    max += points;
    if (ok === true) score += points;
    if (ok === null) pending += 1;
    out[id] = { ok, source, points, answer: raw };
  }
  return {
    cells: out, score: round2(score), max: round2(max), answered,
    total: Object.keys(out).length, pending,
    percent: max > 0 ? round2((score / max) * 100) : 0,
    complete: pending === 0
  };
}

// Сравнение команд по ПРОЦЕНТУ: задания у команд разные, число баллов может
// отличаться. Ничья — только при равном проценте. Результат с неоконченной
// ручной проверкой сравнивать нельзя.
export function compareTeams(a, b) {
  if (!a || !b) return { ready: false, reason: "Нет результата одной из команд.", winner: null, tie: false };
  if (!a.complete || !b.complete) {
    return { ready: false, reason: "Есть ответы, которые ждут ручной проверки.", winner: null, tie: false };
  }
  const tie = a.percent === b.percent;
  return {
    ready: true, reason: "", tie,
    winner: tie ? null : a.percent > b.percent ? "a" : "b",
    a: { score: a.score, max: a.max, percent: a.percent },
    b: { score: b.score, max: b.max, percent: b.percent }
  };
}

// ---------- Отправка и права ----------

export const SUBMISSION = Object.freeze({ DRAFT: "draft", SUBMITTED: "submitted" });
export const TASK_STATUS = Object.freeze({ DRAFT: "draft", OPEN: "open", CLOSED: "closed", CONFIRMED: "confirmed" });

// Допустимые ответы: только известные ячейки, обрезанные по длине. Лишнее
// (чужие ключи, посторонние поля) отбрасывается — в документ уходит чистая карта.
export function sanitizeCells(pub, cells) {
  const out = {};
  for (const id of answerCellIds(pub)) {
    if (cells && Object.prototype.hasOwnProperty.call(cells, id)) {
      out[id] = clip(cells[id], LIMITS.maxAnswer);
    }
  }
  return out;
}

// ---------- Ввод ведущим (на доске) ----------
// Команды называют значения вслух, ведущий вносит их в таблицы. Значения живут
// в закрытом документе battleRounds/practical_entry (пишет только ведущий), а не
// в practicalSubmissions: правила разрешают писать туда лишь капитану. Для
// проверки они превращаются в обычные «отправленные таблицы».

export const ENTRY_MODE = Object.freeze({ HOST: "host", CAPTAIN: "captain" });

// Чистая карта ввода: только известные ячейки обеих таблиц, обрезанная по длине.
export function sanitizeEntry(tasks, entry) {
  const out = { mode: entry?.mode === ENTRY_MODE.HOST ? ENTRY_MODE.HOST : ENTRY_MODE.CAPTAIN };
  for (const team of TEAMS) out[team] = tasks?.[team] ? sanitizeCells(tasks[team], entry?.[team] || {}) : {};
  return out;
}

// Ввод ведущего в виде «отправленных таблиц» для evaluateSubmission/compareTeams.
export function entryToSubmissions(tasks, entry) {
  const subs = {};
  for (const team of TEAMS) {
    if (!tasks?.[team]) continue;
    subs[team] = { team, cells: sanitizeCells(tasks[team], entry?.[team] || {}), status: SUBMISSION.SUBMITTED, by: "host" };
  }
  return subs;
}

// Сколько ячеек заполнено из скольких.
export function entryProgress(task, cells) {
  const ids = task ? answerCellIds(task) : [];
  const filled = ids.filter((id) => String(cells?.[id] ?? "").trim()).length;
  return { filled, total: ids.length };
}

// Можно ли проверять: у каждой команды заполнена хотя бы одна ячейка.
export function canCheckEntry(tasks, entry) {
  return TEAMS.every((t) => tasks?.[t] && entryProgress(tasks[t], entry?.[t]).filled > 0);
}

// Можно ли команде править таблицу: задание открыто, не отправлено, пишет капитан.
export function canEditSubmission({ taskStatus, submission, isCaptain }) {
  if (!isCaptain) return { ok: false, reason: "Заполняет таблицу капитан команды." };
  if (taskStatus !== TASK_STATUS.OPEN) return { ok: false, reason: "Задание сейчас закрыто." };
  if (submission?.status === SUBMISSION.SUBMITTED) return { ok: false, reason: "Таблица уже отправлена и зафиксирована." };
  return { ok: true, reason: "" };
}

// Сводка этапа для ведущего: что у каждой команды и можно ли определять результат.
export function practicalOverview({ tasks = {}, submissions = {} } = {}) {
  const teams = {};
  for (const id of TEAMS) {
    const task = tasks[id];
    const sub = submissions[id];
    teams[id] = {
      hasTask: Boolean(task),
      status: !task ? "none"
        : sub?.status === SUBMISSION.SUBMITTED ? "submitted"
        : sub ? "draft" : (task.status === TASK_STATUS.OPEN ? "waiting" : "closed"),
      confirmed: task?.status === TASK_STATUS.CONFIRMED
    };
  }
  const bothSubmitted = TEAMS.every(id => teams[id].status === "submitted");
  return {
    teams, bothSubmitted,
    canDetermine: bothSubmitted && !TEAMS.every(id => teams[id].confirmed),
    confirmed: TEAMS.every(id => teams[id].confirmed)
  };
}
