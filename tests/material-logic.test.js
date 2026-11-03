import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateBlock, validatePage, validateMaterial,
  pageTextLength, pageFillRatio, hasImageWithCaption,
  materialProgress, markerReleased,
  PAGE_MIN_TEXT, PAGE_MAX_TEXT, paginateText, textToBlocks, PAGE_TARGET_TEXT
} from "../core/material-logic.js";

const longText = (n, ch = "а") => ch.repeat(n);

test("validatePage: пустая страница не сохраняется", () => {
  assert.ok(validatePage([]).length > 0);
  assert.ok(validatePage([{ type: "paragraph", text: "" }]).length > 0);
});

test("validatePage: короткий текст — минимум 200 символов", () => {
  assert.ok(validatePage([{ type: "paragraph", text: longText(199) }]).length > 0);
  assert.equal(validatePage([{ type: "paragraph", text: longText(200) }]).length, 0);
});

test("validatePage: картинка с подписью заменяет порог текста", () => {
  const withImage = [{ type: "image", src: "data:image/jpeg;base64,AAA", caption: "Рис. 1. Перегон" }];
  assert.equal(validatePage(withImage).length, 0);
  assert.ok(hasImageWithCaption(withImage));
  // Без подписи — не считается.
  assert.ok(validatePage([{ type: "image", src: "data:image/jpeg;base64,AAA", caption: "" }]).length > 0);
});

test("validatePage: максимум ~1200 символов", () => {
  assert.ok(validatePage([{ type: "paragraph", text: longText(PAGE_MAX_TEXT + 1) }]).some(e => /длинн/.test(e)));
  assert.equal(validatePage([{ type: "paragraph", text: longText(PAGE_MAX_TEXT) }]).length, 0);
});

test("validateBlock: все шесть типов блоков распознаются", () => {
  const blocks = [
    { type: "heading", text: "Раздел" },
    { type: "paragraph", text: "Текст." },
    { type: "list", items: ["один", "два"] },
    { type: "callout", kind: "info", text: "Заметка." },
    { type: "callout", kind: "warning", text: "Осторожно." },
    { type: "callout", kind: "rule", text: "Устав, п. 1." },
    { type: "image", src: "https://example.com/a.jpg", caption: "Схема." },
    { type: "quote", text: "Цитата." }
  ];
  for (const block of blocks) {
    assert.deepEqual(validateBlock(block), [], block.type);
  }
});

test("validateBlock: вызов только info/warning/rule, картинка требует https", () => {
  assert.ok(validateBlock({ type: "callout", kind: "danger", text: "x" }).length > 0);
  assert.ok(validateBlock({ type: "image", src: "http://insecure.example.com/a.jpg", caption: "x" }).length > 0,
    "http-ссылки наружу запрещены");
  assert.ok(validateBlock({ type: "unknown" }).length > 0);
});

test("validateMaterial: pageCount и ошибки страниц с номерами", () => {
  const errors = validateMaterial({ pageCount: 2, pages: [[], [{ type: "paragraph", text: longText(300) }]] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Страница 1/);
  assert.ok(validateMaterial({ pageCount: 0, pages: [] }).length > 0);
});

test("pageFillRatio: индикатор заполненности", () => {
  assert.equal(pageFillRatio([]), 0);
  assert.ok(pageFillRatio([{ type: "paragraph", text: longText(100) }]) < 1);
  assert.equal(pageFillRatio([{ type: "paragraph", text: longText(400) }]), 1);
  assert.equal(pageFillRatio([{ type: "image", src: "https://x/y.jpg", caption: "Есть подпись" }]), 1);
});

test("materialProgress: completed только на последней странице", () => {
  const pages = [1, 2, 3];
  assert.deepEqual(materialProgress(pages, 0), { lastPage: 0, completed: false });
  assert.deepEqual(materialProgress(pages, 1), { lastPage: 1, completed: false });
  assert.deepEqual(materialProgress(pages, 2), { lastPage: 2, completed: true });
  // Импортированный прогресс не уводит за пределы книги.
  assert.equal(materialProgress(pages, 99).lastPage, 2);
  assert.equal(materialProgress([], 0).completed, false);
});

test("markerReleased: срок маркера освобождает материал", () => {
  const now = Date.now();
  assert.equal(markerReleased({ attemptId: "a", deadlineAt: { toMillis: () => now - 1000 } }, now), true);
  assert.equal(markerReleased({ attemptId: "a", deadlineAt: { toMillis: () => now + 1000 } }, now), false);
  // Через секунды-числа тоже работает.
  assert.equal(
    markerReleased({ attemptId: "a", deadlineAt: { seconds: Math.floor((now - 1000) / 1000) } }, now),
    true
  );
});

test("pageTextLength: список и подпись считаются, заголовок не добирает", () => {
  const t = pageTextLength([
    { type: "heading", text: longText(60) },
    { type: "list", items: ["один два три", "четыре"] },
    { type: "image", src: "https://x/y", caption: "подпись" }
  ]);
  assert.ok(t > 0);
  // 60-й заголовок даёт только 20 символов сверх 40.
  assert.equal(t, 20 + "один два три".length + 1 + "четыре".length + "подпись".length);
});

const sample = (n) => "Тормозная система предназначена для остановки поезда. ".repeat(n);

test("paginateText: пустой текст — нет страниц", () => {
  assert.deepEqual(paginateText(""), []);
  assert.deepEqual(paginateText("   \n\n  "), []);
});

test("paginateText: длинный текст режется, каждая страница проходит validatePage", () => {
  const text = [
    "Тормозная система",
    sample(30),
    "Основные узлы\n- Компрессор\n- Кран машиниста\n- Воздухораспределитель",
    "Проверка",
    sample(40),
    sample(12)
  ].join("\n\n");
  const pages = paginateText(text);
  assert.ok(pages.length >= 3);
  pages.forEach((blocks, i) => {
    assert.deepEqual(validatePage(blocks), [], `страница ${i + 1}`);
    assert.ok(pageTextLength(blocks.filter(b => b.type !== "heading")) <= PAGE_MAX_TEXT);
  });
});

test("paginateText: заголовок не остаётся один в конце страницы", () => {
  const pages = paginateText([sample(16), "Новый раздел", sample(16)].join("\n\n"));
  pages.forEach(blocks => {
    assert.notEqual(blocks[blocks.length - 1].type, "heading");
  });
});

test("paginateText: один огромный абзац без точек режется без потерь символов", () => {
  const word = "слово ";
  const text = word.repeat(1000).trim();
  const pages = paginateText(text);
  const joined = pages.flat().map(b => b.text).join(" ");
  assert.equal(joined.replace(/\s+/g, " "), text);
  pages.forEach(blocks => assert.deepEqual(validatePage(blocks), []));
});

test("textToBlocks: # заголовок, список, склейка строк с переносами", () => {
  const blocks = textToBlocks("# Глава 1\n\n- один\n- два\n\nпервая строка\nвторая строка.");
  assert.deepEqual(blocks.map(b => b.type), ["heading", "list", "paragraph"]);
  assert.deepEqual(blocks[1].items, ["один", "два"]);
  assert.equal(blocks[2].text, "первая строка вторая строка.");
});

test("paginateText: текст без пустых строк — каждая строка абзац", () => {
  const pages = paginateText([sample(8), sample(8), sample(8)].join("\n"));
  assert.ok(pages.flat().every(b => b.type === "paragraph"));
  assert.ok(pages.length >= 2);
});

test("paginateText: короткий хвост приклеивается к предыдущей странице", () => {
  const pages = paginateText(sample(17) + "\n\n" + "Конец раздела, итоговое замечание.");
  pages.forEach(blocks => assert.ok(pageTextLength(blocks) >= PAGE_MIN_TEXT || pages.length === 1));
  assert.ok(PAGE_TARGET_TEXT < PAGE_MAX_TEXT);
});
