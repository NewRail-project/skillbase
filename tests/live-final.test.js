// tests/live-final.test.js — единый итоговый экран Live с вкладками:
// состав вкладок, переключение без пересборки, сохранение состояния,
// пустые данные, доступ по ролям (статический анализ страницы) и
// правильное отображение данных компонентов.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- Фейковый DOM (в стиле tests/dom.test.js, но с append) ----------

function makeElement(tag) {
  const el = {
    tag,
    attrs: {},
    children: [],
    dataset: {},
    style: {},
    textContent: "",
    listeners: {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] ?? null; },
    appendChild(child) { this.children.push(child); return child; },
    append(...nodes) { for (const n of nodes) this.appendChild(n); },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    classList: {
      toggle() {}, add() {}, remove() {}
    }
  };
  return el;
}

globalThis.document = {
  createElement: makeElement,
  createElementNS: (ns, tag) => makeElement(tag),
  createTextNode: text => ({ text })
};

const {
  overviewPanel, studentsPanel, reportSection, reportPanel,
  recommendationsPanel, journalPanel
} = await import("../ui/components/live-report.js");
const { gradeRoster, journalRows, GRADE_STATUS } = await import("../core/pair-grade.js");
const { buildLiveReport } = await import("../core/live-report.js");

// ---------- Данные ----------

const keys = Array.from({ length: 3 }, () => ({ type: "single", points: 1, correct: [0] }));
const questions = [
  { text: "Вопрос 1", topic: "Тема A" },
  { text: "Вопрос 2", topic: "Тема B" },
  { text: "Вопрос 3", topic: "Тема A" }
];
const input = {
  keysByPos: keys,
  questions,
  positions: [0, 1, 2],
  players: [
    { uid: "a", name: "Анна", answers: { 0: 0, 1: 0, 2: 1 } },
    { uid: "b", name: "Борис", answers: {} },
    { uid: "o", name: "Смотрящий", answers: { 0: 0 }, observer: true }
  ]
};
const grades = gradeRoster(input);
const report = buildLiveReport(input);

// ---------- Обзор ----------

test("обзор: показывает все требуемые поля, наблюдатели отдельно", () => {
  const panel = overviewPanel({
    title: "Тест по теме",
    subject: "История",
    topic: "Древний мир",
    finishedLabel: "14.11.2026, 10:00",
    participants: 2,
    observers: 1,
    group: report.group,
    verdict: report.verdict
  });
  const text = JSON.stringify(panel);
  assert.ok(text.includes("Тест по теме"));
  assert.ok(text.includes("История · Древний мир"));
  assert.ok(text.includes("14.11.2026, 10:00"));
  assert.ok(text.includes("Участники"));
  assert.ok(text.includes("Наблюдатели"));
  assert.ok(text.includes("Готовность группы"));
  assert.ok(text.includes("Сводка"));
});

test("обзор: без данных — честные прочерки, не выдуманные значения", () => {
  const panel = overviewPanel({});
  const text = JSON.stringify(panel);
  assert.ok(text.includes("не указаны"));
  assert.ok(text.includes("—"));
});

// ---------- Статистика и блоки отчёта ----------

test("статистика: секция собирается из существующих блоков отчёта", () => {
  const stats = reportSection(report, { title: "Статистика", sections: ["group", "questions"] });
  const text = JSON.stringify(stats);
  assert.ok(text.includes("Общая статистика группы"));
  assert.ok(text.includes("Анализ каждого вопроса"));
  assert.ok(!text.includes("Рекомендации"), "блок рекомендаций не входит в статистику");
  assert.ok(!text.includes("Анализ учеников"), "блок учеников не входит в статистику");
});

test("reportPanel: без sections ведёт себя как раньше (все блоки)", () => {
  const details = reportPanel(report);
  const text = JSON.stringify(details);
  for (const marker of ["Общая статистика группы", "Анализ каждого вопроса",
    "Анализ учеников", "Готовность группы по темам", "Рекомендации"]) {
    assert.ok(text.includes(marker), marker);
  }
});

// ---------- Участники ----------

test("участники: у каждого ФИО, верно/ошибки/пропуски, процент и оценка", () => {
  const panel = studentsPanel(report, grades);
  const text = JSON.stringify(panel);
  assert.ok(text.includes("Анна"));
  assert.ok(text.includes("Борис"));
  assert.ok(!text.includes("Смотрящий"), "наблюдатель не попадает в список участников");
  assert.ok(text.includes("верно"));
  assert.ok(text.includes("пропусков"));
  assert.ok(text.includes("оценка"));
});

test("участники: детализация по вопросам — верно/неверно/пропуск на вопрос", () => {
  const panel = studentsPanel(report, grades);
  const text = JSON.stringify(panel);
  assert.ok(text.includes("В1"));
  assert.ok(text.includes("верно"));
  assert.ok(text.includes("неверно"));
  assert.ok(text.includes("пропуск"));
});

test("участники: пустой отчёт — понятное состояние", () => {
  const empty = studentsPanel({ students: [] }, []);
  assert.ok(JSON.stringify(empty).includes("Пока нет участников."));
});

// ---------- Рекомендации ----------

test("рекомендации: только выводы по реальным данным", () => {
  const panel = recommendationsPanel(report);
  const text = JSON.stringify(panel);
  assert.ok(text.includes("Рекомендации"));
  assert.ok(text.includes("Вывод"));
});

test("рекомендации: данных недостаточно — понятный текст, не выдумка", () => {
  // Пустой список рекомендаций возможен, если отчёт передан без данных:
  // панель показывает честное состояние, а не придуманные выводы.
  const panel = recommendationsPanel({ recommendations: [], verdict: null });
  assert.ok(JSON.stringify(panel).includes("Данных пока недостаточно"));
});

// ---------- Журнал (вкладка на базе этапа 4) ----------

test("журнал: вкладка показывает только фактических участников по алфавиту", () => {
  const journal = journalRows(grades);
  assert.deepStrictEqual(journal.map(r => r.name), ["Анна", "Борис"]);
  const zero = journal.find(r => r.status === GRADE_STATUS.ZERO);
  assert.equal(zero.grade, 0);
  const panel = journalPanel(journal, { grades });
  assert.ok(JSON.stringify(panel).includes("Оценки для журнала"));
});

// ---------- Страница: вкладки и состояние (статический анализ) ----------

const roomPage = readFileSync(join(ROOT, "ui/pages/room.js"), "utf8");

test("итоговый экран: шесть вкладок без отдельных страниц", () => {
  const tabs = [...roomPage.matchAll(/\{ id: "([a-z]+)", label: "([^"]+)" \}/g)].map(m => m.slice(1, 3));
  assert.deepStrictEqual(tabs, [
    ["overview", "Обзор"],
    ["rating", "Рейтинг"],
    ["stats", "Статистика"],
    ["students", "Участники"],
    ["journal", "Журнал"],
    ["recs", "Рекомендации"]
  ]);
  // Вкладки — это узлы одного экрана, а не маршруты.
  assert.match(roomPage, /role: "tablist"/);
  assert.match(roomPage, /role: "tabpanel"/);
});

test("переключение вкладки не пересобирает панель и не сбрасывает данные", () => {
  // Клик по вкладке меняет только активную вкладку и перерисовывает кэш.
  assert.match(roomPage, /onclick: \(\) => \{ finalTab = t\.id; renderFinalTab\(\); \}/);
  // renderFinalTab берёт панель из кэша; пересборка — только при отсутствии.
  assert.match(roomPage, /let pane = finalTabPanes\.get\(finalTab\);/);
  assert.match(roomPage, /if \(!pane\) \{[\s\S]{0,200}buildFinalPane\(finalTab, finalData\(\)\);[\s\S]{0,60}finalTabPanes\.set\(finalTab, pane\);/);
  // Смена вкладки не трогает подпись данных: пересборка не запускается.
  const renderBody = roomPage.match(/function renderFinalTab\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(!/finalDockSig/.test(renderBody), "renderFinalTab не пересчитывает данные");
  assert.match(roomPage, /paneHost\.replaceChildren\(pane\);/);
});

test("данные пересчитываются по подписи, включая дуэли и предмет/тему", () => {
  const sigBody = roomPage.match(/const sig = \[[\s\S]*?\]\.join\("#"\);/)?.[0] || "";
  assert.match(sigBody, /duelSig\(\)/, "изменение дуэлей обновляет панель «Рейтинг»");
  assert.match(sigBody, /finalMeta\.subject/);
  assert.match(sigBody, /finalMeta\.topic/);
  // Кэш панелей сбрасывается только при реальном изменении данных.
  assert.match(roomPage, /if \(sig !== finalDockSig\) \{[\s\S]{0,200}finalTabPanes\.clear\(\);/);
});

test("доступ по ролям: итоговый экран только у ведущего", () => {
  // finalDockNode используется в виде ведущего и не встречается
  // в видах участника/наблюдателя — чужие персональные данные не
  // показываются без соответствующих прав.
  const idxPlayer = roomPage.indexOf("function autoPlayerView");
  const idxObserver = roomPage.indexOf("function autoObserverView");
  assert.ok(idxPlayer > 0 && idxObserver > 0, "виды участника и наблюдателя найдены");
  for (const [name, start] of [["autoPlayerView", idxPlayer], ["autoObserverView", idxObserver]]) {
    const end = roomPage.indexOf("\nfunction ", start + 10);
    const body = roomPage.slice(start, end);
    assert.ok(!body.includes("finalDockNode"), `${name} не содержит итоговый отчёт`);
  }
  const completedBranch = roomPage.match(/\/\/ completed \/ closed\.[\s\S]*?finalDockNode\(\)/)?.[0] || "";
  assert.match(completedBranch, /finalDockNode\(\)/);
  assert.match(roomPage, /role\(\) !== "host"\) return null;\s*\n\s*const doc = local\.duels;/);
  // Rules не менялись ради отчёта: у duels те же ограничения.
  const rules = readFileSync(join(ROOT, "firestore.rules"), "utf8");
  assert.match(rules, /match \/duels\/\{docId\}/);
  assert.match(rules, /allow create, update: if isRoomHost\(\)\s*\n\s*&& request\.resource\.data\.key == docId/);
});

test("активная вкладка переживает перерисовку вида", () => {
  assert.match(roomPage, /let finalTab = "overview";/);
  assert.match(roomPage, /finalTabPanes = new Map\(\);/);
  // reset() очищает кэш между сессиями, но не при перерисовке вида.
  assert.match(roomPage, /finalTabPanes\.clear\(\);[\s\S]{0,80}finalMeta = \{ subject: "", topic: "" \};/);
});
