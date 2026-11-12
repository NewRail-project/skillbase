// tests/material-library.test.js — этап 3: библиотека материалов.
// Проверяет чистую логику core/material-library-logic.js: статусы
// (черновик/опубликован/архив), видимость для студента, привязку к
// предмету/теме, оглавление книги, PDF-лимиты и автосохраняемый
// черновик редактора. Граница безопасности — firestore.rules
// (соответствующие кейсы в tools/rules-test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import {
  MATERIAL_STATUS_DRAFT, MATERIAL_STATUS_PUBLISHED, MATERIAL_STATUS_ARCHIVED,
  normalizeStatus, isPublished, visibleMaterials, sortMaterials,
  validateMaterialMeta, materialMetaPatch,
  deriveChapters, hasToc, LEVEL_CHAPTER, LEVEL_SUB,
  PDF_MAX_BYTES, pdfChunkCount, isValidPdfName,
  draftKeyFor, serializeEditorDraft, parseEditorDraft, draftIsNewer
} from "../core/material-library-logic.js";
import { paginateText, validatePage } from "../core/material-logic.js";

// ---------- Создание материала ----------

test("создание: карточка без названия отклоняется", () => {
  assert.ok(validateMaterialMeta({ title: "  " }, false).some(e => e.includes("Название")));
});

test("создание: материал обязан иметь хотя бы одну страницу", () => {
  const errors = validateMaterialMeta({ title: "Инструктаж" }, true);
  assert.ok(errors.some(e => e.includes("одну страницу")));
  const ok = validateMaterialMeta({ title: "Инструктаж", pages: [[]] }, true);
  assert.ok(!ok.some(e => e.includes("одну страницу")));
});

// ---------- Редактирование ----------

test("редактирование: длинные название и описание отклоняются", () => {
  assert.ok(validateMaterialMeta({ title: "а".repeat(161) }, false).length > 0);
  assert.ok(validateMaterialMeta({
    title: "Норма", description: "б".repeat(601)
  }, false).some(e => e.includes("Описание")));
  assert.equal(validateMaterialMeta({
    title: "Норма", description: "б".repeat(600)
  }, false).length, 0);
});

// ---------- Черновик ----------

test("черновик: неизвестный статус нормализуется, сохранение берёт ключ по id", () => {
  assert.equal(normalizeStatus("chernovik"), MATERIAL_STATUS_DRAFT);
  assert.equal(normalizeStatus("published"), MATERIAL_STATUS_PUBLISHED);
  assert.equal(normalizeStatus(undefined, MATERIAL_STATUS_PUBLISHED), MATERIAL_STATUS_PUBLISHED);
  assert.equal(draftKeyFor(""), "sb-mat-draft:new");
  assert.equal(draftKeyFor("abc123"), "sb-mat-draft:abc123");
});

// ---------- Публикация и архивация ----------

test("публикация: книга теста без поля status считается опубликованной", () => {
  assert.equal(isPublished({}), true);
  assert.equal(isPublished({ status: MATERIAL_STATUS_PUBLISHED }), true);
  assert.equal(isPublished({ status: MATERIAL_STATUS_DRAFT }), false);
  assert.equal(isPublished({ status: MATERIAL_STATUS_ARCHIVED }), false);
});

test("архивация: студенту не виден архив, сотруднику виден", () => {
  const items = [
    { id: "1", title: "А", status: MATERIAL_STATUS_PUBLISHED, order: 2 },
    { id: "2", title: "Б", status: MATERIAL_STATUS_DRAFT, order: 1 },
    { id: "3", title: "В", status: MATERIAL_STATUS_ARCHIVED, order: 0 }
  ];
  assert.deepEqual(visibleMaterials(items, "student").map(m => m.id), ["1"]);
  assert.deepEqual(visibleMaterials(items, "teacher").map(m => m.id), ["1", "2", "3"]);
});

test("архивация: статус проходит нормализацию в обе стороны", () => {
  assert.equal(normalizeStatus(MATERIAL_STATUS_ARCHIVED), MATERIAL_STATUS_ARCHIVED);
  assert.equal(normalizeStatus("published"), MATERIAL_STATUS_PUBLISHED);
});

// ---------- Привязка к предмету и теме ----------

test("привязка: тема без предмета отклоняется", () => {
  const errors = validateMaterialMeta({ title: "Т", topicId: "topic1" }, false);
  assert.ok(errors.some(e => e.includes("предмет")));
});

test("привязка: корректная пара предмет/тема и пустая привязка проходят", () => {
  assert.equal(validateMaterialMeta({ title: "Т", subjectId: "s1", topicId: "t1" }, false).length, 0);
  assert.equal(validateMaterialMeta({ title: "Т", subjectId: "", topicId: "" }, false).length, 0);
  assert.ok(validateMaterialMeta({ title: "Т", subjectId: "a b" }, false).length > 0);
  assert.ok(validateMaterialMeta({ title: "Т", subjectId: "s/s" }, false).length > 0);
  assert.ok(validateMaterialMeta({ title: "Т", order: -1 }, false).length > 0);
  assert.ok(validateMaterialMeta({ title: "Т", order: 1.5 }, false).length > 0);
});

test("привязка: патч пишет предмет/тему всегда — null снимает привязку", () => {
  const patch = materialMetaPatch({ title: "Т" });
  assert.equal(patch.subjectId, null);
  assert.equal(patch.topicId, null);
  assert.equal(patch.order, 0);
  const withIds = materialMetaPatch({ title: "Т", subjectId: "s1", topicId: "t1", order: 5, status: "draft" });
  assert.equal(withIds.subjectId, "s1");
  assert.equal(withIds.topicId, "t1");
  assert.equal(withIds.order, 5);
  assert.equal(withIds.status, MATERIAL_STATUS_DRAFT);
});

// ---------- Каталог ----------

test("каталог: сортировка по порядку, затем по названию", () => {
  const sorted = sortMaterials([
    { title: "Бета", order: 1 },
    { title: "Альфа", order: 1 },
    { title: "Дельта", order: 0 }
  ]);
  assert.deepEqual(sorted.map(m => m.title), ["Дельта", "Альфа", "Бета"]);
});

// ---------- Импорт TXT и структура книги ----------

const TXT = `Глава 1. Порядок осмотра локомотива
Перед выездом машинист осматривает экипажную часть. Осмотр проводится в следующем порядке:
- колёсные пары;
- буксовые узлы;
- тормозное оборудование.
Глава 2. Подготовка тормозов
Тормозную магистраль проверяют на плотность. Давление должно соответствовать норме, указанной в инструкции.
`;

test("импорт TXT: текст разбивается на валидные страницы книги", () => {
  const pages = paginateText(TXT);
  assert.ok(pages.length >= 1);
  pages.forEach((blocks, i) => {
    assert.deepEqual(validatePage(blocks), [], `страница ${i + 1} должна проходить валидацию`);
  });
});

test("структура книги: главы из TXT попадают в оглавление с номером страницы", () => {
  const pages = paginateText(TXT);
  const chapters = deriveChapters(pages);
  assert.equal(chapters.length, 2);
  assert.match(chapters[0].title, /Глава 1/);
  assert.equal(chapters[0].page, 0);
  assert.ok(chapters[1].page >= chapters[0].page);
  assert.equal(hasToc(pages), true);
});

test("структура книги: подзаголовок (level 2) не входит в оглавление", () => {
  const pages = [[
    { type: "heading", text: "Глава", level: LEVEL_CHAPTER },
    { type: "heading", text: "Подраздел", level: LEVEL_SUB },
    { type: "paragraph", text: "Текст главы." }
  ]];
  const chapters = deriveChapters(pages);
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].title, "Глава");
});

test("структура книги: заголовки без уровня (старые книги) — главы", () => {
  const chapters = deriveChapters([[{ type: "heading", text: "Старая глава" }]]);
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].page, 0);
  assert.equal(hasToc([[{ type: "paragraph", text: "Одна страница без глав" }]]), false);
});

// ---------- PDF ----------

test("PDF: лимит размера и число кусочков", () => {
  assert.equal(pdfChunkCount(0), 0);
  assert.equal(pdfChunkCount(1), 1);
  assert.equal(pdfChunkCount(256 * 1024), 1);
  assert.equal(pdfChunkCount(256 * 1024 + 1), 2);
  assert.equal(pdfChunkCount(PDF_MAX_BYTES), 16);
});

test("PDF: имя файла проверяется", () => {
  assert.equal(isValidPdfName("material.pdf"), true);
  assert.equal(isValidPdfName("МАТЕРИАЛ.PDF"), true);
  assert.equal(isValidPdfName("a/b.pdf"), false);
  assert.equal(isValidPdfName("document.docx"), false);
  assert.equal(isValidPdfName(""), false);
});

// ---------- Восстановление черновика редактора ----------

test("черновик редактора: сериализация и восстановление сохраняют поля", () => {
  const draft = {
    title: "Инструктаж",
    description: "Описание",
    subjectId: "s1",
    topicId: "t1",
    order: 3,
    status: MATERIAL_STATUS_DRAFT,
    pages: [[{ type: "paragraph", text: "Текст" }]],
    savedAt: 1700000000000
  };
  const restored = parseEditorDraft(serializeEditorDraft(draft));
  assert.equal(restored.title, "Инструктаж");
  assert.equal(restored.description, "Описание");
  assert.equal(restored.subjectId, "s1");
  assert.equal(restored.topicId, "t1");
  assert.equal(restored.order, 3);
  assert.equal(restored.status, MATERIAL_STATUS_DRAFT);
  assert.deepEqual(restored.pages, draft.pages);
  assert.equal(restored.savedAt, 1700000000000);
});

test("черновик редактора: битый JSON и чужая структура не восстанавливаются", () => {
  assert.equal(parseEditorDraft("{битый json"), null);
  assert.equal(parseEditorDraft(null), null);
  assert.equal(parseEditorDraft("[]"), null);
  assert.equal(parseEditorDraft('{"pages": "не массив"}'), null);
});

test("черновик редактора: локальный новее документа Firestore — предлагается восстановление", () => {
  const doc = { updatedAtMs: 1700000000000 };
  assert.equal(draftIsNewer({ savedAt: 1700000050000 }, doc.updatedAtMs), true);
  assert.equal(draftIsNewer({ savedAt: 1699999900000 }, doc.updatedAtMs), false);
  assert.equal(draftIsNewer({ savedAt: 1700000001000 }, doc.updatedAtMs), false, "погрешность до 1 с не считается");
});
