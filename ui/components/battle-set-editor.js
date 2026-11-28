// ui/components/battle-set-editor.js — блок редактора теста «Вопросы для Battle
// и ничьих»: основные вопросы Battle и дополнительные вопросы для 1-го, 2-го и
// 3-го места. Формат ввода — тот же, что у основных вопросов теста.
// Данные хранятся вместе с тестом (core/battle-set-store.js); во время
// мероприятия ничего вставлять вручную не нужно.
import { h } from "../../shared/dom.js";
import {
  PLACES, MAX_MAIN, MAX_PER_PLACE, emptyBattleSet, normalizeBattleSet,
  parseBattleText, questionsToText, validateBattleSet, countMain, countForPlace
} from "../../core/battle-set.js";
import { buildPracticalEditor } from "./practical-editor.js";

const EXAMPLE = `1. Какой сигнал разрешает движение?
A) Красный
B) Зелёный [+]
C) Жёлтый`;

const PLACE_TEXT = {
  1: "Ничья за 1-е место",
  2: "Ничья за 2-е место",
  3: "Ничья за 3-е место"
};

// buildBattleSetEditor(initial) → { el, getSet(), errors(), setSet(set), isDirty() }
export function buildBattleSetEditor(initial = emptyBattleSet()) {
  let loaded = normalizeBattleSet(initial);
  let dirty = false;

  const summary = h("summary", {}, "Вопросы для Battle и ничьих");
  const sections = {};

  function section({ key, title, hint, max }) {
    const area = h("textarea", { rows: "7", spellcheck: "false", placeholder: EXAMPLE, "aria-label": title });
    const status = h("div", { class: "form-hint", role: "status" });
    const box = h("div", { class: "field battle-set-section", "data-set": String(key) },
      h("label", {}, title), hint ? h("span", { class: "form-hint" }, hint) : null, area, status);
    sections[key] = { area, status, max };
    area.addEventListener("input", () => { dirty = true; paint(key); paintSummary(); });
    return box;
  }

  // Основные вопросы + параметры проведения.
  const mainBox = section({
    key: "main",
    title: "Основные вопросы Battle",
    hint: "Свой банк вопросов для командной битвы. Если оставить пустым, Battle берёт вопросы самого теста, как раньше.",
    max: MAX_MAIN
  });
  const countInput = h("input", { type: "number", min: "1", max: String(MAX_MAIN), inputmode: "numeric", placeholder: "Все" });
  const orderSelect = h("select", {},
    h("option", { value: "set" }, "По порядку списка"),
    h("option", { value: "random" }, "В случайном порядке"));
  const secondsInput = h("input", { type: "number", min: "5", max: "600", inputmode: "numeric", placeholder: "По умолчанию" });
  for (const el of [countInput, orderSelect, secondsInput]) el.addEventListener("input", () => { dirty = true; });
  const params = h("div", { class: "battle-set-params" },
    h("div", { class: "field" }, h("label", {}, "Сколько вопросов провести"), countInput),
    h("div", { class: "field" }, h("label", {}, "Порядок"), orderSelect),
    h("div", { class: "field" }, h("label", {}, "Секунд на вопрос"), secondsInput));

  const tieBoxes = PLACES.map((p) => section({
    key: p,
    title: PLACE_TEXT[p],
    hint: p === 1
      ? "Используются при ничьей за 1-е место — и в итоговом рейтинге Live, и между командами Battle. Добавьте несколько: если одного мало, ведущий проведёт следующий."
      : "Используются при ничьей участников за это место в итоговом рейтинге Live. Добавьте несколько вопросов — если одного мало, ведущий проведёт следующий.",
    max: MAX_PER_PLACE
  }));

  // ---------- Таблица после Battle ----------
  // Названия столбцов, подписи строк и верные значения задаются здесь, заранее.
  // В комнате команда вводит только значения; ведущий проверяет по ключам.
  const tableOn = h("input", { type: "checkbox", id: "battle-table-on" });
  const tableA = buildPracticalEditor({ team: "a", task: loaded.tables.a, onChange: () => { dirty = true; paintSummary(); } });
  const tableB = buildPracticalEditor({ team: "b", task: loaded.tables.b, onChange: () => { dirty = true; paintSummary(); } });
  const copyBtn = h("button", { type: "button", class: "btn secondary btn-sm" }, "Скопировать таблицу команды А в команду Б");
  copyBtn.addEventListener("click", () => { tableB.setTask(tableA.getTask()); dirty = true; paintSummary(); });
  const tableStatus = h("div", { class: "form-hint", role: "status" });
  const tableFields = h("div", { class: "battle-set-tables-body", hidden: "hidden" },
    h("p", { class: "form-hint" },
      "Таблица появится у каждой команды после Battle: названия столбцов и строк останутся, команда вводит только значения и нажимает «Проверить». Баллы за верные ячейки прибавляются к счёту команды. Верные ответы видны только вам."),
    tableA.el, tableB.el, h("div", { class: "btn-row" }, copyBtn), tableStatus);
  const tableBox = h("div", { class: "field battle-set-tables", "data-set": "tables" },
    h("label", { for: "battle-table-on" }, tableOn, " Таблица после Battle (по одной на команду)"),
    tableFields);
  const syncTables = () => {
    tableFields.hidden = !tableOn.checked;
    tableStatus.textContent = "";
  };
  tableOn.addEventListener("change", () => { dirty = true; syncTables(); paintSummary(); });

  const el = h("details", { class: "panel battle-set-editor", id: "battle-set-editor" },
    summary,
    h("p", { class: "form-hint" },
      "Подготовьте всё заранее: во время Live ничего копировать и вставлять не придётся. Правильный ответ отмечайте [+] или * в конце варианта; несколько отмеченных — вопрос с множественным выбором. Участники видят вопрос только когда он проводится, правильные ответы им не раскрываются до закрытия."),
    mainBox, params, ...tieBoxes, tableBox);

  function parsed(key) {
    return parseBattleText(sections[key].area.value);
  }

  function paint(key) {
    const { questions, errors } = parsed(key);
    const { status, max } = sections[key];
    const own = validateBattleSet(key === "main"
      ? { main: { questions }, placeTies: {} }
      : { placeTies: { [key]: questions } });
    const all = [...errors, ...own];
    status.className = all.length ? "form-error" : "form-hint";
    status.textContent = all.length
      ? all.slice(0, 4).join("\n")
      : questions.length ? `Распознано вопросов: ${questions.length} из ${max}.` : "Вопросов нет — этот сценарий не используется.";
  }

  function paintSummary() {
    const s = getSet();
    const tie = PLACES.map((p) => `${p}-е: ${s.placeTies[p].length}`).join(", ");
    summary.textContent = `Вопросы для Battle и ничьих — Battle: ${s.main.questions.length}; ${tie}${tableOn.checked ? "; таблица после Battle" : ""}`;
  }

  function getSet() {
    const set = emptyBattleSet();
    set.main.questions = parsed("main").questions;
    set.main.count = Number(countInput.value) > 0 ? Math.trunc(Number(countInput.value)) : null;
    set.main.order = orderSelect.value === "random" ? "random" : "set";
    set.main.questionSeconds = Number(secondsInput.value) > 0 ? Math.trunc(Number(secondsInput.value)) : null;
    for (const p of PLACES) set.placeTies[p] = parsed(p).questions;
    set.tables = tableOn.checked ? { a: tableA.getTask(), b: tableB.getTask() } : { a: null, b: null };
    return set;
  }

  // Все ошибки разбора и проверки — для блокировки сохранения.
  function errors() {
    const out = [];
    for (const key of ["main", ...PLACES]) {
      const { errors: e } = parsed(key);
      out.push(...e.map((m) => `${key === "main" ? "Battle" : PLACE_TEXT[key]}: ${m}`));
    }
    out.push(...validateBattleSet(getSet()));
    return [...new Set(out)];
  }

  function setSet(next) {
    loaded = normalizeBattleSet(next);
    sections.main.area.value = questionsToText(loaded.main.questions);
    countInput.value = loaded.main.count ?? "";
    orderSelect.value = loaded.main.order;
    secondsInput.value = loaded.main.questionSeconds ?? "";
    for (const p of PLACES) sections[p].area.value = questionsToText(loaded.placeTies[p]);
    tableOn.checked = Boolean(loaded.tables.a || loaded.tables.b);
    if (loaded.tables.a) tableA.setTask(loaded.tables.a);
    if (loaded.tables.b) tableB.setTask(loaded.tables.b);
    syncTables();
    for (const key of ["main", ...PLACES]) paint(key);
    paintSummary();
    dirty = false;
    // Открываем блок, если в нём уже что-то подготовлено.
    el.open = countMain(loaded) > 0 || PLACES.some((p) => countForPlace(loaded, p) > 0) || tableOn.checked;
  }

  setSet(loaded);
  return { el, getSet, errors, setSet, isDirty: () => dirty };
}
