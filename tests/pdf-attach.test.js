// tests/pdf-attach.test.js — прикрепление PDF к материалу: причины, по
// которым «PDF не прикреплялся» (тип файла с телефона, неактивная кнопка у
// нового материала, невозможность создать материал без текста).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pdfFileError, pdfMimeOk } from "../core/material-library-logic.js";
import { validatePage } from "../core/material-logic.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const editor = fs.readFileSync(path.join(root, "ui/pages/material-editor.js"), "utf8");
const HEAD = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31];
const file = (type, extra = {}) => ({ name: "doc.pdf", type, size: 1000, headerBytes: new Uint8Array(HEAD), ...extra });

test("PDF с телефона/мессенджера (octet-stream) принимается, если внутри настоящий PDF", () => {
  for (const type of ["application/octet-stream", "binary/octet-stream", "application/download", "application/pdf", ""]) {
    assert.equal(pdfFileError(file(type)), null, type);
  }
});

test("чужие типы и «переименованные» файлы по-прежнему отклоняются", () => {
  for (const type of ["application/zip", "text/html", "image/png", "application/msword"]) {
    assert.match(pdfFileError(file(type)), /не похоже на PDF/i, type);
  }
  assert.equal(pdfMimeOk("application/octet-stream"), true);
  // Тип общий, но подписи %PDF- нет — это не PDF.
  assert.match(pdfFileError(file("application/octet-stream", { headerBytes: new Uint8Array([1, 2, 3, 4, 5, 6]) })), /не является PDF/i);
  assert.match(pdfFileError(file("application/pdf", { size: 5 * 1024 * 1024 })), /больше 4 МБ/);
});

test("редактор: кнопка PDF активна у нового материала, файл выбирается заранее и прикрепляется при создании", () => {
  assert.ok(!/pdfUploadBtn = h\("button"[^)]*disabled: isNew/.test(editor), "кнопка не блокируется у нового материала");
  assert.match(editor, /type: "file"[^}]*style: "display:none"/, "голый input скрыт");
  assert.match(editor, /accept: "\.pdf,application\/pdf,application\/octet-stream"/);
  assert.match(editor, /pendingPdf = file;/);
  assert.match(editor, /прикрепится при создании материала/);
  const created = editor.slice(editor.indexOf('toast("Материал создан"'));
  assert.match(created, /if \(pendingPdf\) \{[\s\S]*?await attachPdf\(file\);/, "после создания PDF загружается автоматически");
});

test("материал только из PDF: страница-заглушка проходит проверку страницы (правила требуют ≥ 1 страницы)", () => {
  const m = /const PDF_ONLY_PAGE_TEXT = "([^"]+)";/.exec(editor);
  assert.ok(m, "заглушка объявлена");
  assert.deepEqual(validatePage([{ type: "paragraph", text: m[1] }]), []);
  assert.match(editor, /if \(pendingPdf && !state\.pages\.some\(blocks => !validatePage\(blocks\)\.length\)\)/);
});
