// tests/slides-logic.test.js — слайды перед тестом: чистая логика (разбиение,
// оценка размера, лимиты, подбор сжатия, сигнатуры страниц) и статическая
// проверка подключения к существующему потоку «материал перед тестом».
// Реальный рендер PDF и canvas в Node воспроизвести нельзя — проверяется
// логика вокруг них; живой прогон описан в отчёте.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  FIRESTORE_DOC_LIMIT, SLIDE_DOC_SAFE_BYTES, SLIDE_TARGET_BYTES, SLIDE_HARD_BYTES,
  SLIDE_MAX_COUNT, SLIDE_MAX_TOTAL_BYTES, SLIDE_MAX_DIM, SLIDE_MAX_PIXELS, SLIDE_SRC_MAX_CHARS,
  dataUrlBytes, estimatePageDocBytes, isSlidePage, materialSlideStats, hasInlineImages,
  classifySourceFile, sortFilesNatural, checkSourceFiles, slideCapacity, capacityError,
  totalBytesError, fitDimensions, pdfRenderScale, compressionAttempts, fitToBudget,
  defaultSlideCaption, slideBlocks, buildSlidePages, slidePageError,
  stringSignature, pageSignature, pageSignatures, diffPages, progressLabel
} from "../core/slides-logic.js";
import { validatePage, validateMaterial, IMAGE_MAX_BYTES } from "../core/material-logic.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = rel => readFileSync(path.join(ROOT, rel), "utf8");

// data-URL заданного размера в байтах (base64 из букв «A»).
function fakeDataUrl(bytes, mime = "image/webp") {
  const full = Math.floor(bytes / 3);
  const rest = bytes % 3;
  const tail = rest === 1 ? "AA==" : rest === 2 ? "AAA=" : "";
  return `data:${mime};base64,${"AAAA".repeat(full)}${tail}`;
}

// ---------- Размеры ----------

test("слайды: лимиты согласованы с Firestore и validateBlock", () => {
  assert.equal(FIRESTORE_DOC_LIMIT, 1024 * 1024);
  assert.ok(SLIDE_TARGET_BYTES >= 150 * 1024 && SLIDE_TARGET_BYTES <= 250 * 1024, "ориентир 150–250 КБ");
  assert.ok(SLIDE_HARD_BYTES <= IMAGE_MAX_BYTES);
  assert.ok(SLIDE_DOC_SAFE_BYTES < FIRESTORE_DOC_LIMIT * 0.6, "запас до лимита документа");
  assert.ok(SLIDE_MAX_COUNT * SLIDE_TARGET_BYTES <= SLIDE_MAX_TOTAL_BYTES + SLIDE_TARGET_BYTES);
});

test("dataUrlBytes: размер по base64, учитывает «=»", () => {
  assert.equal(dataUrlBytes(""), 0);
  assert.equal(dataUrlBytes("data:image/png;base64,"), 0);
  assert.equal(dataUrlBytes("data:image/png;base64,QUJD"), 3);   // "ABC"
  assert.equal(dataUrlBytes("data:image/png;base64,QUI="), 2);    // "AB"
  assert.equal(dataUrlBytes("data:image/png;base64,QQ=="), 1);    // "A"
  assert.equal(dataUrlBytes(fakeDataUrl(150_000)), 150_000);
  assert.equal(dataUrlBytes(fakeDataUrl(150_001)), 150_001);
  assert.equal(dataUrlBytes(fakeDataUrl(150_002)), 150_002);
});

test("estimatePageDocBytes: слайд с максимальной картинкой далеко от лимита 1 МиБ", () => {
  const blocks = slideBlocks({ src: fakeDataUrl(SLIDE_HARD_BYTES), caption: "Слайд", text: "я".repeat(1200), number: 1 });
  const size = estimatePageDocBytes(blocks);
  assert.ok(size < SLIDE_DOC_SAFE_BYTES, `размер ${size}`);
  assert.ok(size < FIRESTORE_DOC_LIMIT / 2);
  // кириллица считается 2 байтами на символ
  assert.ok(estimatePageDocBytes([{ type: "paragraph", text: "яяяя" }])
    > estimatePageDocBytes([{ type: "paragraph", text: "aaaa" }]));
  assert.equal(estimatePageDocBytes(null) > 0, true);
});

// ---------- Страницы-слайды ----------

test("slideBlocks: слайд проходит validatePage, подпись подставляется сама", () => {
  const blocks = slideBlocks({ src: fakeDataUrl(180_000), number: 3, name: "Тяговый_двигатель.png" });
  assert.deepEqual(validatePage(blocks), []);
  assert.equal(blocks[0].slide, true);
  assert.equal(blocks[0].caption, "Слайд 3. Тяговый двигатель");
  assert.equal(slideBlocks({ src: "data:image/webp;base64,AAAA", number: 1 })[0].caption, "Слайд 1");
  assert.equal(defaultSlideCaption(2, ""), "Слайд 2");
});

test("slideBlocks: картинка + текст; длинный текст урезается до лимита страницы", () => {
  const blocks = slideBlocks({ src: fakeDataUrl(100_000), text: "т".repeat(5000), number: 1 });
  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].type, "paragraph");
  assert.deepEqual(validatePage(blocks), []);
  assert.ok(blocks[0].caption.length + blocks[1].text.length <= 1200, "подпись + пояснение ≤ лимита страницы");
});

test("buildSlidePages: нумерация продолжается с startNumber, весь материал валиден", () => {
  const pages = buildSlidePages(
    [{ src: fakeDataUrl(90_000), name: "a.jpg" }, { src: fakeDataUrl(90_000), caption: "Свой заголовок" }],
    { startNumber: 5 });
  assert.equal(pages.length, 2);
  assert.match(pages[0][0].caption, /^Слайд 5/);
  assert.equal(pages[1][0].caption, "Свой заголовок");
  assert.deepEqual(validateMaterial({ pageCount: 2, pages }), []);
  assert.deepEqual(buildSlidePages(null), []);
});

test("isSlidePage / materialSlideStats / hasInlineImages", () => {
  const slide = slideBlocks({ src: fakeDataUrl(120_000), number: 1 });
  const plain = [{ type: "paragraph", text: "обычная страница" }];
  const photo = [{ type: "image", src: fakeDataUrl(60_000), caption: "фото" }];
  assert.equal(isSlidePage(slide), true);
  assert.equal(isSlidePage(plain), false);
  assert.equal(isSlidePage(photo), false, "обычная картинка книги — не слайд");
  assert.equal(isSlidePage([{ type: "image", src: "https://x/y.png", caption: "c", slide: true }]), false);
  const stats = materialSlideStats([slide, plain, photo, slide]);
  assert.equal(stats.slides, 2);
  assert.equal(stats.bytes, 120_000 * 2 + 60_000);
  assert.equal(hasInlineImages([plain]), false);
  assert.equal(hasInlineImages([plain, photo]), true);
  assert.deepEqual(materialSlideStats(null), { slides: 0, bytes: 0 });
});

test("slidePageError: тяжёлая картинка отклоняется до записи", () => {
  const ok = slideBlocks({ src: fakeDataUrl(SLIDE_HARD_BYTES - 1000), number: 1 });
  assert.equal(slidePageError(ok), null);
  const heavy = [{ type: "image", src: "data:image/webp;base64," + "A".repeat(SLIDE_SRC_MAX_CHARS + 10), caption: "x", slide: true }];
  assert.match(slidePageError(heavy), /300 КБ/);
  assert.equal(slidePageError([{ type: "paragraph", text: "обычная" }]), null);
});

// ---------- Файлы и лимиты ----------

test("classifySourceFile: PDF, картинка, прочее", () => {
  assert.equal(classifySourceFile({ name: "a.PDF", type: "" }), "pdf");
  assert.equal(classifySourceFile({ name: "x", type: "application/pdf" }), "pdf");
  assert.equal(classifySourceFile({ name: "a.jpeg", type: "" }), "image");
  assert.equal(classifySourceFile({ name: "a.webp", type: "image/webp" }), "image");
  assert.equal(classifySourceFile({ name: "a.docx", type: "application/msword" }), "other");
});

test("sortFilesNatural: слайд2 раньше слайд10", () => {
  const names = sortFilesNatural([{ name: "s10.png" }, { name: "s2.png" }, { name: "s1.png" }]).map(f => f.name);
  assert.deepEqual(names, ["s1.png", "s2.png", "s10.png"]);
});

test("checkSourceFiles: понятные ошибки", () => {
  assert.equal(checkSourceFiles([]).ok, false);
  const doc = checkSourceFiles([{ name: "отчёт.docx", size: 1000, type: "" }]);
  assert.equal(doc.ok, false);
  assert.match(doc.errors[0], /PDF или изображение/);
  assert.match(checkSourceFiles([{ name: "a.png", size: 0 }]).errors[0], /пуст/);
  assert.match(checkSourceFiles([{ name: "big.pdf", size: 40 * 1024 * 1024 }]).errors[0], /PDF больше/);
  assert.match(checkSourceFiles([{ name: "big.png", size: 25 * 1024 * 1024 }]).errors[0], /изображение больше/);
  const two = checkSourceFiles([{ name: "a.pdf", size: 5 }, { name: "b.pdf", size: 5 }]);
  assert.equal(two.ok, false);
  assert.match(two.errors.join(" "), /один PDF/);
  const mixed = checkSourceFiles([{ name: "a.pdf", size: 5 }, { name: "b.png", size: 5 }]);
  assert.equal(mixed.ok, false);
  assert.match(mixed.errors.join(" "), /вместе/);
});

test("checkSourceFiles: набор картинок принимается и упорядочивается", () => {
  const res = checkSourceFiles([{ name: "s10.jpg", size: 10 }, { name: "s2.jpg", size: 10 }]);
  assert.equal(res.ok, true);
  assert.deepEqual(res.files.map(item => item.file.name), ["s2.jpg", "s10.jpg"]);
  assert.ok(res.files.every(item => item.kind === "image"));
});

test("slideCapacity / capacityError: число слайдов и суммарный объём", () => {
  assert.equal(slideCapacity({ slides: 0, bytes: 0 }, 10).fits, true);
  assert.equal(slideCapacity({ slides: 35, bytes: 0 }, 10).room, 5);
  assert.equal(slideCapacity({ slides: 35, bytes: 0 }, 10).allowed, 5);
  assert.equal(capacityError({ slides: 0, bytes: 0 }, SLIDE_MAX_COUNT), null);
  assert.match(capacityError({ slides: 0, bytes: 0 }, SLIDE_MAX_COUNT + 1), /Слишком много слайдов/);
  assert.match(capacityError({ slides: 38, bytes: 0 }, 5), /добавить можно ещё 2/);
  // место по байтам: почти весь объём занят
  assert.match(capacityError({ slides: 5, bytes: SLIDE_MAX_TOTAL_BYTES - 100 * 1024 }, 3), /объём картинок/);
});

test("totalBytesError: фактический объём после сжатия", () => {
  assert.equal(totalBytesError(1000, 2000), null);
  assert.match(totalBytesError(SLIDE_MAX_TOTAL_BYTES, 1), /больше лимита/);
});

// ---------- Геометрия и сжатие ----------

test("fitDimensions: без увеличения, длинная сторона и пиксели ограничены", () => {
  assert.deepEqual(fitDimensions(800, 600), { width: 800, height: 600 });
  const big = fitDimensions(4000, 3000);
  assert.equal(Math.max(big.width, big.height), SLIDE_MAX_DIM);
  assert.ok(Math.abs(big.width / big.height - 4 / 3) < 0.01);
  const huge = fitDimensions(10000, 10000, 10000);
  assert.ok(huge.width * huge.height <= SLIDE_MAX_PIXELS * 1.01);
  assert.deepEqual(fitDimensions(0, 10), { width: 0, height: 0 });
});

test("pdfRenderScale: страница A4/16:9 рендерится под ширину слайда", () => {
  const a4 = pdfRenderScale(595, 842);      // A4 в pt
  assert.ok(a4 > 1 && a4 <= 4);
  assert.ok(Math.round(842 * a4) <= SLIDE_MAX_DIM + 1);
  const wide = pdfRenderScale(960, 540);    // PowerPoint 16:9
  assert.ok(Math.round(960 * wide) <= SLIDE_MAX_DIM + 1);
  assert.ok(960 * 540 * wide * wide <= SLIDE_MAX_PIXELS * 1.01);
  assert.equal(pdfRenderScale(0, 0), 1);
});

test("compressionAttempts: качество и размер только убывают", () => {
  const list = compressionAttempts();
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    assert.ok(b.scale <= a.scale && b.quality <= a.quality, `шаг ${i}`);
  }
});

// Подставной «кодировщик»: размер растёт с площадью и качеством.
function fakeEncode(bytesPerPixelAtQ1) {
  const calls = [];
  const encode = ({ width, height, quality }) => {
    calls.push({ width, height, quality });
    return { dataUrl: fakeDataUrl(Math.round(width * height * quality * bytesPerPixelAtQ1)) };
  };
  return { encode, calls };
}

test("fitToBudget: возвращает первый результат в пределах ориентира", async () => {
  const { encode, calls } = fakeEncode(0.12);   // 1600×900 q0.82 ≈ 141 КБ
  const result = await fitToBudget(encode, { width: 1600, height: 900 });
  assert.ok(result.bytes <= SLIDE_TARGET_BYTES);
  assert.equal(calls.length, 1);
});

test("fitToBudget: тяжёлая картинка уменьшается ступенями, итог ≤ ориентира", async () => {
  const { encode, calls } = fakeEncode(0.45);   // первые попытки тяжелее 200 КБ
  const result = await fitToBudget(encode, { width: 1600, height: 900 });
  assert.ok(calls.length > 1);
  assert.ok(result.bytes <= SLIDE_TARGET_BYTES, `bytes ${result.bytes}`);
  assert.ok(result.width < 1600 || result.quality < 0.82);
});

test("fitToBudget: если до ориентира не дотянули, но влезли в жёсткий предел — берёт наименьший", async () => {
  // размер не опускается ниже ~250 КБ: между ориентиром и жёстким пределом
  const encode = () => ({ dataUrl: fakeDataUrl(250 * 1024) });
  const result = await fitToBudget(encode, { width: 1600, height: 900 });
  assert.equal(result.bytes, 250 * 1024);
  assert.ok(result.bytes > SLIDE_TARGET_BYTES && result.bytes <= SLIDE_HARD_BYTES);
});

test("fitToBudget: слишком тяжёлый слайд — понятная ошибка, а не запись в Firestore", async () => {
  const encode = () => ({ dataUrl: fakeDataUrl(SLIDE_HARD_BYTES + 50_000) });
  await assert.rejects(fitToBudget(encode, { width: 1600, height: 900 }), /Не удалось сжать слайд/);
  await assert.rejects(fitToBudget(null, { width: 1, height: 1 }), /способ сжатия/);
  await assert.rejects(fitToBudget(() => ({ dataUrl: "" }), { width: 0, height: 0 }), /размер изображения/);
});

test("fitToBudget: пустой результат кодировщика пропускается", async () => {
  let n = 0;
  const encode = () => (++n === 1 ? { dataUrl: "" } : { dataUrl: fakeDataUrl(100_000) });
  const result = await fitToBudget(encode, { width: 1600, height: 900 });
  assert.equal(result.bytes, 100_000);
});

// ---------- Сигнатуры: пишем только изменившееся ----------

test("сигнатуры страниц: детерминированы и различают правки", () => {
  const a = slideBlocks({ src: fakeDataUrl(5000), caption: "Один", number: 1 });
  const b = slideBlocks({ src: fakeDataUrl(5000), caption: "Один", number: 1 });
  const c = slideBlocks({ src: fakeDataUrl(5000), caption: "Два", number: 1 });
  assert.equal(pageSignature(a), pageSignature(b));
  assert.notEqual(pageSignature(a), pageSignature(c));
  assert.notEqual(stringSignature("ab"), stringSignature("ba"));
  assert.equal(pageSignatures(null).length, 0);
});

test("diffPages: первая запись — все страницы; повторная — только изменённые и лишние", () => {
  const p1 = slideBlocks({ src: fakeDataUrl(4000), number: 1 });
  const p2 = slideBlocks({ src: fakeDataUrl(4500), number: 2 });
  const p3 = slideBlocks({ src: fakeDataUrl(5000), number: 3 });
  const first = diffPages(null, [p1, p2, p3]);
  assert.deepEqual(first.changed, [0, 1, 2]);
  assert.deepEqual(first.stale, []);

  const again = diffPages(first.signatures, [p1, p2, p3]);
  assert.deepEqual(again.changed, [], "ничего не изменилось — ничего не пишем");

  const edited = diffPages(first.signatures, [p1, [...p2.slice(0, 1), { type: "paragraph", text: "Пояснение к слайду" }], p3]);
  assert.deepEqual(edited.changed, [1]);

  const shrunk = diffPages(first.signatures, [p1]);
  assert.deepEqual(shrunk.changed, []);
  assert.deepEqual(shrunk.stale, [1, 2]);

  const grown = diffPages(first.signatures, [p1, p2, p3, slideBlocks({ src: fakeDataUrl(3000), number: 4 })]);
  assert.deepEqual(grown.changed, [3]);
});

test("progressLabel: подписи этапов", () => {
  assert.equal(progressLabel("render", 3, 10), "Готовим слайды: 3/10");
  assert.equal(progressLabel("save", 12, 10), "Сохраняем слайды: 10/10");
  assert.equal(progressLabel("read"), "Читаем PDF…");
});

// ---------- Подключение к существующей системе (статически) ----------

test("слайды: удаление материала каскадно стирает страницы (а слайды — это страницы) и файлы", () => {
  const lib = read("core/material-library.js");
  const del = lib.slice(lib.indexOf("export async function deleteLibraryMaterial"));
  assert.match(del.slice(0, 700), /for \(const sub of \["pages", "files"\]\)/);
  assert.match(del.slice(0, 900), /deleteDoc\(doc\(db, "materials", id\)\)/);
});

test("слайды: диф-сохранение пишет страницы порциями и валидирует каждую", () => {
  const lib = read("core/material-library.js");
  const start = lib.indexOf("export async function saveLibraryPagesDiff");
  const body = lib.slice(start, start + 2600);
  assert.match(body, /validateMaterial/);
  assert.match(body, /slidePageError/);
  assert.match(body, /diffPages\(signatures, pages\)/);
  assert.match(body, /concurrency/);
  assert.match(body, /onProgress/);
  // pageCount обновляется после записи страниц
  assert.ok(body.indexOf('"pages", String(n)') < body.lastIndexOf("pageCount: pages.length"));
});

test("слайды: редактор подключён к диф-сохранению, лимитам и прогрессу", () => {
  const editor = read("ui/pages/material-editor.js");
  assert.match(editor, /saveLibraryPagesDiff/);
  assert.match(editor, /checkSourceFiles/);
  assert.match(editor, /capacityError/);
  assert.match(editor, /totalBytesError/);
  assert.match(editor, /progressLabel\("render"\)|slideProgressReporter\("render"\)/);
  assert.match(editor, /slide-progress/);
  assert.match(editor, /LOCAL_DRAFT_MAX_CHARS/);
});

test("слайды: читалка и шлюз «материал перед тестом» не заменены, а расширены", () => {
  const reader = read("ui/pages/material.js");
  assert.match(reader, /isSlidePage/);
  assert.match(reader, /setHashGuard/, "hash-guard на месте");
  assert.match(reader, /touchstart/, "свайп на месте");
  assert.match(reader, /PageDown/);
  const quiz = read("ui/pages/quiz.js");
  assert.match(quiz, /materialCompleted\(State\.user\.uid, gateMaterialId\)/, "шлюз тот же");
  assert.doesNotMatch(read("core/materials.js"), /slides/i, "второй системы хранения нет");
});

test("слайды: pdf.js — закреплённая версия, SRI, только cdnjs, без @latest", () => {
  const client = read("core/slides-client.js");
  assert.match(client, /PDFJS_VERSION = "3\.11\.174"/);
  assert.match(client, /cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\//);
  assert.equal((client.match(/integrity: "sha512-/g) || []).length, 2, "SRI у скрипта и воркера");
  assert.match(client, /crossOrigin = "anonymous"/);
  assert.doesNotMatch(client, /latest|unpkg|esm\.sh/);
  // библиотека не подключается статически — только при выборе PDF
  assert.doesNotMatch(read("index.html"), /pdf\.js|pdf\.min/);
});

test("слайды: Service Worker не перехватывает кросс-доменный CDN", () => {
  const sw = read("sw.js");
  assert.match(sw, /url\.origin !== self\.location\.origin/);
});

test("слайды: правила pages/{n} не ослаблены (студент — только опубликованное вне попытки)", () => {
  const rules = read("firestore.rules");
  const start = rules.indexOf("match /pages/{n}");
  const block = rules.slice(start, rules.indexOf("match /files/{n}", start));
  assert.match(block, /get\("status", "published"\) == "published"/);
  assert.match(block, /!exists\(\s*\/databases\/\$\(database\)\/documents\/activeAttempts/);
  assert.match(block, /allow create, update: if isStaff\(\)/);
});

test("редактор блоков: поля добавляются через append (appendChild берёт только 1 аргумент)", () => {
  const editor = read("ui/pages/material-editor.js");
  assert.doesNotMatch(editor, /subFields\.appendChild\(/, "appendChild(a, b, …) теряет все аргументы, кроме первого");
  assert.ok((editor.match(/subFields\.append\(/g) || []).length >= 5);
});
