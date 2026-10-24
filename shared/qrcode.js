// shared/qrcode.js — генератор QR-кодов (ISO/IEC 18004), режим Byte, версии 1–40.
// Чистый ES-модуль без зависимостей: работает в браузере и в Node.
// Раньше shared/vendor/qr.js был обрезком CommonJS-библиотеки с require() на
// несуществующие файлы и в браузере не загружался, поэтому QR-кодов не было.

const ECC = { L: 0, M: 1, Q: 2, H: 3 };
const FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

// Индекс — номер версии (0 не используется).
const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
];
const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
];

const bit = (value, i) => ((value >>> i) & 1) !== 0;

function rawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(ver, ecc) {
  return Math.floor(rawDataModules(ver) / 8)
    - ECC_CODEWORDS_PER_BLOCK[ECC[ecc]][ver] * NUM_ERROR_CORRECTION_BLOCKS[ECC[ecc]][ver];
}

// ---------- Рид–Соломон над GF(256), полином 0x11D ----------
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11D);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}

// ---------- Кодирование данных ----------
function toUtf8(text) {
  return Array.from(new TextEncoder().encode(String(text)));
}

function chooseVersion(byteLen, ecc) {
  for (let ver = 1; ver <= 40; ver++) {
    const countBits = ver <= 9 ? 8 : 16;
    const needBits = 4 + countBits + byteLen * 8;
    if (needBits <= dataCodewords(ver, ecc) * 8) return ver;
  }
  throw new RangeError("Данные не помещаются в QR-код");
}

function buildDataCodewords(bytes, ver, ecc) {
  const bits = [];
  const push = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, ver <= 9 ? 8 : 16);
  bytes.forEach((b) => push(b, 8));

  const capacityBits = dataCodewords(ver, ecc) * 8;
  push(0, Math.min(4, capacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xEC; bits.length < capacityBits; pad ^= 0xEC ^ 0x11) push(pad, 8);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    codewords.push(v);
  }
  return codewords;
}

function addEccAndInterleave(data, ver, ecc) {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ECC[ecc]][ver];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ECC[ecc]][ver];
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks = [];
  const divisor = rsDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const eccBytes = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(eccBytes));
  }

  const result = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

// ---------- Матрица ----------
function alignmentPositions(ver) {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

function createGrid(size) {
  return Array.from({ length: size }, () => new Array(size).fill(false));
}

function drawFunctionPatterns(modules, isFn, ver, size) {
  const set = (x, y, dark) => { modules[y][x] = dark; isFn[y][x] = true; };

  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);

  const pos = alignmentPositions(ver);
  const n = pos.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  drawFormat(modules, isFn, size, "L", 0); // резервирует область формата
  drawVersion(modules, isFn, ver, size);
}

function drawFormat(modules, isFn, size, ecc, mask) {
  const set = (x, y, dark) => { modules[y][x] = dark; isFn[y][x] = true; };
  const data = (FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;

  for (let i = 0; i <= 5; i++) set(8, i, bit(bits, i));
  set(8, 7, bit(bits, 6));
  set(8, 8, bit(bits, 7));
  set(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(bits, i));

  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(bits, i));
  set(8, size - 8, true); // обязательный тёмный модуль
}

function drawVersion(modules, isFn, ver, size) {
  if (ver < 7) return;
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
  const bits = (ver << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const dark = bit(bits, i);
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    modules[b][a] = dark; isFn[b][a] = true;
    modules[a][b] = dark; isFn[a][b] = true;
  }
}

function drawCodewords(modules, isFn, data, size) {
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFn[y][x] && i < data.length * 8) {
          modules[y][x] = bit(data[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
];

function applyMask(modules, isFn, mask, size) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFn[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x];
    }
  }
}

function penalty(modules, size) {
  let score = 0;
  const line = (get) => {
    let run = 1;
    for (let i = 1; i < size; i++) {
      if (get(i) === get(i - 1)) {
        run++;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else run = 1;
    }
    // Шаблон, похожий на маркер позиционирования (1011101 + 4 светлых).
    const s = Array.from({ length: size }, (_, i) => (get(i) ? 1 : 0)).join("");
    for (const p of ["10111010000", "00001011101"]) {
      let from = 0;
      while ((from = s.indexOf(p, from)) !== -1) { score += 40; from++; }
    }
  };
  for (let y = 0; y < size; y++) line((i) => modules[y][i]);
  for (let x = 0; x < size; x++) line((i) => modules[i][x]);

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
    }
  }

  let dark = 0;
  modules.forEach((row) => row.forEach((c) => { if (c) dark++; }));
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

// Возвращает { size, version, modules } — modules[y][x] === true для тёмного модуля.
export function qrMatrix(text, { ecc = "M", mask: forcedMask = null } = {}) {
  if (!(ecc in ECC)) throw new RangeError("Неизвестный уровень коррекции: " + ecc);
  const bytes = toUtf8(text);
  const ver = chooseVersion(bytes.length, ecc);
  const size = ver * 4 + 17;

  const codewords = addEccAndInterleave(buildDataCodewords(bytes, ver, ecc), ver, ecc);

  const base = createGrid(size);
  const isFn = createGrid(size);
  drawFunctionPatterns(base, isFn, ver, size);
  drawCodewords(base, isFn, codewords, size);

  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    if (forcedMask !== null && mask !== forcedMask) continue;
    const modules = base.map((row) => row.slice());
    applyMask(modules, isFn, mask, size);
    drawFormat(modules, createGrid(size), size, ecc, mask);
    const score = penalty(modules, size);
    if (score < bestScore) { bestScore = score; best = modules; }
  }
  return { size, version: ver, modules: best };
}

// SVG-строка. border — «тихая зона» в модулях (по стандарту не меньше 4).
export function qrToSvg(text, { ecc = "M", border = 4, dark = "#000000", light = "#ffffff" } = {}) {
  const { size, modules } = qrMatrix(text, { ecc });
  const total = size + border * 2;
  let path = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) path += `M${x + border},${y + border}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">`
    + `<rect width="100%" height="100%" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}

export function qrToDataUrl(text, options) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(qrToSvg(text, options));
}
