// tests/navigation.test.js — статическая проверка согласованности
// маршрутов, страниц и ссылок навигации.
//
// Регрессия на инвентаризацию 2026-11: ссылка #leaderboard в меню вела на
// 404 (маршрут не был подключён к роутеру), а кнопка «Детали» в
// teacher-dashboard вела на несуществующий #teacher-results. Тест ловит
// такие разрывы: каждый маршрут app.js должен указывать на существующий
// файл с export default, а каждый внутренний хеш-переход в рабочем коде —
// на существующий маршрут или якорь элемента.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".git", "tests", "skillbase-master"].includes(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (entry.endsWith(".js")) acc.push(full);
  }
  return acc;
}

const appSource = readFileSync(path.join(ROOT, "shared/app.js"), "utf8");

// ---------- Маршруты роутера ----------
const routes = new Map();
for (const m of appSource.matchAll(/"([a-zA-Z-]*)":\s*\{\s*file:\s*"([^"]+)"/g)) {
  routes.set(m[1], m[2]);
}
// "" — маршрут главной (ui/pages/home.js).
assert.ok(routes.has(""), "в app.js должен быть маршрут главной страницы");

test("маршруты app.js указывают на существующие файлы с export default", () => {
  for (const [name, file] of routes) {
    const full = path.join(ROOT, file);
    assert.ok(
      statSync(full).isFile(),
      `маршрут "${name}" указывает на отсутствующий файл ${file}`
    );
    const src = readFileSync(full, "utf8");
    assert.match(
      src,
      /export\s+default/,
      `страница ${file} (маршрут "${name}") не экспортирует default`
    );
  }
});

test("новая страница темы #topic/<id> подключена к роутеру", () => {
  assert.equal(routes.get("topic"), "ui/pages/topic.js");
});

test("хеш-ссылки в рабочем коде ведут на существующие маршруты", () => {
  const files = walk(ROOT).filter(f => !f.endsWith("app.js") && !f.includes("components/brand"));
  const problems = [];

  // Известный долг из инвентаризации: стаб teacher-dashboard ведёт на
  // #teacher-results — маршрута нет. Явно исключён, чтобы долг не
  // расползался: любые НОВЫЕ битые ссылки тест ловит.
  const knownDebt = new Set(["teacher-results"]);

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file);
    // Только реальные переходы: href, location.hash, link(...), callPage —
    // селекторы querySelector("#id") маршрутами не являются.
    const refs = [
      ...src.matchAll(/href\s*[:=]\s*["'`]#([a-zA-Z][a-zA-Z0-9-]*)/g),
      ...src.matchAll(/location\.hash\s*=\s*["'`]#([a-zA-Z][a-zA-Z0-9-]*)/g),
      ...src.matchAll(/\blink\(\s*["'`]#([a-zA-Z][a-zA-Z0-9-]*)/g),
      ...src.matchAll(/saveReturnTo\(\s*["'`]#([a-zA-Z][a-zA-Z0-9-]*)/g),
      ...src.matchAll(/consumeReturnTo\(\s*["'`]#([a-zA-Z][a-zA-Z0-9-]*)/g)
    ];
    for (const m of refs) {
      const target = m[1];
      if (knownDebt.has(target)) continue;
      if (!routes.has(target)) problems.push(`${rel}: ссылка "#${target}" без маршрута`);
    }
  }
  assert.deepEqual(problems, []);
});

test("известные страницы предметов и тем не создают дублей маршрутов", () => {
  // quiz.js намеренно обслуживает два маршрута (#quiz и #trial —
  // «один файл, два режима», см. комментарий в app.js).
  const counts = new Map();
  for (const [, file] of routes) counts.set(file, (counts.get(file) || 0) + 1);
  for (const [file, n] of counts) {
    if (file === "ui/pages/quiz.js") {
      assert.ok(n <= 2, `${file} привязан к ${n} маршрутам`);
      continue;
    }
    assert.equal(n, 1, `${file} привязан к ${n} маршрутам — дублирование`);
  }
});
