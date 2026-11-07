// shared/qr-theme.js — цвета QR-кода из текущей темы и скина.
// QR всегда остаётся тёмным на светлом (иначе его не прочтут сканеры),
// но оттенок берётся из --accent, поэтому меняется вместе со стилем сайта.

function parseColor(str) {
  const s = String(str || "").trim();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    let hex = m[1];
    if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  }
  m = s.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

const toHex = (rgb) =>
  "#" + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

export function qrPalette() {
  let accent = null;
  try {
    accent = parseColor(getComputedStyle(document.documentElement).getPropertyValue("--accent"));
  } catch (_) { /* нет document */ }
  accent = accent || [27, 90, 122];
  return {
    accent: toHex(accent),
    dark: toHex(mix(accent, [0, 0, 0], 0.62)),
    finderDark: toHex(mix(accent, [0, 0, 0], 0.78)),
    light: toHex(mix([255, 255, 255], accent, 0.05))
  };
}

// Опции для generateQRSvg поверх базовых.
export function themedQrOptions(base = {}) {
  const p = qrPalette();
  return { ...base, dark: p.dark, light: p.light, finderDark: p.finderDark };
}
