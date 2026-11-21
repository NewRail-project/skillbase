// core/slides-client.js — браузерная часть импорта слайдов: ленивая загрузка
// pdf.js, рендер страниц PDF в картинки и сжатие картинок через canvas.
// Чистая логика (лимиты, подбор параметров сжатия) — core/slides-logic.js.
// Без Firebase: модуль только превращает файлы в готовые data-URL.
//
// pdf.js: версия закреплена (3.11.174 — последняя с обычным <script>-бандлом,
// без ES-модулей), грузится только при выборе PDF и с cdnjs.cloudflare.com.
//   - Сам скрипт подключается с integrity (SRI, sha512) и crossorigin;
//   - воркер скачивается fetch с тем же контролем целостности и запускается
//     из blob: — кросс-доменный Worker напрямую создать нельзя;
//   - sw.js кросс-доменные запросы не перехватывает (см. isBypassed), так что
//     CDN не кешируется и не ломается; при желании «офлайн» файлы можно
//     положить в репозиторий и поменять два адреса ниже.
// Если на хостинг когда-нибудь добавят Content-Security-Policy, нужны:
//   script-src https://cdnjs.cloudflare.com; connect-src https://cdnjs.cloudflare.com;
//   worker-src blob:.
//
// ВНИМАНИЕ: контрольные суммы взяты из публичного примера подключения этой
// версии и в среде разработки (без сети) не сверялись с ответом cdnjs.
// Перед деплоем сверить: https://api.cdnjs.com/libraries/pdf.js/3.11.174?fields=sri
// Если сумма не совпадёт, браузер заблокирует файл и редактор покажет понятную
// ошибку — небезопасная загрузка невозможна.

import {
  SLIDE_MAX_DIM, SLIDE_TARGET_BYTES, SLIDE_HARD_BYTES,
  fitDimensions, pdfRenderScale, fitToBudget
} from "./slides-logic.js";

export const PDFJS_VERSION = "3.11.174";
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;
export const PDFJS_SCRIPT = { url: `${PDFJS_BASE}/pdf.min.js`, integrity: "sha512-q+4liFwdPC/bNdhUpZx6aXDx/h77yEQtn4I1slHydcbZK34nLaR3cAeYSJshoxIOq3mjEf7xJE8YWIUHMn+oCQ==" };
export const PDFJS_WORKER = { url: `${PDFJS_BASE}/pdf.worker.min.js`, integrity: "sha512-BbrZ76UNZq5BhH7LL7pn9A4TKQpQeNCHOo65/akfelcIBbcVvYWOFQKPXIrykE3qZxYjmDX573oa4Ywsc7rpTw==" };

let pdfJsPromise = null;

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function loadScript({ url, integrity }) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.integrity = integrity;
    script.crossOrigin = "anonymous";
    script.referrerPolicy = "no-referrer";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error("Не удалось загрузить библиотеку для чтения PDF (нет сети или файл заблокирован). Проверьте интернет и повторите."));
    };
    document.head.appendChild(script);
  });
}

// Загружает pdf.js один раз; повторные вызовы возвращают тот же промис.
// При неудаче промис сбрасывается — можно повторить без перезагрузки страницы.
export function loadPdfJs() {
  if (pdfJsPromise) return pdfJsPromise;
  pdfJsPromise = (async () => {
    if (!window.pdfjsLib) await loadScript(PDFJS_SCRIPT);
    const lib = window.pdfjsLib;
    if (!lib?.getDocument) throw new Error("Библиотека PDF загружена некорректно.");
    if (!lib.GlobalWorkerOptions.workerSrc) {
      let response;
      try {
        response = await fetch(PDFJS_WORKER.url, { integrity: PDFJS_WORKER.integrity, credentials: "omit", referrerPolicy: "no-referrer" });
      } catch (_) {
        throw new Error("Не удалось загрузить модуль чтения PDF (нет сети или файл заблокирован).");
      }
      if (!response.ok) throw new Error("Не удалось загрузить модуль чтения PDF.");
      const blob = new Blob([await response.arrayBuffer()], { type: "text/javascript" });
      lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
    }
    return lib;
  })().catch(err => { pdfJsPromise = null; throw err; });
  return pdfJsPromise;
}

// ---------- Кодирование canvas ----------

// WebP предпочтительнее (чётче текст при том же размере), но не везде
// поддерживается canvas.toDataURL: тогда браузер молча отдаёт PNG — это
// проверяем по префиксу и откатываемся на JPEG.
let webpSupported = null;
function canvasSupportsWebp() {
  if (webpSupported !== null) return webpSupported;
  try {
    const probe = document.createElement("canvas");
    probe.width = probe.height = 2;
    webpSupported = probe.toDataURL("image/webp", 0.5).startsWith("data:image/webp");
  } catch (_) {
    webpSupported = false;
  }
  return webpSupported;
}

function makeEncoder(source, naturalWidth, naturalHeight) {
  const useWebp = canvasSupportsWebp();
  return async ({ width, height, quality }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#ffffff"; // прозрачность PNG/PDF → белый фон (JPEG не знает альфа-канала)
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, naturalWidth, naturalHeight, 0, 0, width, height);
    const dataUrl = canvas.toDataURL(useWebp ? "image/webp" : "image/jpeg", quality);
    canvas.width = canvas.height = 0; // освободить память сразу
    await tick();
    return { dataUrl };
  };
}

// Сжимает источник (Image или canvas) до бюджета слайда → { src, bytes, width, height }.
async function compressSource(source, naturalWidth, naturalHeight) {
  const target = fitDimensions(naturalWidth, naturalHeight, SLIDE_MAX_DIM);
  const result = await fitToBudget(makeEncoder(source, naturalWidth, naturalHeight), {
    width: target.width, height: target.height, target: SLIDE_TARGET_BYTES, hard: SLIDE_HARD_BYTES
  });
  return { src: result.dataUrl, bytes: result.bytes, width: result.width, height: result.height };
}

// ---------- Изображения ----------

async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`«${file.name}»: не удалось открыть изображение.`));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Файл-картинка → слайд. Ошибка одного файла не должна ронять весь набор,
// поэтому вызывающий код ловит её и продолжает (см. imageFilesToSlides).
export async function imageFileToSlide(file) {
  const img = await loadImage(file);
  const done = await compressSource(img, img.naturalWidth, img.naturalHeight);
  return { ...done, name: file.name };
}

// onProgress(done, total). Возвращает { slides, failed:[{name,message}] }.
export async function imageFilesToSlides(files, { onProgress, maxCount = Infinity, isCancelled } = {}) {
  const slides = [];
  const failed = [];
  const list = files.slice(0, maxCount);
  let done = 0;
  onProgress?.(0, list.length);
  for (const file of list) {
    if (isCancelled?.()) break;
    try {
      slides.push(await imageFileToSlide(file));
    } catch (err) {
      failed.push({ name: file.name, message: err?.message || "Не удалось обработать файл." });
    }
    onProgress?.(++done, list.length);
    await tick();
  }
  return { slides, failed };
}

// ---------- PDF ----------

// Открывает PDF и сообщает число страниц, ничего не рендеря.
export async function openPdf(file) {
  const lib = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  try {
    const doc = await lib.getDocument({ data }).promise;
    return doc;
  } catch (err) {
    if (err?.name === "PasswordException") throw new Error("PDF защищён паролем. Снимите защиту и загрузите снова.");
    if (err?.name === "InvalidPDFException") throw new Error("Файл повреждён или не является PDF.");
    throw new Error(`Не удалось открыть PDF${err?.message ? `: ${err.message}` : "."}`);
  }
}

// Рендерит страницы PDF (с 1 по limit) в слайды по одной, сразу сжимая:
// в памяти одновременно живёт одна страница. onProgress(done, total).
export async function pdfToSlides(doc, { limit = doc.numPages, onProgress, isCancelled } = {}) {
  const total = Math.min(doc.numPages, limit);
  const slides = [];
  const failed = [];
  onProgress?.(0, total);
  for (let n = 1; n <= total; n++) {
    if (isCancelled?.()) break;
    let page = null;
    try {
      page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = pdfRenderScale(base.width, base.height, SLIDE_MAX_DIM);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const done = await compressSource(canvas, canvas.width, canvas.height);
      canvas.width = canvas.height = 0;
      slides.push({ ...done, name: `стр. ${n}` });
    } catch (err) {
      failed.push({ name: `страница ${n}`, message: err?.message || "Не удалось отрисовать страницу." });
    } finally {
      try { page?.cleanup(); } catch (_) { /* пусто */ }
    }
    onProgress?.(n, total);
    await tick();
  }
  try { await doc.destroy(); } catch (_) { /* пусто */ }
  return { slides, failed };
}
