// ui/components/practical.js — экраны практической диагностики двух команд:
//   buildPracticalPlayer — участник/капитан: своя таблица, черновик, отправка;
//   buildPracticalHost   — преподаватель: статусы команд, проверка, решения,
//                          подтверждение результата и победитель;
//   buildPracticalScreen — проектор/наблюдатель: статусы и итог, без ответов
//                          до подтверждения.
//
// Правильные ответы нигде здесь не приходят участнику: публичное задание их
// не содержит, ключи читает только ведущий. Вид обновляется на месте — поля
// ввода не пересоздаются при каждом снимке Firestore (иначе пропадает фокус
// и набранный текст).
import { h } from "../../shared/dom.js";
import {
  TEAMS, TASK_STATUS, SUBMISSION, ENTRY_MODE, cellId, canEditSubmission, evaluateSubmission, compareTeams, answerCellIds,
  entryToSubmissions, entryProgress, canCheckEntry
} from "../../core/practical.js";

const TEAM_NAME = { a: "Команда А", b: "Команда Б" };
const fmt = (n) => String(Math.round((Number(n) || 0) * 100) / 100);

// ---------- Общая таблица ----------

// values — { r0c1: "текст" }; verdicts — { r0c1: true|false|null }; expected — только для ведущего.
// editable — вернуть поля ввода; onInput(id, value).
export function renderTable(pub, { values = {}, editable = false, onInput = () => {}, verdicts = null, expected = null, disabled = false } = {}) {
  const inputs = {};
  const cells = {};
  const answers = {};
  const head = h("tr", {}, ...(pub.columns || []).map(c => h("th", { scope: "col" }, c)));
  const rows = (pub.rows || []).map((row, r) => h("tr", {}, ...row.map((cell, c) => {
    if (cell.t !== "answer") return c === 0 ? h("th", { scope: "row" }, cell.text) : h("td", {}, cell.text);
    const id = cellId(r, c);
    const label = `${row[0]?.t === "label" ? row[0].text : `Строка ${r + 1}`}: ${pub.columns?.[c] || `столбец ${c + 1}`}`;
    let body;
    if (editable) {
      const input = h("input", { type: "text", class: "pr-input", "aria-label": label, maxlength: "200", disabled });
      input.value = values[id] ?? "";
      input.addEventListener("input", () => onInput(id, input.value));
      inputs[id] = input;
      body = input;
    } else {
      body = h("span", { class: "pr-answer" }, values[id] ? values[id] : "—");
      answers[id] = body;
    }
    const ok = verdicts ? verdicts[id] : undefined;
    const mark = ok === true ? h("span", { class: "pr-mark pr-ok" }, " ✓ верно")
      : ok === false ? h("span", { class: "pr-mark pr-bad" }, " ✗ неверно") : null;
    const exp = expected && expected[id] ? h("small", { class: "pr-expected" }, `Ожидается: ${expected[id]}`) : null;
    const td = h("td", { "data-cell": id, ...(ok === true ? { "data-ok": "1" } : ok === false ? { "data-ok": "0" } : {}) }, body, mark, exp);
    cells[id] = td;
    return td;
  })));
  const el = h("div", { class: "pr-table-wrap" }, h("table", { class: "pr-table" }, h("thead", {}, head), h("tbody", {}, ...rows)));
  return { el, inputs, cells, answers };
}

const statusChip = (text, kind = "") => h("span", { class: `pr-chip ${kind}`.trim() }, text);

// ---------- Участник / капитан ----------

// api: { saveDraft(cells), submit(cells) }; getMe() → { team, isCaptain }
export function buildPracticalPlayer({ api, getMe, confirmSubmit = (msg) => (typeof window !== "undefined" ? window.confirm(msg) : true), schedule = (fn, ms) => setTimeout(fn, ms), clear = (id) => clearTimeout(id), autosaveMs = 1500 }) {
  let task = null;
  let sub = null;
  let draft = {};
  let dirty = false;
  let busy = false;
  let timer = null;
  let sig = null;
  let inputs = {};
  let answerEls = {};
  const status = h("p", { class: "pr-status", role: "status" }, "");
  const body = h("div", { class: "pr-body" });
  const el = h("section", { class: "practical practical-player", "aria-label": "Практическая диагностика" }, body, status);

  const me = () => getMe() || {};

  async function persist(final) {
    const { team } = me();
    if (!team || busy) return;
    busy = true;
    try {
      if (final) await api.submit(draft); else await api.saveDraft(draft);
      dirty = false;
      status.textContent = final ? "Таблица отправлена и зафиксирована." : "Черновик сохранён.";
    } catch (err) {
      console.error("Практика:", err);
      status.textContent = err?.code === "permission-denied"
        ? "Нельзя сохранить: задание закрыто или таблица уже отправлена."
        : (err?.message || "Не удалось сохранить. Проверьте соединение и повторите.");
    } finally { busy = false; }
  }

  function onInput(id, value) {
    draft = { ...draft, [id]: value };
    dirty = true;
    status.textContent = "Есть несохранённые изменения…";
    if (timer) clear(timer);
    timer = schedule(() => { timer = null; persist(false); }, autosaveMs);
  }

  function paint() {
    const { team, isCaptain } = me();
    const confirmed = task?.status === TASK_STATUS.CONFIRMED;
    const permission = canEditSubmission({ taskStatus: task?.status, submission: sub, isCaptain: Boolean(isCaptain) });
    const submitted = sub?.status === SUBMISSION.SUBMITTED;
    const nextSig = JSON.stringify([team, Boolean(task), task?.status, task?.title, (task?.rows || []).length, submitted, permission.ok, isCaptain, confirmed]);

    if (nextSig !== sig) {
      sig = nextSig;
      if (!team) { body.replaceChildren(h("p", { class: "muted" }, "Вы не в команде: практика проходит командами.")); return; }
      if (!task || task.status === TASK_STATUS.DRAFT) {
        body.replaceChildren(h("div", { class: "pr-wait" }, h("h2", {}, "Практическая диагностика"), h("p", { class: "muted" }, "Задание появится, когда преподаватель его откроет.")));
        return;
      }
      draft = { ...(sub?.cells || {}), ...(permission.ok ? draft : {}) };
      const verdicts = confirmed ? task.result?.cells : null;
      const table = renderTable(task, {
        values: confirmed || !permission.ok ? (sub?.cells || {}) : draft,
        editable: permission.ok, onInput, verdicts
      });
      inputs = table.inputs;
      answerEls = table.answers;
      const head = h("header", { class: "pr-head" },
        h("p", { class: "pr-kicker" }, `${TEAM_NAME[team] || ""} · ${confirmed ? "результат" : submitted ? "отправлено" : "заполняется"}`),
        h("h2", {}, task.title),
        task.description ? h("p", { class: "pr-desc" }, task.description) : null);
      const parts = [head, table.el];
      if (permission.ok) {
        const save = h("button", { type: "button", class: "btn secondary", "data-action": "save" }, "Сохранить черновик");
        save.addEventListener("click", () => persist(false));
        const send = h("button", { type: "button", class: "btn primary", "data-action": "submit" }, "Отправить таблицу");
        send.addEventListener("click", async () => {
          if (busy) return; // повторное нажатие
          if (!confirmSubmit("После отправки таблицу нельзя изменить. Отправить?")) return;
          if (timer) { clear(timer); timer = null; }
          await persist(true);
        });
        parts.push(h("div", { class: "btn-row" }, save, send));
      } else if (confirmed) {
        const r = task.result || {};
        const won = r.winner === team;
        parts.push(h("div", { class: "pr-final", "data-outcome": r.winner === "tie" ? "tie" : won ? "win" : "lose", role: "status" },
          h("b", {}, `Результат: ${fmt(r.score)} из ${fmt(r.max)} (${fmt(r.percent)}%)`),
          h("span", {}, r.winner === "tie" ? "Ничья: у команд одинаковый результат." : won ? "Ваша команда победила в практике." : "В практике победила другая команда.")));
      } else {
        parts.push(h("p", { class: "pr-note" }, submitted ? "Таблица отправлена и зафиксирована. Ждём результат преподавателя."
          : isCaptain ? permission.reason : "Таблицу заполняет капитан команды. Здесь видно его ответы."));
      }
      body.replaceChildren(...parts);
      return;
    }
    // Структура прежняя: обновляем только значения у читающих (поля капитана не трогаем).
    if (!permission.ok && sub?.cells) {
      for (const [id, span] of Object.entries(answerEls)) {
        const next = sub.cells[id] || "—";
        if (span.textContent !== next) span.textContent = next;
      }
    }
  }
  paint();

  return {
    el,
    update({ task: t, submission }) {
      task = t; sub = submission;
      paint();
    },
    // Для тестов и повторного показа.
    isDirty: () => dirty,
    flush: () => persist(false),
    destroy() { if (timer) clear(timer); timer = null; }
  };
}

// ---------- Проектор / наблюдатель ----------

export function buildPracticalScreen() {
  let tasks = {};
  let subs = {};
  const body = h("div", { class: "pr-screen-body" });
  const el = h("section", { class: "practical practical-screen", "aria-label": "Практическая диагностика" }, body);

  function paint() {
    const confirmed = TEAMS.every(t => tasks[t]?.status === TASK_STATUS.CONFIRMED);
    const cards = TEAMS.map(team => {
      const t = tasks[team];
      const s = subs[team];
      const state = !t || t.status === TASK_STATUS.DRAFT ? "Готовится"
        : t.status === TASK_STATUS.CONFIRMED ? "Проверено"
        : s?.status === SUBMISSION.SUBMITTED ? "Отправлено"
        : s ? "Заполняет" : "Ожидает";
      const res = t?.result;
      return h("article", { class: "pr-team", "data-team": team },
        h("h2", {}, TEAM_NAME[team]),
        h("p", { class: "pr-team-task" }, t?.title || "Задание готовится"),
        h("p", { class: "pr-team-state" }, state),
        res ? h("p", { class: "pr-team-score" }, `${fmt(res.score)} из ${fmt(res.max)} · ${fmt(res.percent)}%`) : null);
    });
    const parts = [h("div", { class: "pr-teams" }, ...cards)];
    if (confirmed) {
      const w = tasks.a.result?.winner;
      parts.push(h("div", { class: "pr-announce", "data-winner": w === "a" || w === "b" ? w : "tie", role: "status" },
        h("p", { class: "pr-kicker" }, "Результат практики"),
        h("h2", {}, w === "a" || w === "b" ? `Победила ${TEAM_NAME[w]}` : "Ничья")));
    }
    body.replaceChildren(...parts);
  }
  paint();
  return { el, update({ tasks: t, submissions }) { tasks = t || {}; subs = submissions || {}; paint(); }, destroy() {} };
}

// ---------- Преподаватель ----------

// api: setup(), setStatus(team, status), loadKeys(team), loadReview(), saveReview(overrides),
//      returnForRevision(team), confirm({evaluations, comparison, overrides})
export function buildPracticalHost({ api, confirmAction = (msg) => (typeof window !== "undefined" ? window.confirm(msg) : true) }) {
  let tasks = {};
  let subs = {};
  let keys = {};
  let overrides = { a: {}, b: {} };
  let reviewing = false;
  let busy = false;
  let loadedReview = false;
  // Ввод ведущим (на доске): значения вносит ведущий, команды называют их вслух.
  // Режим включён только если интерфейс получил api.saveEntry (комната в старой версии — без него).
  const hostEntryAvailable = typeof api.saveEntry === "function";
  let entry = { mode: ENTRY_MODE.CAPTAIN, a: {}, b: {} };
  let entryLoaded = false;
  let board = null;          // построенные таблицы ввода: живут между перерисовками
  let boardSig = null;
  let lastSig = null;
  let saveTimer = null;
  const hostMode = () => hostEntryAvailable && entry.mode === ENTRY_MODE.HOST;
  const view = () => (hostMode() ? entryToSubmissions(tasks, entry) : subs);
  const status = h("p", { class: "pr-status", role: "status" }, "");
  const alertBox = h("p", { class: "error-msg", role: "alert" }, "");
  const body = h("div", { class: "pr-host-body" });
  const el = h("section", { class: "practical practical-host", "aria-label": "Практика: управление" }, body, status, alertBox);

  const confirmed = () => TEAMS.every(t => tasks[t]?.status === TASK_STATUS.CONFIRMED);
  const prepared = () => TEAMS.every(t => Boolean(tasks[t]));
  const open = () => TEAMS.every(t => tasks[t]?.status === TASK_STATUS.OPEN);

  async function run(label, fn) {
    if (busy) return; // повторное нажатие
    busy = true; alertBox.textContent = ""; status.textContent = `${label}…`;
    try { await fn(); status.textContent = ""; }
    catch (err) {
      console.error("Практика (ведущий):", err);
      alertBox.textContent = err?.code === "permission-denied" ? "Нет прав на это действие." : (err?.message || "Действие не выполнено.");
      status.textContent = "";
    } finally { busy = false; paint(); }
  }

  const results = () => {
    const pubs = tasks;
    const evaluations = {};
    const src = view();
    for (const team of TEAMS) {
      if (!pubs[team] || !src[team]) continue;
      evaluations[team] = evaluateSubmission({ pub: pubs[team], keys: keys[team] || {}, cells: src[team].cells || {}, overrides: overrides[team] || {} });
    }
    return { evaluations, comparison: compareTeams(evaluations.a, evaluations.b) };
  };

  function teamCard(team) {
    const t = tasks[team];
    const s = subs[team];
    const submitted = s?.status === SUBMISSION.SUBMITTED;
    const chips = [
      statusChip(!t ? "Нет задания" : t.status === TASK_STATUS.OPEN ? "Открыто" : t.status === TASK_STATUS.CONFIRMED ? "Подтверждено" : t.status === TASK_STATUS.CLOSED ? "Закрыто" : "Подготовлено", t?.status === TASK_STATUS.OPEN ? "pr-chip-on" : ""),
      statusChip(submitted ? "Таблица отправлена" : s ? "Черновик" : "Пока пусто", submitted ? "pr-chip-ok" : "")
    ];
    const actions = [];
    if (submitted && !confirmed()) {
      const back = h("button", { type: "button", class: "btn secondary btn-sm", "data-action": `return-${team}` }, "Вернуть на доработку");
      back.addEventListener("click", () => run("Возвращаем", async () => { if (confirmAction(`Вернуть таблицу ${TEAM_NAME[team]} на доработку?`)) await api.returnForRevision(team); }));
      actions.push(back);
    }
    // Прогресс и черновик: ведущий видит, как идёт заполнение, ещё до отправки.
    const ids = t ? answerCellIds(t) : [];
    const filled = ids.filter(id => String(s?.cells?.[id] ?? "").trim()).length;
    const progress = t && ids.length
      ? h("p", { class: "pr-progress", "data-filled": String(filled) }, `Заполнено ячеек: ${filled} из ${ids.length}`) : null;
    const draftView = t && s && filled > 0 && !confirmed()
      ? h("details", { class: "pr-draft" },
        h("summary", {}, submitted ? "Посмотреть отправленную таблицу" : "Посмотреть черновик"),
        renderTable(t, { values: s.cells || {} }).el)
      : null;
    return h("article", { class: "pr-team-card", "data-team": team },
      h("h3", {}, TEAM_NAME[team]), h("p", { class: "pr-team-task" }, t?.title || "—"),
      h("div", { class: "pr-chips" }, ...chips), progress, draftView, ...actions);
  }

  function reviewPanel() {
    const { evaluations, comparison } = results();
    const src = view();
    const blocks = TEAMS.filter(t => tasks[t] && src[t]).map(team => {
      const ev = evaluations[team];
      const verdicts = Object.fromEntries(Object.entries(ev.cells).map(([id, c]) => [id, c.ok]));
      const expectedText = Object.fromEntries(Object.entries(keys[team] || {}).map(([id, k]) => [id, k.mode === "manual" ? "проверяет преподаватель" : (k.accept || []).join(" / ")]));
      const table = renderTable(tasks[team], { values: src[team].cells || {}, verdicts, expected: expectedText });
      // Решение по каждой ячейке: авто / верно / неверно.
      for (const [id, cell] of Object.entries(ev.cells)) {
        const td = table.cells[id];
        if (!td) continue;
        const set = (v) => { overrides[team] = { ...(overrides[team] || {}) }; if (v === null) delete overrides[team][id]; else overrides[team][id] = v; api.saveReview(overrides).catch(() => {}); paint(); };
        const mk = (label, v, active) => { const b = h("button", { type: "button", class: "pr-decide", "aria-pressed": String(active), "aria-label": `${label}: ${id}` }, label); b.addEventListener("click", () => set(v)); return b; };
        td.appendChild(h("div", { class: "pr-decisions", role: "group", "aria-label": "Решение преподавателя" },
          mk("Авто", null, cell.source !== "teacher"), mk("Верно", true, cell.source === "teacher" && cell.ok === true), mk("Неверно", false, cell.source === "teacher" && cell.ok === false)));
      }
      return h("section", { class: "pr-review-team", "data-team": team },
        h("h3", {}, `${TEAM_NAME[team]}: ${fmt(ev.score)} из ${fmt(ev.max)} (${fmt(ev.percent)}%)`),
        ev.pending ? h("p", { class: "pr-note" }, `Ждут вашей проверки: ${ev.pending}.`) : null, table.el);
    });
    const outcome = !comparison.ready ? h("p", { class: "pr-note" }, comparison.reason)
      : h("div", { class: "pr-announce", "data-winner": comparison.tie ? "tie" : comparison.winner, role: "status" },
        h("p", { class: "pr-kicker" }, "Предварительный результат"),
        h("h2", {}, comparison.tie ? "Ничья" : `Побеждает ${TEAM_NAME[comparison.winner]}`),
        h("p", {}, `${fmt(comparison.a.percent)}% : ${fmt(comparison.b.percent)}%`));
    const confirm = h("button", { type: "button", class: "btn primary", "data-action": "confirm", disabled: !comparison.ready }, "Подтвердить результат");
    confirm.addEventListener("click", () => run("Подтверждаем", async () => {
      const fresh = results();
      if (!fresh.comparison.ready) throw new Error(fresh.comparison.reason);
      if (!confirmAction("После подтверждения результат фиксируется и объявляется участникам. Продолжить?")) return;
      await api.confirm({ ...fresh, overrides });
      reviewing = false;
    }));
    const back = h("button", { type: "button", class: "btn secondary", "data-action": "close-review" }, "Закрыть проверку");
    back.addEventListener("click", () => { reviewing = false; paint(); });
    // Таблицы команд стоят друг напротив друга (на узком экране — друг под другом).
    return h("div", { class: "pr-review" }, h("div", { class: "pr-sides" }, ...blocks), outcome, h("div", { class: "btn-row" }, confirm, back));
  }

  // ---- Ввод ведущим: таблицы двух команд друг напротив друга ----
  let checkBtn = null;
  function persistEntry(now = false) {
    clearTimeout(saveTimer);
    const go = () => Promise.resolve(api.saveEntry(entry, tasks)).catch((err) => {
      alertBox.textContent = err?.message || "Не удалось сохранить введённые значения.";
    });
    if (now) return go();
    saveTimer = setTimeout(go, 800);
    return Promise.resolve();
  }
  function refreshCheck() { if (checkBtn) checkBtn.disabled = busy || !canCheckEntry(tasks, entry); }

  // Таблицы строятся один раз и переживают перерисовки: поля не теряют фокус
  // и набранный текст, пока приходят снимки Firestore.
  function hostBoard() {
    const sig = JSON.stringify(TEAMS.map(t => [tasks[t]?.title, tasks[t]?.columns, tasks[t]?.rows]));
    if (board && boardSig === sig) return board.el;
    boardSig = sig;
    const sections = TEAMS.map(team => {
      const t = tasks[team];
      const progress = h("p", { class: "pr-progress", "data-team": team }, "");
      const paintProgress = () => {
        const p = entryProgress(t, entry[team]);
        progress.textContent = `Заполнено ячеек: ${p.filled} из ${p.total}`;
        progress.setAttribute("data-filled", String(p.filled));
      };
      const table = renderTable(t, {
        editable: true, values: entry[team] || {},
        onInput: (id, value) => { entry[team] = { ...(entry[team] || {}), [id]: value }; paintProgress(); refreshCheck(); persistEntry(); }
      });
      paintProgress();
      return h("section", { class: "pr-side", "data-team": team },
        h("h3", {}, TEAM_NAME[team]), h("p", { class: "pr-team-task" }, t?.title || "—"), table.el, progress);
    });
    const el = h("div", { class: "pr-sides pr-board", role: "group", "aria-label": "Таблицы команд: ввод ведущего" }, ...sections);
    el.addEventListener("focusout", () => persistEntry(true));
    board = { el };
    return el;
  }

  function paint() {
    const showBoard = hostMode() && prepared() && !confirmed() && !reviewing;
    const parts = [h("h2", {}, "Практическая диагностика"), showBoard ? hostBoard() : h("div", { class: "pr-team-cards" }, teamCard("a"), teamCard("b"))];
    const controls = [];
    checkBtn = null;
    if (!prepared()) {
      const b = h("button", { type: "button", class: "btn primary", "data-action": "setup" }, "Подготовить и открыть задания");
      b.addEventListener("click", () => run("Готовим задания", async () => { await api.setup(); await api.setStatus("a", TASK_STATUS.OPEN); await api.setStatus("b", TASK_STATUS.OPEN); }));
      controls.push(b);
      if (hostEntryAvailable) {
        const bh = h("button", { type: "button", class: "btn secondary", "data-action": "setup-host" }, "Подготовить для ввода на доске");
        bh.addEventListener("click", () => run("Готовим задания", async () => {
          await api.setup();
          for (const t of TEAMS) await api.setStatus(t, TASK_STATUS.CLOSED); // команды сами не пишут
          entry = { mode: ENTRY_MODE.HOST, a: {}, b: {} };
          boardSig = null; board = null;
          await api.saveEntry(entry, tasks);
        }));
        controls.push(bh, h("p", { class: "pr-note" }, "«Ввод на доске»: команды называют значения вслух, вы вносите их в таблицы сами."));
      }
    } else if (!confirmed() && hostMode()) {
      // Ввод ведущим: единственное действие — «Проверить».
      if (!reviewing) {
        checkBtn = h("button", { type: "button", class: "btn primary", "data-action": "check", disabled: !canCheckEntry(tasks, entry) }, "Проверить");
        checkBtn.addEventListener("click", () => run("Проверяем", async () => {
          await persistEntry(true);
          for (const t of TEAMS) keys[t] = await api.loadKeys(t);
          if (!loadedReview) { overrides = { a: {}, b: {}, ...(await api.loadReview()) }; loadedReview = true; }
          reviewing = true;
        }));
        controls.push(checkBtn, h("p", { class: "pr-note" }, "Внесите значения обеих команд и нажмите «Проверить»: очки начисляются по правильности ответов."));
      }
    } else if (!confirmed()) {
      const toggle = h("button", { type: "button", class: "btn secondary", "data-action": "toggle" }, open() ? "Закрыть приём ответов" : "Открыть задания");
      toggle.addEventListener("click", () => run("Меняем статус", async () => {
        const to = open() ? TASK_STATUS.CLOSED : TASK_STATUS.OPEN;
        for (const t of TEAMS) await api.setStatus(t, to);
      }));
      controls.push(toggle);
      const both = TEAMS.every(t => subs[t]?.status === SUBMISSION.SUBMITTED);
      const determine = h("button", { type: "button", class: "btn primary", "data-action": "determine", disabled: !both }, "Определить результат");
      determine.addEventListener("click", () => run("Загружаем ключи", async () => {
        for (const t of TEAMS) keys[t] = await api.loadKeys(t);
        if (!loadedReview) { overrides = { a: {}, b: {}, ...(await api.loadReview()) }; loadedReview = true; }
        reviewing = true;
      }));
      controls.push(determine);
      if (!both) controls.push(h("p", { class: "pr-note" }, "Кнопка станет доступна, когда обе команды отправят таблицы."));
    } else {
      const r = tasks.a.result;
      parts.push(h("div", { class: "pr-announce", "data-winner": r?.winner === "a" || r?.winner === "b" ? r.winner : "tie", role: "status" },
        h("p", { class: "pr-kicker" }, "Результат подтверждён"),
        h("h2", {}, r?.winner === "a" || r?.winner === "b" ? `Победила ${TEAM_NAME[r.winner]}` : "Ничья"),
        h("p", {}, `${fmt(tasks.a.result?.percent)}% : ${fmt(tasks.b.result?.percent)}%`)));
      if (hostMode()) {
        parts.push(h("div", { class: "pr-sides pr-final" }, ...TEAMS.map(team => h("section", { class: "pr-side", "data-team": team },
          h("h3", {}, `${TEAM_NAME[team]}: ${fmt(tasks[team]?.result?.score)} из ${fmt(tasks[team]?.result?.max)} (${fmt(tasks[team]?.result?.percent)}%)`),
          renderTable(tasks[team], { values: entry[team] || {}, verdicts: tasks[team]?.result?.cells || {} }).el))));
      }
    }
    if (controls.length) parts.push(h("div", { class: "btn-row" }, ...controls));
    if (reviewing && !confirmed()) parts.push(reviewPanel());
    body.replaceChildren(...parts);
  }
  paint();

  // Ввод ведущим мог быть начат раньше (перезагрузка страницы): значения и режим берём из документа.
  if (hostEntryAvailable && typeof api.loadEntry === "function" && !entryLoaded) {
    entryLoaded = true;
    Promise.resolve(api.loadEntry()).then((saved) => {
      if (!saved || saved.mode !== ENTRY_MODE.HOST) return;
      entry = { mode: ENTRY_MODE.HOST, a: saved.a || {}, b: saved.b || {} };
      board = null; boardSig = null; lastSig = null;
      paint();
    }).catch(() => {});
  }

  return {
    el,
    update({ tasks: t, submissions }) {
      tasks = t || {}; subs = submissions || {};
      if (confirmed()) reviewing = false;
      // Идёт ввод на доске: перерисовываем только при смене статуса/режима,
      // иначе очередной снимок Firestore сбил бы фокус в поле.
      const sig = JSON.stringify([TEAMS.map(x => tasks[x]?.status), confirmed(), reviewing, hostMode()]);
      if (hostMode() && board && sig === lastSig && !busy) return;
      lastSig = sig;
      paint();
    },
    destroy() { clearTimeout(saveTimer); }
  };
}
