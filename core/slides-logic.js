// core/slides-logic.js — чистая логика «слайдов» учебного материала.
// Без DOM, Firebase и сети: проверяется в Node (tests/slides-logic.test.js).
//
// Модель хранения (ничего нового в Firestore не добавляется):
//   слайд = обычная страница книги materials/{id}/pages/{n} =
//   { blocks: [ { type: "image", src: "data:image/…;base64,…",
//                 caption, slide: true }, (необязательно) { paragraph } ] }.
// Поэтому читалка, прогресс чтения и шлюз «материал перед тестом»
// (quiz.js → #material/<id>) работают со слайдами без отдельной системы,
// а правила pages/{n} (чтение — только опубликованное и вне попытки)
// действуют на слайды как на страницы книги.
//
// Размеры: документ Firestore ≤ 1 МиБ (1 048 576 байт). Картинка слайда
// жмётся до ориентира SLIDE_TARGET_BYTES (≈200 КБ), жёсткий предел —
// IMAGE_MAX_BYTES (300 КБ, как у validateBlock: src ≤ 500 000 символов).
// Запас до лимита документа — более чем в 3 раза.

import { IMAGE_MAX_BYTES, PAGE_MAX_TEXT } from "./material-logic.js";

export const FIRESTORE_DOC_LIMIT = 1_048_576;
export const SLIDE_DOC_SAFE_BYTES = 600 * 1024;       // с запасом ~40 % до лимита
export const SLIDE_TARGET_BYTES = 200 * 1024;         // ориентир сжатия
export const SLIDE_HARD_BYTES = IMAGE_MAX_BYTES;      // жёсткий предел картинки
export const SLIDE_MAX_COUNT = 40;                    // слайдов в одном материале
export const SLIDE_MAX_TOTAL_BYTES = 8 * 1024 * 1024; // суммарно картинок в материале
export const SLIDE_MAX_DIM = 1600;                    // длинная сторона, px
export const SLIDE_MIN_DIM = 640;                     // ниже не сжимаем размером
export const SLIDE_MAX_PIXELS = 2_600_000;            // потолок canvas на слабых телефонах
export const SLIDE_SRC_MAX_CHARS = 500_000;           // как validateBlock
export const SLIDE_SOURCE_IMAGE_MAX_BYTES = 20 * 1024 * 1024; // исходная картинка
export const SLIDE_SOURCE_PDF_MAX_BYTES = 30 * 1024 * 1024;   // исходный PDF (в базу не пишется)
export const SLIDE_CAPTION_MAX = 200;

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp)$/i;
const PDF_EXT_RE = /\.pdf$/i;

// ---------- Размеры ----------

// Размер data-URL в байтах (по длине base64-части).
export function dataUrlBytes(dataUrl) {
  const text = String(dataUrl ?? "");
  const comma = text.indexOf(",");
  if (comma < 0) return 0;
  const body = text.slice(comma + 1);
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(body.length * 3 / 4) - padding);
}

// Грубая оценка размера документа страницы в Firestore, байт
// (JSON в UTF-8 + запас на имена полей и служебные данные).
export function estimatePageDocBytes(blocks) {
  let json = "";
  try { json = JSON.stringify({ blocks: Array.isArray(blocks) ? blocks : [] }); } catch (_) { return Infinity; }
  let bytes = 0;
  for (let i = 0; i < json.length; i++) {
    const code = json.charCodeAt(i);
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
  }
  return bytes + 256;
}

export function formatMegabytes(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(1)} МБ`;
}

export function formatKilobytes(bytes) {
  return `${Math.round(Number(bytes || 0) / 1024)} КБ`;
}

// ---------- Распознавание страниц-слайдов ----------

export function isSlidePage(blocks) {
  const first = Array.isArray(blocks) ? blocks[0] : null;
  return first?.type === "image" && first.slide === true
    && typeof first.src === "string" && first.src.startsWith("data:image/");
}

// Сколько слайдов и сколько байт картинок в материале.
export function materialSlideStats(pages) {
  const list = Array.isArray(pages) ? pages : [];
  let slides = 0;
  let bytes = 0;
  list.forEach(blocks => {
    (Array.isArray(blocks) ? blocks : []).forEach(block => {
      if (block?.type === "image" && typeof block.src === "string" && block.src.startsWith("data:")) {
        bytes += dataUrlBytes(block.src);
      }
    });
    if (isSlidePage(blocks)) slides += 1;
  });
  return { slides, bytes };
}

export function hasInlineImages(pages) {
  return (Array.isArray(pages) ? pages : []).some(blocks =>
    (Array.isArray(blocks) ? blocks : []).some(block =>
      block?.type === "image" && String(block.src || "").startsWith("data:")));
}

// ---------- Файлы: тип, порядок, лимиты ----------

export function classifySourceFile(file) {
  const name = String(file?.name ?? "");
  const type = String(file?.type ?? "").toLowerCase();
  if (type === "application/pdf" || type === "application/x-pdf" || PDF_EXT_RE.test(name)) return "pdf";
  if (type.startsWith("image/") || IMAGE_EXT_RE.test(name)) return "image";
  return "other";
}

// «слайд2» раньше «слайд10»: сравнение с числами внутри имени.
export function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), "ru", { numeric: true, sensitivity: "base" });
}

export function sortFilesNatural(files) {
  return [...(files || [])].sort((a, b) => naturalCompare(a?.name, b?.name));
}

// Проверка выбранных файлов ДО тяжёлой обработки.
// Возвращает { ok, errors, files:[{file,kind}] }. PDF — не более одного
// (его страницы становятся слайдами), изображения — любое число в пределах лимита.
export function checkSourceFiles(files) {
  const errors = [];
  const accepted = [];
  const list = sortFilesNatural(files);
  if (!list.length) return { ok: false, errors: ["Выберите PDF или изображения."], files: [] };
  let pdfs = 0;
  list.forEach(file => {
    const kind = classifySourceFile(file);
    const name = file?.name || "файл";
    if (kind === "other") {
      errors.push(`«${name}»: нужен PDF или изображение (JPG, PNG, WebP).`);
    } else if (!Number(file?.size)) {
      errors.push(`«${name}»: файл пуст.`);
    } else if (kind === "pdf") {
      pdfs += 1;
      if (file.size > SLIDE_SOURCE_PDF_MAX_BYTES) {
        errors.push(`«${name}»: PDF больше ${formatMegabytes(SLIDE_SOURCE_PDF_MAX_BYTES)} (${formatMegabytes(file.size)}). Сожмите или разделите файл.`);
      } else accepted.push({ file, kind });
    } else if (file.size > SLIDE_SOURCE_IMAGE_MAX_BYTES) {
      errors.push(`«${name}»: изображение больше ${formatMegabytes(SLIDE_SOURCE_IMAGE_MAX_BYTES)}.`);
    } else accepted.push({ file, kind });
  });
  if (pdfs > 1) errors.push("Выберите один PDF за раз или набор изображений: смешивать несколько PDF нельзя.");
  if (pdfs && accepted.some(item => item.kind === "image")) {
    errors.push("PDF и изображения нельзя загружать вместе — выберите что-то одно.");
  }
  return { ok: errors.length === 0, errors, files: accepted };
}

// Сколько ещё слайдов можно добавить и хватит ли суммарного размера.
// existing — {slides, bytes} (materialSlideStats), incomingCount — сколько хотим добавить.
export function slideCapacity(existing, incomingCount) {
  const slides = Number(existing?.slides) || 0;
  const bytes = Number(existing?.bytes) || 0;
  const room = Math.max(0, SLIDE_MAX_COUNT - slides);
  const bytesRoom = Math.max(0, SLIDE_MAX_TOTAL_BYTES - bytes);
  const byBytes = Math.floor(bytesRoom / SLIDE_TARGET_BYTES);
  return {
    room,
    bytesRoom,
    allowed: Math.max(0, Math.min(room, byBytes, Number(incomingCount) || 0)),
    fits: incomingCount <= room && incomingCount * SLIDE_TARGET_BYTES <= bytesRoom
  };
}

export function capacityError(existing, incomingCount) {
  const cap = slideCapacity(existing, incomingCount);
  if (cap.fits) return null;
  if (incomingCount > cap.room) {
    return `Слишком много слайдов: в материале уже ${existing?.slides || 0}, добавить можно ещё ${cap.room} (максимум ${SLIDE_MAX_COUNT}).`;
  }
  return `Не хватит места: суммарный объём картинок материала ограничен ${formatMegabytes(SLIDE_MAX_TOTAL_BYTES)} `
    + `(сейчас ${formatMegabytes(existing?.bytes || 0)}). Уберите слайды или загрузите меньше.`;
}

// После сжатия: проверка суммарного объёма по фактическим размерам.
export function totalBytesError(existingBytes, newBytes) {
  const total = (Number(existingBytes) || 0) + (Number(newBytes) || 0);
  if (total <= SLIDE_MAX_TOTAL_BYTES) return null;
  return `Слайды занимают ${formatMegabytes(total)} — больше лимита ${formatMegabytes(SLIDE_MAX_TOTAL_BYTES)}. Уберите часть слайдов.`;
}

// ---------- Геометрия и сжатие ----------

// Целевой размер картинки: длинная сторона ≤ maxDim, пикселей ≤ SLIDE_MAX_PIXELS,
// без увеличения. Возвращает целые width/height ≥ 1.
export function fitDimensions(naturalWidth, naturalHeight, maxDim = SLIDE_MAX_DIM) {
  const w = Number(naturalWidth);
  const h = Number(naturalHeight);
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  let scale = Math.min(1, maxDim / Math.max(w, h));
  if (w * h * scale * scale > SLIDE_MAX_PIXELS) scale = Math.sqrt(SLIDE_MAX_PIXELS / (w * h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

// Масштаб рендера страницы PDF (scale для getViewport) под ширину слайда.
// pageWidth/pageHeight — размеры страницы при scale = 1.
export function pdfRenderScale(pageWidth, pageHeight, maxDim = SLIDE_MAX_DIM) {
  const target = fitDimensions(pageWidth, pageHeight, maxDim);
  if (!target.width) return 1;
  // PDF обычно меньше целевого разрешения — допускаем увеличение до ×4.
  const w = Number(pageWidth);
  const h = Number(pageHeight);
  let scale = Math.min(4, maxDim / Math.max(w, h));
  if (w * h * scale * scale > SLIDE_MAX_PIXELS) scale = Math.sqrt(SLIDE_MAX_PIXELS / (w * h));
  return Math.max(0.25, scale);
}

// Последовательность попыток сжатия: сначала качество при полном размере,
// затем уменьшение размера со средним качеством. Чистая функция —
// детерминированный список {scale, quality} (scale — доля от целевого размера).
export function compressionAttempts() {
  return [
    { scale: 1, quality: 0.82 },
    { scale: 1, quality: 0.72 },
    { scale: 1, quality: 0.62 },
    { scale: 0.85, quality: 0.62 },
    { scale: 0.7, quality: 0.6 },
    { scale: 0.55, quality: 0.55 },
    { scale: 0.45, quality: 0.5 }
  ];
}

// Подбор параметров сжатия под бюджет.
// encode({ width, height, quality }) → { dataUrl } (синхронно или Promise) —
// в браузере это canvas.toDataURL, в тестах — подставная функция.
// Возвращает первый результат ≤ target; если до target не дотянули, но
// есть результат ≤ hard — наименьший из них; иначе бросает понятную ошибку.
export async function fitToBudget(encode, { width, height, target = SLIDE_TARGET_BYTES, hard = SLIDE_HARD_BYTES } = {}) {
  if (typeof encode !== "function") throw new Error("Не задан способ сжатия.");
  if (!(width > 0) || !(height > 0)) throw new Error("Не удалось определить размер изображения.");
  let best = null;
  for (const attempt of compressionAttempts()) {
    const w = Math.max(1, Math.round(width * attempt.scale));
    const h = Math.max(1, Math.round(height * attempt.scale));
    if (Math.max(w, h) < SLIDE_MIN_DIM && best) break; // дальше мельчить бессмысленно
    const result = await encode({ width: w, height: h, quality: attempt.quality });
    const dataUrl = String(result?.dataUrl ?? "");
    const bytes = dataUrlBytes(dataUrl);
    if (!bytes) continue;
    if (!best || bytes < best.bytes) best = { dataUrl, bytes, width: w, height: h, quality: attempt.quality };
    if (bytes <= target) return best;
  }
  if (best && best.bytes <= hard && best.dataUrl.length <= SLIDE_SRC_MAX_CHARS) return best;
  throw new Error(`Не удалось сжать слайд до ${formatKilobytes(hard)}. Упростите картинку (меньше фото и градиентов) или разделите слайд.`);
}

// ---------- Сборка страниц ----------

export function defaultSlideCaption(number, name = "") {
  const base = String(name || "").replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_]+/g, " ").trim();
  const text = base ? `Слайд ${number}. ${base}` : `Слайд ${number}`;
  return text.slice(0, SLIDE_CAPTION_MAX);
}

// Блоки одной страницы-слайда. text — необязательный пояснительный текст.
export function slideBlocks({ src, caption, text = "", number = 1, name = "" }) {
  const blocks = [{
    type: "image",
    src: String(src),
    caption: String(caption || "").trim().slice(0, SLIDE_CAPTION_MAX) || defaultSlideCaption(number, name),
    slide: true
  }];
  // validatePage считает подпись картинки частью текста страницы:
  // пояснение урезаем так, чтобы вместе с подписью уложиться в PAGE_MAX_TEXT.
  const room = Math.max(0, PAGE_MAX_TEXT - blocks[0].caption.length);
  const note = String(text || "").trim().slice(0, room).trim();
  if (note) blocks.push({ type: "paragraph", text: note });
  return blocks;
}

// Список готовых картинок → страницы-слайды (нумерация продолжается с startNumber).
export function buildSlidePages(images, { startNumber = 1 } = {}) {
  return (Array.isArray(images) ? images : []).map((image, i) =>
    slideBlocks({ src: image.src, caption: image.caption, text: image.text, number: startNumber + i, name: image.name }));
}

// Проверка готовой страницы-слайда перед записью: картинка и размер документа.
export function slidePageError(blocks) {
  if (!isSlidePage(blocks)) return null; // обычная страница — проверяет validatePage
  const src = blocks[0].src;
  if (src.length > SLIDE_SRC_MAX_CHARS) return "Картинка слайда больше 300 КБ.";
  if (estimatePageDocBytes(blocks) > SLIDE_DOC_SAFE_BYTES) return "Слайд слишком тяжёлый для сохранения.";
  return null;
}

// ---------- Сигнатуры страниц (записываем только изменившиеся) ----------

// Два независимых 32-битных хэша строки: FNV-1a и djb2 → 64 бита + длина.
export function stringSignature(text) {
  const s = String(text ?? "");
  let a = 0x811c9dc5;
  let b = 5381;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a ^= c;
    a = Math.imul(a, 0x01000193) >>> 0;
    b = (Math.imul(b, 33) + c) >>> 0;
  }
  return `${s.length.toString(36)}.${a.toString(36)}.${b.toString(36)}`;
}

export function pageSignature(blocks) {
  let json = "";
  try { json = JSON.stringify(Array.isArray(blocks) ? blocks : []); } catch (_) { json = String(Math.random()); }
  return stringSignature(json);
}

export function pageSignatures(pages) {
  return (Array.isArray(pages) ? pages : []).map(pageSignature);
}

// Что писать в Firestore: changed — индексы страниц, которых нет в сохранённом
// состоянии или которые изменились; stale — лишние старые страницы к удалению.
// prevSignatures может быть null — тогда пишутся все страницы.
export function diffPages(prevSignatures, pages) {
  const sigs = pageSignatures(pages);
  const prev = Array.isArray(prevSignatures) ? prevSignatures : [];
  const changed = [];
  sigs.forEach((sig, i) => { if (prev[i] !== sig) changed.push(i); });
  const stale = [];
  for (let i = sigs.length; i < prev.length; i++) stale.push(i);
  return { changed, stale, signatures: sigs };
}

// ---------- Ход операции ----------

export function progressLabel(stage, done, total) {
  const n = Math.max(0, Number(done) || 0);
  const t = Math.max(0, Number(total) || 0);
  const tail = t ? ` ${Math.min(n, t)}/${t}` : "";
  switch (stage) {
    case "read": return `Читаем PDF…${tail}`;
    case "render": return `Готовим слайды:${tail}`;
    case "save": return `Сохраняем слайды:${tail}`;
    default: return `Обработка…${tail}`;
  }
}
