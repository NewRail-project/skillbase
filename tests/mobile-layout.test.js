// tests/mobile-layout.test.js — первопричины мобильной вёрстки (ТЗ §3) и
// данные графика «Динамика результатов» (ТЗ §9). Реальные ширины 320–768 px
// проверяются в браузере скриптом tools/layout-check.py; здесь — то, что
// можно закрепить без браузера.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFakeDom, findAll, text } from "./helpers/fake-dom.js";
import { recentResultPoints } from "../core/progress.js";

installFakeDom();
const css = readFileSync(new URL("../ui/css/components.css", import.meta.url), "utf8");
const { labelTable, labelAll } = await import("../ui/components/responsive-table.js");

// Все правила файла с их условием @media (упрощённо: один уровень вложенности).
function rules(source) {
  const out = [];
  const re = /(@media[^{]+)\{|([^{}@]+)\{([^{}]*)\}|\}/g;
  let media = null, depth = 0, m;
  while ((m = re.exec(source))) {
    if (m[1]) { media = m[1].trim(); depth = 1; }
    else if (m[2]) out.push({ media: depth ? media : null, selector: m[2].trim(), body: m[3] });
    else if (depth) { depth = 0; media = null; }
  }
  return out;
}
const R = rules(css);
const find = (sel, media = undefined) => R.filter((r) => r.selector.split(",").map((s) => s.trim()).includes(sel) && (media === undefined || r.media === media));

test("строка списка переносится на любой ширине: nowrap не возвращается", () => {
  const nowrap = R.filter((r) => /\.list-row\b/.test(r.selector) && !/\.list-row-/.test(r.selector) && /flex-wrap:\s*nowrap/.test(r.body) && !/topic-actions/.test(r.selector));
  assert.deepEqual(nowrap.map((r) => r.selector), [], "правило .list-row { flex-wrap: nowrap } сжимало названия до одной буквы");
  assert.ok(find(".list-row").some((r) => /flex-wrap:\s*wrap/.test(r.body)));
});

test("название получает минимальную базу, блок кнопок сжимается и переносится", () => {
  assert.ok(R.some((r) => r.selector === ".list-row > .list-row-main" && /flex:\s*1 1 12rem/.test(r.body)));
  const end = find(".list-row-end").map((r) => r.body).join(" ");
  assert.match(end, /flex:\s*0 1 auto/, "раньше было flex: none — блок кнопок не сжимался и выталкивал название");
  assert.match(end, /min-width:\s*0/);
});

test("цепочка контейнеров может сжиматься (min-width: 0)", () => {
  const chain = R.find((r) => r.selector.includes(".panel") && r.selector.includes(".list-row-main") && /min-width:\s*0/.test(r.body));
  assert.ok(chain, "без min-width: 0 flex/grid-дети не уже содержимого — отсюда прокрутка страницы");
});

test("таблицы на телефоне — карточки: подписи из data-label, кнопка не сжимается", () => {
  const mobile = css.slice(css.indexOf("Таблицы-карточки"));
  assert.match(mobile, /\.analytics-table td::before[\s\S]*content:\s*attr\(data-label\)/);
  assert.match(css, /td \.btn[^{]*\{[^}]*white-space:\s*nowrap/, "«Отчёт» не должен переноситься по буквам");
});

test("шапка на узком экране: знак вместо надписи, «Назад» — стрелка", () => {
  assert.ok(R.some((r) => r.media === "@media (max-width: 640px)" && /\.back-button \.back-text/.test(r.selector) && /display:\s*none/.test(r.body)));
  assert.ok(R.some((r) => r.media === "@media (max-width: 640px)" && /brand-text/.test(r.selector) && /display:\s*none/.test(r.body)));
});

test("подписи колонок: data-label ставится по заголовку, без перезаписи", () => {
  const doc = globalThis.document;
  const table = doc.createElement("table");
  table.className = "analytics-table";
  const mk = (tag, cells) => { const tr = doc.createElement("tr"); cells.forEach((c) => { const el = doc.createElement(tag); el.textContent = c; tr.appendChild(el); }); return tr; };
  const thead = doc.createElement("thead"); thead.appendChild(mk("th", ["ФИО", "Средний балл", "Попыток", ""]));
  const tbody = doc.createElement("tbody");
  const row = mk("td", ["Иванов", "—", "0", ""]);
  row.children[1].setAttribute("data-label", "Свой");
  tbody.appendChild(row);
  table.append(thead, tbody);
  const n = labelTable(table);
  assert.equal(row.children[0].getAttribute("data-label"), "ФИО");
  assert.equal(row.children[1].getAttribute("data-label"), "Свой", "готовая подпись сохранена");
  assert.equal(row.children[2].getAttribute("data-label"), "Попыток");
  assert.equal(row.children[3].getAttribute("data-label"), null, "у пустого заголовка подписи нет");
  assert.equal(n, 2);
});

// ---------- Динамика результатов ----------

test("график: только проверенные попытки, хронологически, не больше limit", () => {
  const att = [
    { status: "graded", percent: 80, finishedAt: 3000 },
    { status: "in_progress", percent: 99, finishedAt: 9000 },
    { status: "graded", score: 1, total: 2, finishedAt: 1000 },
    { status: "graded", total: 0, score: 0, finishedAt: 2000 },     // нет процента — не точка
    { status: "graded", percent: 120, finishedAt: 4000 },            // выход за 100 ограничивается
    null
  ];
  const pts = recentResultPoints(att, 8);
  assert.deepEqual(pts.map((p) => p.value), [50, 80, 100]);
  assert.deepEqual(pts.map((p) => p.ms), [1000, 3000, 4000]);
  assert.equal(recentResultPoints(att, 2).length, 2);
  assert.deepEqual(recentResultPoints(att, 2).map((p) => p.value), [80, 100], "берутся последние");
});

test("график: пустые и непроверенные данные дают пустой ряд, а не ложный ноль", () => {
  assert.deepEqual(recentResultPoints([], 8), []);
  assert.deepEqual(recentResultPoints(undefined, 8), []);
  assert.deepEqual(recentResultPoints([{ status: "in_progress", percent: 50 }, { status: "graded" }], 8), []);
});

test("график: время из Firestore Timestamp и ISO упорядочивается верно", () => {
  const pts = recentResultPoints([
    { status: "graded", percent: 60, finishedAt: { toMillis: () => 2000 } },
    { status: "graded", percent: 70, finishedAt: { seconds: 1 } },
    { status: "graded", percent: 90, finishedAt: "1970-01-01T00:00:03.000Z" }
  ], 8);
  assert.deepEqual(pts.map((p) => p.value), [70, 60, 90]);
});
