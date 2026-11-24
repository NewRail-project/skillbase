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
  const emit = () => onChange(normalizeTask(state));

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

  const el = h("section", { class: "pe", "aria-label": `Задание команды ${teamName}` },
    h("h3", {}, `Задание команды ${teamName}`),
    h("label", { class: "pe-field", for: `${idp}-title` }, "Название задания", title),
    h("label", { class: "pe-field", for: `${idp}-desc` }, "Описание", desc),
    h("div", { class: "pe-field" }, h("b", {}, "Столбцы"), colsBox),
    h("div", { class: "pe-field" }, h("b", {}, "Строки"), rowsBox));

  return {
    el,
    getTask: () => normalizeTask(state),
    setTask(next) {
      state = normalizeTask(next);
      title.value = state.title; desc.value = state.description; repaint();
    }
  };
}
