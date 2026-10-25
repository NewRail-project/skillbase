import fs from 'fs';

function parseHexToRGB(hex) {
  let cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split('').map(char => char + char).join('');
  }
  const num = parseInt(cleanHex, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
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

function parseThemeCss(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const tokens = {};
  const regex = /--([a-zA-Z0-9-_]+):\s*([^;]+);/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

const themes = [
  { name: 'operations', path: 'ui/css/themes/operations.css' },
  { name: 'depot', path: 'ui/css/themes/depot.css' },
  { name: 'education', path: 'ui/css/themes/education.css' }
];

const pairsToCheck = [
  ['text', 'surface'],
  ['text-2', 'surface'],
  ['text-2', 'elevated'],
  ['on-accent', 'accent'],
  ['on-warn', 'warn'],
  ['accent', 'bg'],
  ['accent', 'elevated'],
  ['ok', 'surface'],
  ['danger', 'surface'],
  ['text', 'ok-bg'],
  ['text', 'danger-bg'],
  ['text', 'warn-bg']
];

let hasError = false;

themes.forEach(theme => {
  console.log(`Checking theme: ${theme.name}`);
  const tokens = parseThemeCss(theme.path);
  
  pairsToCheck.forEach(([fgName, bgName]) => {
    const fgHex = tokens[fgName];
    const bgHex = tokens[bgName];
    
    if (!fgHex || !bgHex) {
      console.warn(`  Warning: Missing token pair (${fgName} / ${bgName}) in ${theme.name}`);
      return;
    }
    
    if (!fgHex.startsWith('#') || !bgHex.startsWith('#')) {
      return;
    }
    
    const l1 = getRelativeLuminance(parseHexToRGB(fgHex));
    const l2 = getRelativeLuminance(parseHexToRGB(bgHex));
    const cr = getContrastRatio(l1, l2);
    
    const passed = cr >= 4.5;
    console.log(`  ${fgName} (${fgHex}) on ${bgName} (${bgHex}) -> CR: ${cr.toFixed(2)} [${passed ? 'PASS' : 'FAIL'}]`);
    
    if (!passed) {
      hasError = true;
    }
  });
});

if (hasError) {
  console.error('\nSome contrast checks failed!');
  process.exit(1);
} else {
  console.log('\nAll contrast checks passed successfully with >= 4.5!');
  process.exit(0);
}
