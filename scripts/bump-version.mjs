// scripts/bump-version.mjs — централизованное версионирование ресурсов.
//
// Единственное место, где живёт версия публикации. Запускается deploy-скриптом
// перед проверками и обновляет:
//   1. index.html  — все локальные "?v=..." у CSS и входного модуля;
//   2. sw.js       — CACHE_VERSION (смена имени кэша удаляет старый кэш
//                    целиком на активации Service Worker).
//
// Вложенные ES-модули (?v= не имеют) покрываются связкой «новый HTML → новые
// URL входных файлов + новый кэш SW»: браузер никогда не смешивает старые и
// новые версии внутри одной публикации.
//
// Использование: node scripts/bump-version.mjs [версия]
// Без аргумента версия = <package.json version>.<YYYYMMDDHHmmss>.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const buildId = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const version = process.argv[2] || `${pkg.version}.${buildId}`;

// index.html: меняем только локальные ?v= (относительные и корневые пути),
// внешние URL (CDN Firebase) не содержат ?v= и не затрагиваются.
const indexPath = path.join(root, "index.html");
const html = readFileSync(indexPath, "utf8");
const htmlNext = html.replace(/(href|src)="([^"]*\.(?:css|js))\?v=[^"]*"/g, `$1="$2?v=${version}"`);
const htmlChanged = htmlNext !== html;
writeFileSync(indexPath, htmlNext);

// sw.js: новое имя кэша гарантирует чистую выдачу статики после публикации.
const swPath = path.join(root, "sw.js");
const sw = readFileSync(swPath, "utf8");
const swNext = sw.replace(/const CACHE_VERSION = '[^']*';/, `const CACHE_VERSION = 'v${version}';`);
const swChanged = swNext !== sw;
writeFileSync(swPath, swNext);

if (!htmlChanged || !swChanged) {
  console.error("! bump-version: не найдены шаблоны версии — проверьте index.html и sw.js");
  process.exit(1);
}
console.log(`Версия ресурсов: ${version} (index.html, sw.js)`);
