// Проверка контрастности токенов по WCAG AA (>= 4.5 для текста).
// Разбирает каждый цветовой блок отдельно: html[data-ui=...][data-theme=...].
// Запуск: node scripts/check-contrast.mjs

import fs from 'fs';

function parseHexToRGB(hex) {
  let cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split('').map(char => char + char).join('');
  }
  const num = parseInt(cleanHex, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function getRelativeLuminance(rgb) {
  const channel = [rgb.r, rgb.g, rgb.b].map(val => {
    const sRGB = val / 255;
    return sRGB <= 0.03928 ? sRGB / 12.92 : Math.pow((sRGB + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channel[0] + 0.7152 * channel[1] + 0.0722 * channel[2];
}

function getContrastRatio(l1, l2) {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Возвращает [{ selector, tokens }] по каждому блоку правил в файле.
function parseBlocks(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  const blockRe = /([^{}]+)\{([^}]*)\}/g;
  let block;
  while ((block = blockRe.exec(content)) !== null) {
    const selector = block[1].trim().replace(/\s+/g, ' ');
    const body = block[2];
    const tokens = {};
    const tokenRe = /--([a-zA-Z0-9-_]+)\s*:\s*([^;]+);/g;
    let token;
    while ((token = tokenRe.exec(body)) !== null) {
      tokens[token[1]] = token[2].trim();
    }
    if (Object.keys(tokens).length) blocks.push({ selector, tokens });
  }
  return blocks;
}

const themes = [
  { name: 'education', path: 'ui/css/themes/education.css' },
  { name: 'operations', path: 'ui/css/themes/operations.css' },
  { name: 'depot', path: 'ui/css/themes/depot.css' }
];

const pairsToCheck = [
  ['text', 'surface'],
  ['text', 'bg'],
  ['text-2', 'surface'],
  ['text-2', 'bg'],
  ['text-2', 'elevated'],
  ['on-accent', 'accent'],
  ['on-warn', 'warn'],
  ['accent', 'bg'],
  ['accent', 'surface'],
  ['accent', 'elevated'],
  ['ok', 'surface'],
  ['danger', 'surface'],
  ['text', 'ok-bg'],
  ['text', 'danger-bg'],
  ['text', 'warn-bg']
];

let hasError = false;
let checks = 0;

for (const theme of themes) {
  const blocks = parseBlocks(theme.path);
  for (const { selector, tokens } of blocks) {
    const themed = /data-theme="(light|dark)"/.exec(selector);
    // Блоки-«обёртки» без цветов пропускаем: у них нет токенов цвета.
    if (!themed) continue;
    console.log(`\n[${theme.name}] ${selector}`);
    for (const [fgName, bgName] of pairsToCheck) {
      const fg = tokens[fgName];
      const bg = tokens[bgName];
      if (!fg || !bg) continue;
      if (!fg.startsWith('#') || !bg.startsWith('#')) continue;
      const cr = getContrastRatio(
        getRelativeLuminance(parseHexToRGB(fg)),
        getRelativeLuminance(parseHexToRGB(bg))
      );
      const pass = cr >= 4.5;
      checks++;
      if (!pass) hasError = true;
      console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${fgName} ${fg} on ${bgName} ${bg} -> ${cr.toFixed(2)}`);
    }
  }
}

console.log(`\nПроверено пар: ${checks}`);
if (hasError) {
  console.error('Есть пары ниже 4.5 — исправьте токены.');
  process.exit(1);
}
console.log('Все проверенные пары >= 4.5.');
