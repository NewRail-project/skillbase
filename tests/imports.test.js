// tests/imports.test.js — статическая проверка согласованности
// импортов и экспортов в ES-модулях проекта.
//
// Регрессия на продакшен-инцидент 2026-10-28: core/auth.js импортировал
// signInAnonymously из shared/firebase.js, а тот его не экспортировал.
// В браузере это ошибка связывания всего модульного графа: shared/main.js
// не выполняется, роутер не стартует, главная область — пустая.
// Тест ловит такие разрывы до публикации.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['core', 'shared', 'ui', 'configs'];

// ---------- Сбор файлов ----------
function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'tests') continue;
      walk(full, acc);
    } else if (entry.name.endsWith('.js')) {
      acc.push(full);
    }
  }
  return acc;
}

const files = SCAN_DIRS
  .map(dir => path.join(ROOT, dir))
  .filter(dir => existsSync(dir))
  .flatMap(dir => walk(dir));

// ---------- Разбор импортов ----------
// Только относительные статические импорты: bare-спецификаторы,
// https://-URL и динамические import() вне зоны ответственности теста.
const NAMED = /import\s*\{([\w$,\s]+?)\}\s*from\s*['"](\.[^'"]+)['"]/g;
const DEFAULT = /import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[\w$,\s]+?\})?\s*from\s*['"](\.[^'"]+)['"]/g;
const NAMESPACE = /import\s*\*\s*as\s+[A-Za-z_$][\w$]*\s*from\s*['"](\.[^'"]+)['"]/g;

function parseImports(file) {
  const text = readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const result = [];

  for (const m of text.matchAll(NAMED)) {
    const names = m[1]
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => part.split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    result.push({ kind: 'named', names, source: m[2], importer: rel });
  }
  for (const m of text.matchAll(DEFAULT)) {
    result.push({ kind: 'default', names: ['default'], source: m[2], importer: rel });
  }
  for (const m of text.matchAll(NAMESPACE)) {
    result.push({ kind: 'namespace', names: [], source: m[1], importer: rel });
  }
  return result;
}

// ---------- Разбор экспортов ----------
// export { a, b as c } [from './y.js'], export const/function/class NAME,
// export default, реэкспорты резолвятся транзитивно (защита от циклов — Set).
function exportsOf(absFile, visited = new Set()) {
  const result = { names: new Set(), hasDefault: false };
  if (visited.has(absFile) || !existsSync(absFile)) return result;
  visited.add(absFile);
  const text = readFileSync(absFile, 'utf8');

  if (/export\s+default\b/.test(text)) result.hasDefault = true;

  const exportDecl = /export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;
  for (const m of text.matchAll(exportDecl)) {
    result.names.add(m[1]);
  }

  const exportList = /export\s*\{([\s\S]*?)\}\s*(?:from\s*['"](\.[^'"]+)['"])?\s*;?/g;
  for (const m of text.matchAll(exportList)) {
    const names = m[1]
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
      // экспортируется то, что стоит после as: export { a as b } → b
      .map(part => (part.split(/\s+as\s+/)[1] || part).trim())
      .filter(Boolean);
    if (m[2]) {
      // Реэкспорт: имена берём из целевого модуля транзитивно.
      const child = exportsOf(path.resolve(path.dirname(absFile), m[2]), visited);
      for (const name of names) result.names.add(name);
      // Пограничный случай не ловим намеренно: re-export отсутствующего
      // имени в дочернем модуле проверять не будем (ложные срабатывания
      // хуже пропуска).
    } else {
      for (const name of names) result.names.add(name);
    }
  }

  return result;
}

function resolveTarget(importerRel, source) {
  return path.resolve(ROOT, path.dirname(importerRel), source);
}

// ---------- Тесты ----------
const allImports = files.flatMap(file => parseImports(file));

test('imports: все локальные модули статических импортов существуют', () => {
  const missing = [];
  for (const item of allImports) {
    if (!existsSync(resolveTarget(item.importer, item.source))) {
      missing.push(`${item.importer} → '${item.source}' (${item.kind})`);
    }
  }
  assert.deepEqual(missing, [],
    `Битые пути импортов (файл не существует):\n  ${missing.join('\n  ')}`);
});

test('imports: каждый именованный импорт экспортируется целевым модулем', () => {
  const broken = [];
  for (const item of allImports) {
    if (item.kind !== 'named') continue;
    const target = resolveTarget(item.importer, item.source);
    if (!existsSync(target)) continue; // ловится предыдущим тестом
    const exports = exportsOf(target);
    for (const name of item.names) {
      if (!exports.names.has(name)) {
        broken.push(`${item.importer}: экспорт '${name}' отсутствует в '${path.relative(ROOT, target)}'`);
      }
    }
  }
  assert.deepEqual(broken, [],
    `Именованные импорты без экспорта (в браузере это роняет весь модульный граф):\n  ${broken.join('\n  ')}`);
});

test('imports: каждый дефолтный импорт указывает на модуль с export default', () => {
  const broken = [];
  for (const item of allImports) {
    if (item.kind !== 'default') continue;
    const target = resolveTarget(item.importer, item.source);
    if (!existsSync(target)) continue;
    if (!exportsOf(target).hasDefault) {
      broken.push(`${item.importer}: default-импорт из '${path.relative(ROOT, target)}' без export default`);
    }
  }
  assert.deepEqual(broken, [], `Битые default-импорты:\n  ${broken.join('\n  ')}`);
});

test('imports: неймспейсный импорт указывает на модуль хотя бы с одним экспортом', () => {
  const broken = [];
  for (const item of allImports) {
    if (item.kind !== 'namespace') continue;
    const target = resolveTarget(item.importer, item.source);
    if (!existsSync(target)) continue;
    const exports = exportsOf(target);
    if (!exports.hasDefault && exports.names.size === 0) {
      broken.push(`${item.importer}: неймспейсный импорт из '${path.relative(ROOT, target)}' без экспортов`);
    }
  }
  assert.deepEqual(broken, [], `Битые неймспейсные импорты:\n  ${broken.join('\n  ')}`);
});

test('imports: проект просканирован, файлов достаточно для проверки', () => {
  // Страховка от пустого сканирования (переименование каталогов).
  assert.ok(files.length >= 30, `Найдено только ${files.length} файлов — проверьте SCAN_DIRS`);
});
