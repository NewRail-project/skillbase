// tests/ui-regressions.test.js — поломки, найденные на реальном сайте
// (скриншоты): «materialLink is not defined», «Тест не найден» после чтения
// материала, слово «null» и буквы столбиком на странице дисциплины,
// сплошная заливка строк диаграмм, одинаковые иконки меню.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { icons } from "../shared/icons.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");

// Идентификаторы-функции, которые файл вызывает, но не объявляет и не импортирует.
function undeclaredCalls(src, names) {
  const importedBlock = [...src.matchAll(/import\s*\{([^}]*)\}\s*from/g)].map(m => m[1]).join(",");
  return names.filter(n => new RegExp(`\\b${n}\\(`).test(src)
    && !new RegExp(`\\b${n}\\b`).test(importedBlock)
    && !new RegExp(`function\\s+${n}\\b|const\\s+${n}\\b`).test(src));
}

test("страницы материалов и дисциплины импортируют всё, что вызывают (materialLink)", () => {
  for (const f of ["ui/pages/materials.js", "ui/pages/topic.js", "ui/pages/discipline-page.js"]) {
    assert.deepEqual(undeclaredCalls(read(f), ["materialLink", "materialProgressState"]), [], f);
  }
});

test("страница дисциплины: ссылки на материал и тест ведут на существующие маршруты", () => {
  const src = read("ui/pages/discipline-page.js");
  const app = read("shared/app.js");
  assert.match(src, /materialLink\(window\.location\.hash, m\.id\)/, "материал — с адресом возврата на дисциплину");
  assert.ok(!/`#material\/\$\{encode\(m\.id\)\}`/.test(src), "нет обязательного режима чтения по id материала");
  assert.match(src, /`#quiz\/\$\{encode\(t\.id\)\}`/);
  assert.ok(!/#test\//.test(src), "маршрута #test/ нет");
  assert.match(app, /"quiz":\s*\{/);
});

test("страница дисциплины: null-панели не попадают в DOM (иначе выводится слово «null»)", () => {
  const src = read("ui/pages/discipline-page.js");
  assert.match(src, /body\.replaceChildren\(\.\.\.\[[\s\S]*?\]\.filter\(Boolean\)\)/);
});

test("материал из дисциплины: после чтения возврат туда, откуда открыли (не на несуществующий тест)", async () => {
  const { materialLink, readerBackTarget, backLabel } = await import("../core/material-library-logic.js");
  const link = materialLink("#discipline/d1", "mat1");
  assert.equal(link, "#material/mat1/free/back:%23discipline%2Fd1");
  const parts = link.slice("#material/".length).split("/");
  const back = readerBackTarget(parts);
  assert.equal(back.hash, "#discipline/d1");
  assert.equal(backLabel(back.hash), "К дисциплине");
});

test("читалка: служебный маркер «#>>» в заголовке не показывается", () => {
  const src = read("ui/pages/material.js");
  assert.ok(src.includes('const headingText = (text) => String(text || "").replace(/^\\s*#+\\s*>*\\s*/, "").trim();'));
  assert.match(src, /h2", \{ class: "book-h" \}, headingText\(block\.text\)/);
  // То же регулярное выражение на реальных строках.
  const clean = text => String(text || "").replace(/^\s*#+\s*>*\s*/, "").trim();
  assert.equal(clean("#>> Практическое задание"), "Практическое задание");
  assert.equal(clean("## Важное примечание"), "Важное примечание");
  assert.equal(clean("Обычный заголовок"), "Обычный заголовок");
});

test("диаграммы: правило строки сбрасывает заливку старого .chart-bar", () => {
  const css = read("ui/css/components.css");
  const rule = [...css.matchAll(/\.chart-bar\s*\{([^}]*)\}/g)].map(m => m[1]).find(b => /grid-template-columns/.test(b));
  assert.ok(rule, "правило строки диаграммы найдено");
  assert.match(rule, /background:\s*none/);
  assert.match(rule, /height:\s*auto/);
});

test("списки на телефоне: кнопки переносятся под заголовок, название не ломается по буквам", () => {
  const css = read("ui/css/components.css");
  assert.match(css, /@media \(max-width: 640px\) \{\s*\.list-row \{ flex-wrap: wrap/);
  assert.match(css, /\.list-row > \.list-row-main \{ flex: 1 1 100%/);
});

test("карточка дисциплины: заголовок не оформляется как ссылка", () => {
  const css = read("ui/css/components.css");
  assert.match(css, /a\.discipline-card \{[^}]*text-decoration: none/);
  assert.match(css, /a\.discipline-card \{[^}]*color: var\(--text\)/);
});

test("боковое меню: у каждого пункта своя иконка", () => {
  const src = read("ui/components/sidebar.js");
  const used = [...src.matchAll(/id: "([a-z]+)",[^\n]*?icon: icons\.(\w+)/g)].map(m => [m[1], m[2]]);
  assert.ok(used.length >= 14, "пункты меню найдены");
  const names = used.map(([, icon]) => icon);
  assert.equal(new Set(names).size, names.length, `иконки повторяются: ${names.join(", ")}`);
  for (const icon of names) assert.ok(icons[icon], `иконка ${icon} объявлена`);
});
