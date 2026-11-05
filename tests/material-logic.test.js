import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateBlock, validatePage, validateMaterial,
  pageTextLength, pageFillRatio, hasImageWithCaption,
  materialProgress, markerReleased,
  PAGE_MIN_TEXT, PAGE_MAX_TEXT
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
