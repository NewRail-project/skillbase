// ui/components/practical-editor.js — редактор таблицы-задания практической
// диагностики (для одной команды). Преподаватель сам задаёт заголовки столбцов,
// строки, готовые тексты ячеек и ячейки для ответа с ожидаемыми ответами.
//
// Ожидаемые ответы живут только в редакторе плана (закрытый документ
// сотрудников). Участникам уходит публичная копия без них (core/practical.js).
import { h } from "../../shared/dom.js";
import { normalizeTask, MODES, MODE_LABEL, LIMITS } from "../../core/practical.js";

const KIND_LABEL = { label: "Готовый текст", answer: "Поле для ответа" };

function input(value, attrs = {}) {
  const el = h("input", { type: "text", ...attrs });
  el.value = value ?? "";
  return el;
}

// buildPracticalEditor({ team: "a"|"b", task, onChange })
// getTask() всегда отдаёт нормализованную структуру; редактор ничего не сохраняет сам.
export function buildPracticalEditor({ team = "a", task = null, onChange = () => {} } = {}) {
  let state = normalizeTask(task);
  const teamName = team === "a" ? "А" : "Б";
  const idp = `pe-${team}`;

  const title = input(state.title, { id: `${idp}-title`, maxlength: String(LIMITS.maxTitle) });
  const desc = h("textarea", { id: `${idp}-desc`, rows: "3", maxlength: String(LIMITS.maxDescription) });
  desc.value = state.description;
  const colsBox = h("div", { class: "pe-cols", role: "group", "aria-label": `Заголовки столбцов, команда ${teamName}` });
  const rowsBox = h("div", { class: "pe-rows" });
  let refreshModeBtn = () => {};
  const emit = () => { refreshModeBtn(); onChange(normalizeTask(state)); };

  title.addEventListener("input", () => { state.title = title.value; emit(); });
  desc.addEventListener("input", () => { state.description = desc.value; emit(); });

  function paintCols() {
    colsBox.replaceChildren(
      ...state.columns.map((text, c) => {
        const inp = input(text, { "aria-label": `Заголовок столбца ${c + 1}`, maxlength: String(LIMITS.maxCell) });
        inp.addEventListener("input", () => { state.columns[c] = inp.value; emit(); });
        const del = h("button", {
          type: "button", class: "btn secondary btn-sm", "aria-label": `Удалить столбец ${c + 1}`,
          disabled: state.columns.length <= 1,
          onclick: () => { state.columns.splice(c, 1); state.rows.forEach(r => r.splice(c, 1)); repaint(); emit(); }
        }, "✕");
        return h("div", { class: "pe-col" }, inp, del);
      }),
      h("button", {
        type: "button", class: "btn secondary btn-sm", disabled: state.columns.length >= LIMITS.maxCols,
        onclick: () => {
          state.columns.push(`Столбец ${state.columns.length + 1}`);
          state.rows.forEach(r => r.push({ t: "answer", mode: "text", accept: [], points: 1 }));
          repaint(); emit();
        }
      }, "＋ Столбец"));
  }

  function cellEditor(r, c) {
    const cell = state.rows[r][c];
    const kind = h("select", { "aria-label": `Строка ${r + 1}, столбец ${c + 1}: тип ячейки` },
      ...Object.entries(KIND_LABEL).map(([v, l]) => h("option", { value: v, selected: v === cell.t }, l)));
    kind.addEventListener("change", () => {
      state.rows[r][c] = kind.value === "answer"
        ? { t: "answer", mode: "text", accept: [], points: 1 } : { t: "label", text: "" };
      repaintRows(); emit();
    });
    const head = h("div", { class: "pe-cell-head" }, h("span", { class: "pe-cell-col" }, state.columns[c] || `Столбец ${c + 1}`), kind);
    if (cell.t === "label") {
      const text = input(cell.text, { "aria-label": `Строка ${r + 1}, столбец ${c + 1}: текст`, maxlength: String(LIMITS.maxCell) });
      text.addEventListener("input", () => { cell.text = text.value; emit(); });
      return h("div", { class: "pe-cell", "data-kind": "label" }, head, text);
    }
    const mode = h("select", { "aria-label": `Строка ${r + 1}, столбец ${c + 1}: способ проверки` },
      ...MODES.map(m => h("option", { value: m, selected: m === cell.mode }, MODE_LABEL[m])));
    mode.addEventListener("change", () => { cell.mode = mode.value; repaintRows(); emit(); });
    const body = [head, h("label", { class: "pe-mini" }, "Способ проверки", mode)];
    if (cell.mode !== "manual") {
      const accept = input((cell.accept || []).join("; "), {
        "aria-label": `Строка ${r + 1}, столбец ${c + 1}: ожидаемые ответы`,
        placeholder: "Ожидаемый ответ; другой допустимый ответ"
      });
      accept.addEventListener("input", () => { cell.accept = accept.value.split(";").map(x => x.trim()).filter(Boolean); emit(); });
      body.push(h("label", { class: "pe-mini" }, "Ожидаемые ответы (через «;»)", accept));
    } else {
      body.push(h("p", { class: "form-hint" }, "Ответ проверит преподаватель вручную."));
    }
    if (cell.mode === "number") {
      const tol = input(cell.tolerance ?? "", { inputmode: "decimal", "aria-label": `Строка ${r + 1}, столбец ${c + 1}: допуск` });
      tol.addEventListener("input", () => { const n = Number(String(tol.value).replace(",", ".")); cell.tolerance = Number.isFinite(n) && n > 0 ? n : undefined; emit(); });
      const unit = input(cell.unit ?? "", { "aria-label": `Строка ${r + 1}, столбец ${c + 1}: единица измерения`, maxlength: "20" });
      unit.addEventListener("input", () => { cell.unit = unit.value; emit(); });
      body.push(h("div", { class: "pe-pair" },
        h("label", { class: "pe-mini" }, "Допуск ±", tol), h("label", { class: "pe-mini" }, "Единица", unit)));
    }
    return h("div", { class: "pe-cell", "data-kind": "answer" }, ...body);
  }

  function repaintRows() {
    rowsBox.replaceChildren(
      ...state.rows.map((row, r) => h("fieldset", { class: "pe-row" },
        h("legend", {}, `Строка ${r + 1}`),
        ...row.map((_, c) => cellEditor(r, c)),
        h("button", {
          type: "button", class: "btn secondary btn-sm", disabled: state.rows.length <= 1,
          onclick: () => { state.rows.splice(r, 1); repaintRows(); emit(); }
        }, "Удалить строку"))),
      h("button", {
        type: "button", class: "btn secondary", disabled: state.rows.length >= LIMITS.maxRows,
        onclick: () => {
          state.rows.push(state.columns.map((_, c) => (c === 0 ? { t: "label", text: "" } : { t: "answer", mode: "text", accept: [], points: 1 })));
          repaintRows(); emit();
        }
      }, "＋ Строка"));
  }
  function repaint() { paintCols(); repaintRows(); }
  repaint();

  // ---------- Простой режим: «как обычный вопрос» ----------
  // Столбец с названием и столбец с ответом (число, слово или фраза). Без
  // выбора типа ячеек и числа столбцов — именно так таблицу и нужно
  // заполнять в большинстве занятий. Модель данных та же.
  const isSimple = (t) => t.columns.length === 2
    && t.rows.every(r => r.length === 2 && r[0].t === "label" && r[1].t === "answer");
  let mode = isSimple(state) ? "simple" : "advanced";

  const SIMPLE_TYPES = { text: "Слово или фраза", number: "Число", manual: "Проверю сам" };
  const headLabel = input(state.columns[0], { id: `${idp}-h0`, maxlength: String(LIMITS.maxCell) });
  const headAnswer = input(state.columns[1] || "", { id: `${idp}-h1`, maxlength: String(LIMITS.maxCell) });
  headLabel.addEventListener("input", () => { state.columns[0] = headLabel.value; emit(); });
  headAnswer.addEventListener("input", () => { state.columns[1] = headAnswer.value; emit(); });
  const simpleRows = h("div", { class: "pe-simple-rows" });

  function paintSimple() {
    headLabel.value = state.columns[0] ?? "";
    headAnswer.value = state.columns[1] ?? "";
    simpleRows.replaceChildren(
      ...state.rows.map((row, r) => {
        const label = row[0];
        const ans = row[1];
        const name = input(label.text, { "aria-label": `Строка ${r + 1}: название`, placeholder: "Название (например, «Номер датчика»)", maxlength: String(LIMITS.maxCell) });
        name.addEventListener("input", () => { label.text = name.value; emit(); });
        const type = h("select", { "aria-label": `Строка ${r + 1}: тип ответа` },
          ...Object.entries(SIMPLE_TYPES).map(([v, l]) => h("option", { value: v, selected: v === ans.mode }, l)));
        type.addEventListener("change", () => { ans.mode = type.value; if (ans.mode === "manual") ans.accept = []; paintSimple(); emit(); });
        const parts = [h("label", { class: "pe-mini" }, "Название", name), h("label", { class: "pe-mini" }, "Тип ответа", type)];
        if (ans.mode !== "manual") {
          const expected = input((ans.accept || []).join("; "), {
            "aria-label": `Строка ${r + 1}: правильный ответ`,
            placeholder: ans.mode === "number" ? "Число, например 12,5" : "Слово или фраза; другой допустимый вариант"
          });
          expected.addEventListener("input", () => { ans.accept = expected.value.split(";").map(x => x.trim()).filter(Boolean); emit(); });
          parts.push(h("label", { class: "pe-mini" }, ans.mode === "number" ? "Правильный ответ (число)" : "Правильный ответ (варианты через «;»)", expected));
        } else {
          parts.push(h("p", { class: "form-hint" }, "Ответ проверите вы сами при подведении итогов."));
        }
        if (ans.mode === "number") {
          const tol = input(ans.tolerance ?? "", { inputmode: "decimal", "aria-label": `Строка ${r + 1}: допуск` });
          tol.addEventListener("input", () => { const n = Number(String(tol.value).replace(",", ".")); ans.tolerance = Number.isFinite(n) && n > 0 ? n : undefined; emit(); });
          const unit = input(ans.unit ?? "", { "aria-label": `Строка ${r + 1}: единица измерения`, maxlength: "20", placeholder: "В, А, мм…" });
          unit.addEventListener("input", () => { ans.unit = unit.value; emit(); });
          parts.push(h("div", { class: "pe-pair" }, h("label", { class: "pe-mini" }, "Допуск ± (необязательно)", tol), h("label", { class: "pe-mini" }, "Единица (необязательно)", unit)));
        }
        const del = h("button", {
          type: "button", class: "btn secondary btn-sm", disabled: state.rows.length <= 1, "aria-label": `Удалить строку ${r + 1}`,
          onclick: () => { state.rows.splice(r, 1); paintSimple(); emit(); }
        }, "Удалить строку");
        return h("fieldset", { class: "pe-row pe-simple-row" }, h("legend", {}, `Строка ${r + 1}`), ...parts, del);
      }),
      h("button", {
        type: "button", class: "btn secondary", disabled: state.rows.length >= LIMITS.maxRows,
        onclick: () => { state.rows.push([{ t: "label", text: "" }, { t: "answer", mode: "text", accept: [], points: 1 }]); paintSimple(); emit(); }
      }, "＋ Строка"));
  }

  const simpleBox = h("div", { class: "pe-simple" },
    h("div", { class: "pe-pair" },
      h("label", { class: "pe-mini", for: `${idp}-h0` }, "Заголовок столбца с названием", headLabel),
      h("label", { class: "pe-mini", for: `${idp}-h1` }, "Заголовок столбца с ответом", headAnswer)),
    simpleRows);
  const advancedBox = h("div", { class: "pe-advanced" },
    h("div", { class: "pe-field" }, h("b", {}, "Столбцы"), colsBox),
    h("div", { class: "pe-field" }, h("b", {}, "Строки"), rowsBox));
  const modeBtn = h("button", { type: "button", class: "btn secondary btn-sm", "data-action": "mode" }, "");
  const modeHint = h("p", { class: "form-hint", role: "status" }, "");

  // Кнопка режима и подсказка пересчитываются при любой правке: удалили лишний
  // столбец — вернуться к простому виду сразу можно.
  refreshModeBtn = () => {
    const canSimple = isSimple(normalizeTask(state));
    modeBtn.textContent = mode === "simple" ? "Расширенная таблица (несколько столбцов)" : "Вернуться к простой таблице";
    modeBtn.disabled = mode === "advanced" && !canSimple;
    modeHint.textContent = mode === "advanced" && !canSimple
      ? "В таблице больше двух столбцов или особые ячейки: простой вид недоступен." : "";
  };
  function applyMode() {
    simpleBox.hidden = mode !== "simple";
    advancedBox.hidden = mode !== "advanced";
    if (mode === "simple") paintSimple(); else repaint();
    refreshModeBtn();
  }
  modeBtn.addEventListener("click", () => { mode = mode === "simple" ? "advanced" : "simple"; applyMode(); });

  const el = h("section", { class: "pe", "aria-label": `Задание команды ${teamName}` },
    h("h3", {}, `Задание команды ${teamName}`),
    h("label", { class: "pe-field", for: `${idp}-title` }, "Название задания", title),
    h("label", { class: "pe-field", for: `${idp}-desc` }, "Описание", desc),
    simpleBox, advancedBox,
    h("div", { class: "btn-row" }, modeBtn), modeHint);
  applyMode();

  return {
    el,
    getTask: () => normalizeTask(state),
    setTask(next) {
      state = normalizeTask(next);
      title.value = state.title; desc.value = state.description;
      mode = isSimple(state) ? "simple" : "advanced";
      applyMode();
    }
  };
}
