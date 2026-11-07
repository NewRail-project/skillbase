// Цвета QR из темы: всегда тёмный модуль на светлом фоне (читаемость сканерами).
import test from "node:test";
import assert from "node:assert/strict";
import { qrPalette, themedQrOptions } from "../shared/qr-theme.js";

const lum = (hex) => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

test("палитра без document — запасной акцент, значения hex", () => {
  const p = qrPalette();
  for (const k of ["accent", "dark", "finderDark", "light"]) {
    assert.match(p[k], /^#[0-9a-f]{6}$/);
  }
});

test("модули темнее фона с большим запасом контраста", () => {
  const p = qrPalette();
  assert.ok(lum(p.light) - lum(p.dark) > 0.6);
  assert.ok(lum(p.finderDark) <= lum(p.dark));
});

test("themedQrOptions сохраняет базовые опции и подставляет цвета", () => {
  const o = themedQrOptions({ width: 160, ecc: "H" });
  assert.equal(o.width, 160);
  assert.equal(o.ecc, "H");
  assert.ok(o.dark && o.light && o.finderDark);
});
