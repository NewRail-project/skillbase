// tests/footer.test.js — инварианты общего футера и юридических маршрутов.
//
// Регрессия: merge-коммит c7d514e закоммитил конфликтные маркеры
// («<<<<<<< HEAD») в index.html / ui/css/brand.css / ui/css/components.css,
// а маршруты #privacy/#terms/#rules/#contact отсутствовали в роутере —
// футер оставался без юридических ссылок, а ссылки согласия
// (core/consent-docs.js → CONSENT_DOCUMENTS, route: "#privacy") вели на 404.
//
// Тесты статические (fs): проверяют HTML/CSS/роутер без запуска браузера.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const html = read("index.html");
const app = read("shared/app.js");
const main = read("shared/main.js");
const brand = read("ui/css/brand.css");
const components = read("ui/css/components.css");
const org = read("configs/organization.js");

test("index.html: ровно один общий футер .site-footer и нет конфликтных маркеров", () => {
  assert.equal((html.match(/<footer class="site-footer">/g) || []).length, 1);
  assert.ok(!html.includes("<<<<<<<"), "маркер конфликта в index.html");
  assert.ok(!html.includes(">>>>>>>"), "маркер конфликта в index.html");
  assert.ok(!html.includes(".container"), "className .container внутри футера");
});

test("футер: три раздела (Платформа/Документы/Информация) и нижняя строка", () => {
  for (const fragment of [
    "site-footer-inner",
    "site-footer-title",
    "site-footer-brand",
    "Платформа",
    "Документы",
    "Информация",
    '<a href="#privacy">',
    '<a href="#terms">',
    '<a href="#rules">',
    '<a href="#contact">',
    '<a href="#contact/channels">',
    "site-footer-bottom",
    'id="footer-year"',
    'id="footer-version"',
    'id="footer-docversion"'
  ]) {
    assert.ok(html.includes(fragment), `футер не содержит: ${fragment}`);
  }
});

test("футер не содержит персональных контактов и имён разработчиков", () => {
  const start = html.indexOf('<footer class="site-footer">');
  const end = html.indexOf("</footer>", start) + "</footer>".length;
  const footer = html.slice(start, end);
  for (const forbidden of ["mailto:", "t.me", "bujlenkovdaniil", "YourAssistantWeb", "Frozencode_f", "core.singl", "Буйленков", "Голубятников", "instagram", "github.com"]) {
    assert.ok(!footer.includes(forbidden), `персональные данные в футере: ${forbidden}`);
  }
  // Способы связи остаются на своих страницах.
  assert.ok(read("ui/pages/contact.js").includes("mailto:bujlenkovdaniil@gmail.com"));
  assert.ok(read("ui/pages/contact.js").includes("t.me/YourAssistantWeb"));
});

test("маршруты футера, согласий и англоязычных версий зарегистрированы в роутере", () => {
  // Ключи таблицы маршрутов в shared/app.js (строки вида «"privacy": { file: ...»).
  const defined = new Set(
    [...app.matchAll(/^\s*"?([A-Za-z-]*)"?[ ]*:\s*\{\s*file:/gm)].map((m) => m[1])
  );
  for (const key of ["", "about", "privacy", "terms", "rules", "contact", "privacy-en", "terms-en", "rules-en"]) {
    assert.ok(defined.has(key), `маршрут "${key}" не зарегистрирован в app.js`);
  }
});

test("main.js синхронизирует год, версию и дату документов из конфига организации", () => {
  assert.ok(main.includes("configs/organization.js"), "main.js не импортирует конфиг организации");
  assert.ok(org.includes("version"), "в конфиге нет version");
  assert.ok(org.includes("docVersion"), "в конфиге нет docVersion");
  for (const id of ["footer-year", "footer-version", "footer-docversion"]) {
    assert.ok(main.includes(id), `main.js не привязывает #${id}`);
  }
});

test("футер: nav-колонки корректно закрыты (гард против остатков </section>)", () => {
  const start = html.indexOf('<footer class="site-footer">');
  const end = html.indexOf("</footer>", start) + "</footer>".length;
  const footer = html.slice(start, end);
  assert.equal((footer.match(/<nav\b/g) || []).length, 3, "в футере три nav-колонки");
  assert.equal((footer.match(/<\/nav>/g) || []).length, 3, "все nav-колонки закрыты");
  assert.ok(!footer.includes("</section>"), "в футере остался закрывающий </section>");
});

test("CSS: стили футера только в brand.css, дублей и маркеров нет", () => {
  for (const [name, css] of [["brand.css", brand], ["components.css", components]]) {
    assert.ok(!css.includes("<<<<<<<"), `маркер конфликта в ${name}`);
    assert.ok(!css.includes(">>>>>>>"), `маркер конфликта в ${name}`);
  }
  assert.ok(brand.includes(".site-footer-inner"), "в brand.css нет .site-footer-inner");
  assert.ok(brand.includes(".site-footer-bottom"), "в brand.css нет .site-footer-bottom");
  assert.ok(/\.site-footer\s*\{[^}]*margin-top:\s*auto/.test(brand), "футер не прижат к низу (margin-top: auto)");
  assert.equal((components.match(/\.site-footer/g) || []).length, 0, "components.css не должен дублировать стили футера");
});
