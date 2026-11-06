// Проверка графа импортов браузерного кода.
// Ловит ровно тот класс ошибок, из-за которого приложение падало:
// отсутствующий файл, неверный путь, импорт несуществующего экспорта.
// Запуск: node scripts/check-imports.mjs

import fs from 'fs';
import path from 'path';

const ROOTS = ['core', 'shared', 'ui', 'configs'];
const EXT = ['.js', '.mjs'];

let errors = 0;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(full, out);
    } else if (EXT.includes(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Имена, объявленные в файле: function/class/const/let/var (включая
// деструктуризацию) и импорты (import X, import { a, b as c }, import * as ns).
// Нужно для проверки export { x } без from: экспортируемое имя обязано
// где-то в файле существовать.
function collectDeclaredNames(src) {
  const names = new Set();
  const patterns = [
    /\b(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)/g,
    /\bclass\s+([A-Za-z0-9_$]+)/g,
    /\b(?:const|let|var)\s+([A-Za-z0-9_$]+)/g
  ];
  let m;
  for (const re of patterns) {
    while ((m = re.exec(src)) !== null) names.add(m[1]);
  }
  // const { a, b: c } = ... / const [x, y] = ...
  const destrRe = /\b(?:const|let|var)\s*[{[]([^}\]]*)[}\]]/g;
  while ((m = destrRe.exec(src)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/[=:]/)[0].trim();
      if (/^[A-Za-z0-9_$]+$/.test(name)) names.add(name);
    }
  }
  // Импорты объявляют локальные имена.
  const importDefault = /\bimport\s+([A-Za-z0-9_$]+)\s+from/g;
  while ((m = importDefault.exec(src)) !== null) names.add(m[1]);
  const importDefaultWithNamed = /\bimport\s+([A-Za-z0-9_$]+)\s*,/g;
  while ((m = importDefaultWithNamed.exec(src)) !== null) names.add(m[1]);
  const importNs = /\bimport\s*\*\s*as\s+([A-Za-z0-9_$]+)/g;
  while ((m = importNs.exec(src)) !== null) names.add(m[1]);
  const importNamed = /\bimport\s*\{([^}]*)\}\s*from/g;
  while ((m = importNamed.exec(src)) !== null) {
    for (const part of m[1].split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      const asMatch = /^([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)$/.exec(piece);
      names.add(asMatch ? asMatch[2] : piece);
    }
  }
  return names;
}

function collectExports(file, seen = new Set()) {
  const names = new Set();
  if (seen.has(file)) return names;
  seen.add(file);
  const src = stripComments(fs.readFileSync(file, 'utf8'));

  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g,
    /export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g,
    /export\s+class\s+([A-Za-z0-9_$]+)/g,
    /export\s+default\b/g
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) {
      names.add(m[1] || 'default');
    }
  }

  // export { a, b as c } [from "..."]
  const namedRe = /export\s*\{([^}]*)\}\s*(?:from\s*["']([^"']+)["'])?/g;
  const declared = collectDeclaredNames(src);
  let m;
  while ((m = namedRe.exec(src)) !== null) {
    const body = m[1];
    const from = m[2];
    for (const part of body.split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      const asMatch = /^([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)$/.exec(piece);
      const exported = asMatch ? asMatch[2] : piece;
      const local = asMatch ? asMatch[1] : piece;
      if (from) {
        const target = resolveSpecifier(file, from);
        if (target && !collectExports(target, seen).has(local)) {
          console.error(`BROKEN RE-EXPORT  ${file}\n    re-export "${local}" из ${from}, но ${path.relative(process.cwd(), target)} его не экспортирует`);
          errors++;
          continue; // имя наружу не добавляем: импортёры получат точную ошибку
        }
        names.add(exported);
      } else {
        // export { x } без from: имя обязано быть объявлено в этом же файле.
        // Именно здесь раньше проходил экспорт несуществующей функции —
        // node --check и браузер падают на таком модуле целиком.
        if (!declared.has(local)) {
          console.error(`BROKEN EXPORT  ${file}\n    export "${local}", но имя не объявлено в файле (function/const/class/import)`);
          errors++;
          continue;
        }
        names.add(exported);
      }
    }
  }

  if (/export\s+\*\s+from/.test(src)) names.add('*');
  return names;
}

function resolveSpecifier(fromFile, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null; // https, bare
  const base = path.resolve(path.dirname(fromFile), spec.split('?')[0]);
  const candidates = [base, ...EXT.map(e => base + e), ...EXT.map(e => path.join(base, 'index' + e))];
  return candidates.find(p => fs.existsSync(p) && fs.statSync(p).isFile()) || null;
}

const files = ROOTS.flatMap(r => walk(r));
let checked = 0;
const exportCache = new Map();

for (const file of files) {
  const src = stripComments(fs.readFileSync(file, 'utf8'));

  const importRe = /import\s+([^;]*?)\s+from\s*["']([^"']+)["']/g;
  let m;
  while ((m = importRe.exec(src)) !== null) {
    const clause = m[1].trim();
    const spec = m[2];
    if (spec.startsWith('http://') || spec.startsWith('https://')) continue;

    const target = resolveSpecifier(file, spec);
    checked++;
    if (!target) {
      console.error(`MISSING FILE  ${file}  ->  ${spec}`);
      errors++;
      continue;
    }

    if (!exportCache.has(target)) exportCache.set(target, collectExports(target));
    const exports = exportCache.get(target);
    if (exports.has('*')) continue;

    // import { a, b as c }
    const braceMatch = /^\{([\s\S]*)\}$/.exec(clause);
    if (braceMatch) {
      for (const part of braceMatch[1].split(',')) {
        const piece = part.trim();
        if (!piece || piece.startsWith('type ')) continue;
        const name = piece.split(/\s+as\s+/)[0].trim();
        if (!exports.has(name)) {
          console.error(`MISSING EXPORT  ${file}\n    imports "${name}" from ${spec}, но ${path.relative(process.cwd(), target)} его не экспортирует`);
          errors++;
        }
      }
    } else {
      // import X / import X, { ... }
      const defaultName = clause.split(',')[0].trim();
      if (defaultName && !defaultName.startsWith('{') && !defaultName.startsWith('*') && !exports.has('default')) {
        console.error(`MISSING DEFAULT  ${file}  imports default from ${spec}`);
        errors++;
      }
    }
  }

  // export ... from
  const reExportRe = /export\s+(?:\*|\{[^}]*\})\s+from\s*["']([^"']+)["']/g;
  while ((m = reExportRe.exec(src)) !== null) {
    checked++;
    if (!resolveSpecifier(file, m[1])) {
      console.error(`MISSING FILE  ${file}  ->  ${m[1]} (re-export)`);
      errors++;
    }
  }
}

console.log(`\nФайлов: ${files.length}, импортов проверено: ${checked}, ошибок: ${errors}`);
process.exit(errors ? 1 : 0);
