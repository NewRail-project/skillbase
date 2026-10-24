import { test } from "node:test";
import assert from "node:assert/strict";
import { qrMatrix, qrToSvg, qrToDataUrl } from "../shared/qrcode.js";

const finderAt = (m, x0, y0) => {
  // 7x7: тёмная рамка, светлое кольцо, тёмный центр 3x3.
  for (let dy = 0; dy < 7; dy++) {
    for (let dx = 0; dx < 7; dx++) {
      const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      const dark = d !== 2;
      if (m.modules[y0 + dy][x0 + dx] !== dark) return false;
    }
  }
  return true;
};

test("короткая ссылка попадает в версию 2 при коррекции M", () => {
  const m = qrMatrix("https://example.com/abc12");
  assert.equal(m.version, 2);
  assert.equal(m.size, 25);
});

test("три поисковых маркера на месте, тёмный модуль стоит", () => {
  const m = qrMatrix("https://example.com/#join/ABCD");
  assert.ok(finderAt(m, 0, 0));
  assert.ok(finderAt(m, m.size - 7, 0));
  assert.ok(finderAt(m, 0, m.size - 7));
  assert.equal(m.modules[m.size - 8][8], true);
});

test("полосы синхронизации чередуются", () => {
  const m = qrMatrix("timing");
  for (let i = 8; i < m.size - 8; i++) {
    assert.equal(m.modules[6][i], i % 2 === 0);
    assert.equal(m.modules[i][6], i % 2 === 0);
  }
});

test("размер растёт с длиной данных, версия не превышает 40", () => {
  const small = qrMatrix("a".repeat(10));
  const big = qrMatrix("a".repeat(1000));
  assert.ok(big.version > small.version);
  assert.ok(big.version <= 40);
  assert.equal(big.size, big.version * 4 + 17);
});

test("UTF-8 кодируется по байтам", () => {
  const ascii = qrMatrix("x".repeat(40), { ecc: "L" });
  const cyr = qrMatrix("я".repeat(40), { ecc: "L" });
  assert.ok(cyr.version > ascii.version);
});

test("слишком длинные данные дают ошибку, а не битый код", () => {
  assert.throws(() => qrMatrix("a".repeat(3000), { ecc: "H" }), RangeError);
});

test("одинаковый вход даёт одинаковую матрицу", () => {
  const a = qrMatrix("same");
  const b = qrMatrix("same");
  assert.deepEqual(a.modules, b.modules);
});

test("SVG и data-URL содержат реальную разметку", () => {
  const svg = qrToSvg("https://example.com");
  assert.match(svg, /^<svg[^>]+viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /<path d="M/);
  assert.ok(qrToDataUrl("x").startsWith("data:image/svg+xml;charset=utf-8,"));
});

test("неизвестный уровень коррекции отклоняется", () => {
  assert.throws(() => qrMatrix("x", { ecc: "Z" }), RangeError);
});
