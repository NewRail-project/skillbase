// Проверка проекта без браузера: node tools/check.cjs
const fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..");
const files = [];
(function walk(d) {
  for (const n of fs.readdirSync(d)) {
    if (["node_modules", ".git", "tools", "tests"].includes(n)) continue;
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p); else if (n.endsWith(".js")) files.push(p);
  }
})(root);

const rel = (p) => path.relative(root, p);
const exportsOf = (f) => {
  const s = fs.readFileSync(f, "utf8"), out = new Set();
  for (const m of s.matchAll(/export\s+(?:async\s+)?(?:function\s*?|const|let|var|class)\s+([A-Za-z0-9_$]+)/g)) out.add(m[1]);
  for (const m of s.matchAll(/export\s*\{([^}]*)\}/g))
    m[1].split(",").map(x => x.trim()).filter(Boolean).forEach(x => out.add(x.split(/\s+as\s+/).pop().trim()));
  if (/export\s+default\b/.test(s)) out.add("default");
  return out;
};

let problems = 0;
const bad = (f, msg) => { console.log("✗", rel(f) + ":", msg); problems++; };

for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  if (/from\s+['"]react|useState\(|useEffect\(|unpkg\.com/.test(s)) bad(f, "остатки React/unpkg");
  for (const m of s.matchAll(/import\s+([^"';]+?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const [, what, spec] = m;
    if (/^https:\/\//.test(spec)) continue;
    if (!/^\.{1,2}\//.test(spec)) { bad(f, `«голый» импорт '${spec}'`); continue; }
    const target = path.resolve(path.dirname(f), spec);
    if (!fs.existsSync(target)) { bad(f, `нет файла ${spec}`); continue; }
    const have = exportsOf(target);
    const named = what.match(/\{([^}]*)\}/);
    if (named) for (const raw of named[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name && !have.has(name)) bad(f, `'${spec}' не экспортирует '${name}'`);
    }
    if (/^[A-Za-z_$][\w$]*\s*(,|$)/.test(what.trim()) && !have.has("default")) bad(f, `'${spec}' не имеет export default`);
  }
  for (const m of s.matchAll(/import\(\s*['"`](\.{1,2}\/[^'"`$]+)['"`]\s*\)/g))
    if (!fs.existsSync(path.resolve(path.dirname(f), m[1]))) bad(f, `нет файла ${m[1]}`);
}

for (const f of files) {
  if (rel(f).startsWith("skillbase-master")) continue;
  const s = fs.readFileSync(f, "utf8");
  const r7Regex = /(?:innerHTML|insertAdjacentHTML)\s*=\s*(`[^`]*\$\{[^\`]*\`[^`]*`|"[^"]*\$\{[^"]*\`[^"]*`|'[^']*\$\{[^']*\`[^']*')/g;
  for (const m of s.matchAll(r7Regex)) bad(f, "innerHTML/insertAdjacentHTML с подстановкой данных (R7)");
  if (/\bonclick\s*=\s*["\']/m.test(s) || /\bonerror\s*=\s*["\']/m.test(s) || /\bonload\s*=\s*["\']/m.test(s)) {
    bad(f, "inline onclick/onerror/onload в шаблоне (R7)");
  }
}

const appPath = path.join(root, "shared/app.js");
if (fs.existsSync(appPath)) {
  const appS = fs.readFileSync(appPath, "utf8");
  for (const m of appS.matchAll(/file:\s*"([^"]+)"/g)) {
    const relPath = m[1];
    const absPath = path.resolve(root, relPath);
    if (!fs.existsSync(absPath)) bad(appPath, `routes: нет файла ${relPath}`);
  }
}

const cssDir = path.join(root, "ui/css");
if (fs.existsSync(cssDir)) {
  const cssFiles = fs.readdirSync(cssDir).filter(n => n.endsWith(".css")).map(n => path.join(cssDir, n));
  const defined = new Set();
  for (const cf of cssFiles) {
    const cs = fs.readFileSync(cf, "utf8");
    for (const m of cs.matchAll(/--[A-Za-z0-9_-]+/g)) defined.add(m[0]);
  }
  for (const cf of cssFiles) {
    const cs = fs.readFileSync(cf, "utf8");
    for (const m of cs.matchAll(/var\((--[A-Za-z0-9_-]+)\)/g)) {
      if (!defined.has(m[1])) console.log("⚠", path.relative(root, cf) + ": неизвестная переменная", m[1]);
    }
  }
}

console.log(problems ? `\nНайдено проблем: ${problems}` : "Всё в порядке: импорты, экспорты, файлы, безопасность согласованы.");
process.exit(problems ? 1 : 0);