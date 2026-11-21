// tests/discipline-ux.test.js — UX/UI разделов дисциплин, тем и материалов.
//
// Проверяется то, что видит пользователь: отсутствие подчёркивания у
// названий-ссылок и крошек, общий компонент меню действий (раскрытие,
// выбор пункта, ARIA), порядок действий в карточке дисциплины и наличие
// компактных классов карточки. Страницы подменяются заглушками Firebase
// (tests/helpers/stub-loader.mjs), DOM — минимальный (fake-dom).
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { installFakeDom, findAll, findOne, text } from "./helpers/fake-dom.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(path.join(ROOT, f), "utf8");
const css = read("ui/css/components.css");

// ---------- Этап 1: подчёркивание ----------

test("названия: ссылки в заголовках и крошки без подчёркивания", () => {
  // h2 > a карточки дисциплины, ссылка в .eyebrow, крошки.
  for (const selector of ["h2 a", ".eyebrow a", ".page-head a", ".crumb"]) {
    assert.ok(new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^\\n]*\\{[^\\n]*text-decoration: none`)
      .test(css) || css.includes(`${selector},`) || css.includes(`${selector} {`),
      `нет правила «без подчёркивания» для ${selector}`);
  }
  // Блок-группа действительно объявляет text-decoration: none.
  const group = /h1 a,[\s\S]*?\.crumb:hover \{\s*text-decoration: none;\s*\}/.exec(css);
  assert.ok(group, "группа правил без подчёркивания найдена");
  assert.match(group[0], /h2 a/);
  assert.match(group[0], /\.eyebrow a/);
  // Наведение — подчёркивание как признак интерактивности.
  assert.match(css, /h1 a:hover[\s\S]*?\.crumb:hover \{[\s\S]*?text-decoration: underline/);
  // Крошка объявлена как отдельный компонент.
  assert.match(css, /\.crumb \{[\s\S]*?color: var\(--accent\)/);
});

test("страницы используют крошки вместо подчёркнутых ссылок", () => {
  assert.match(read("ui/pages/discipline-page.js"), /class: "crumb", href: "#disciplines"/);
  assert.match(read("ui/pages/topic.js"), /class: "crumb",[\s\S]*?К дисциплине/);
  assert.match(read("ui/pages/subjects.js"), /class: "crumb", href: "#subjects"/);
});

// ---------- Этап 2: меню действий ----------

register("./helpers/stub-loader.mjs", import.meta.url);
installFakeDom();
const { actionsMenu } = await import("../ui/components/actions-menu.js");

test("меню действий: кнопка раскрывает список, aria-expanded меняется", () => {
  const menu = actionsMenu({ label: "Ещё", items: [{ label: "Копировать", onClick: () => {} }] });
  const toggle = findOne(menu, e => e.className.includes("actions-menu-toggle"));
  const pop = findOne(menu, e => e.className.includes("actions-menu-pop"));
  assert.ok(toggle && pop, "кнопка и список есть");
  assert.equal(toggle.getAttribute("aria-haspopup"), "menu");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(pop.hidden, true, "список скрыт в покое");

  toggle.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(pop.hidden, false, "список раскрыт");

  toggle.click();
  assert.equal(pop.hidden, true, "повторное нажатие закрывает");
});

test("меню действий: выбор пункта выполняет действие и закрывает список", () => {
  let called = 0;
  const menu = actionsMenu({
    items: [
      { label: "Изменить", onClick: () => { called += 1; } },
      { label: "Удалить", tone: "danger", onClick: () => { called += 10; } }
    ]
  });
  const toggle = findOne(menu, e => e.className.includes("actions-menu-toggle"));
  const items = findAll(menu, e => e.className.includes("actions-menu-item"));
  assert.equal(items.length, 2, "оба пункта на месте");
  assert.ok(items[1].className.includes("danger-text"), "опасный пункт помечен");

  toggle.click();
  items[0].click();
  assert.equal(called, 1, "действие выполнено");
  assert.equal(toggle.getAttribute("aria-expanded"), "false", "меню закрылось после выбора");
  assert.equal(findOne(menu, e => e.className.includes("actions-menu-pop")).hidden, true);
});

test("меню действий: пункты доступны с клавиатуры (role=menuitem)", () => {
  const menu = actionsMenu({ items: [{ label: "В архив", onClick: () => {} }] });
  const item = findOne(menu, e => e.className.includes("actions-menu-item"));
  assert.equal(item.getAttribute("role"), "menuitem");
  assert.equal(item.type, "button", "кнопка, а не div — работает Tab/Enter");
  assert.equal(item.textContent, "В архив");
});

test("меню действий: CSS раскрывается под кнопкой и не выходит за экран", () => {
  assert.match(css, /\.actions-menu \{ position: relative/);
  assert.match(css, /\.actions-menu-pop \{[\s\S]*?position: absolute/);
  assert.match(css, /\.actions-menu-pop \{[\s\S]*?right: 0/);
  assert.match(css, /max-width: min\(300px, calc\(100vw - 2rem\)\)/, "ограничение по ширине экрана");
  assert.match(css, /\.actions-menu-pop\[hidden\] \{ display: none; \}/);
  assert.match(css, /\.actions-menu-item \{[\s\S]*?min-height: 44px/, "тач-цель 44px");
});

test("страницы дисциплин используют меню действий вместо ряда кнопок", () => {
  const catalog = read("ui/pages/discipline-catalog.js");
  const page = read("ui/pages/discipline-page.js");
  const topic = read("ui/pages/topic.js");
  for (const [name, src] of [["каталог", catalog], ["дисциплина", page], ["тема", topic]]) {
    assert.match(src, /actions-menu/, `нет меню «Ещё» на странице: ${name}`);
  }
  // Опасное действие не должно идти первым в карточке.
  const buttons = [...catalog.matchAll(/h\("button", \{[^}]*onclick: (\w+)\([^)]*\)[^}]*\}, "([^"]+)"/g)]
    .map(m => m[2]);
  assert.ok(buttons.length >= 2, `кнопки карточки найдены: ${JSON.stringify(buttons)}`);
  assert.notEqual(buttons[0], "В архив", "«В архив» больше не первая кнопка карточки");
  assert.notEqual(buttons[0], "Удалить", "«Удалить» не идёт первым");
});
