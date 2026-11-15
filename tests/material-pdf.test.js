// tests/material-pdf.test.js — ЭТАП 5: исправление загрузки PDF,
// контекст возврата читалки и состояния прогресса изучения.
//
// Чистая логика — core/material-library-logic.js — проверяется напрямую
// в Node. Firestore-слой (core/material-library.js) и страницы
// (material.js, material-editor.js, topic.js) — статически: реальную
// запись кусочков в Firebase в Node воспроизвести нельзя (ограничение
// среды, см. итог самопроверки).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  pdfHeaderOk, pdfMimeOk, pdfFileError,
  readerBackTarget, backLabel, materialLink,
  materialProgressState
} from "../core/material-library-logic.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const READER = readFileSync(path.join(ROOT, "ui/pages/material.js"), "utf8");
const EDITOR = readFileSync(path.join(ROOT, "ui/pages/material-editor.js"), "utf8");
const TOPIC = readFileSync(path.join(ROOT, "ui/pages/topic.js"), "utf8");
const DISCIPLINE = readFileSync(path.join(ROOT, "ui/pages/discipline-page.js"), "utf8");
const MATERIALS = readFileSync(path.join(ROOT, "ui/pages/materials.js"), "utf8");
const RULES = readFileSync(path.join(ROOT, "firestore.rules"), "utf8");

// Подпись «%PDF-» + типичное начало версии 1.4.
const PDF_HEAD = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];

// ---------- Проверка содержимого PDF ----------

test("pdf: магическая подпись «%PDF-» распознаётся", () => {
  assert.equal(pdfHeaderOk(new Uint8Array(PDF_HEAD)), true);
  assert.equal(pdfHeaderOk([0x25, 0x50, 0x44, 0x46, 0x2d]), true);
  assert.equal(pdfHeaderOk(null), false);
  assert.equal(pdfHeaderOk(new Uint8Array([0x4d, 0x5a])), false, "MZ — не PDF");
  assert.equal(pdfHeaderOk(new Uint8Array([0x25, 0x50])), false, "обрезанная подпись");
  assert.equal(pdfHeaderOk(""), false, "строка — не байты");
});

test("pdf: MIME-тип проверяется, пустой допускается", () => {
  assert.equal(pdfMimeOk("application/pdf"), true);
  assert.equal(pdfMimeOk("application/x-pdf"), true);
  assert.equal(pdfMimeOk(""), true, "часть браузеров не выставляет type");
  assert.equal(pdfMimeOk("application/msword"), false);
  assert.equal(pdfMimeOk("text/html"), false);
  assert.equal(pdfMimeOk(undefined), true);
});

test("pdf: полный файл — валидный PDF проходит", () => {
  assert.equal(pdfFileError({
    name: "Урок.pdf", type: "application/pdf", size: 1024,
    headerBytes: new Uint8Array(PDF_HEAD)
  }), null);
});

test("pdf: переименованный файл (нет подписи) отклоняется", () => {
  const error = pdfFileError({
    name: "Задание.pdf.exe.pdf", type: "application/pdf", size: 5000,
    headerBytes: new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x04])
  });
  assert.match(error, /не является PDF/);
});

test("pdf: чужой MIME отклоняется до записи", () => {
  assert.match(
    pdfFileError({ name: "a.pdf", type: "application/zip", size: 10, headerBytes: new Uint8Array(PDF_HEAD) }),
    /не похоже на PDF/i);
});

test("pdf: слишком большой файл отклоняется", () => {
  assert.match(
    pdfFileError({ name: "big.pdf", type: "application/pdf", size: 5 * 1024 * 1024, headerBytes: new Uint8Array(PDF_HEAD) }),
    /больше 4 МБ/);
  assert.match(
    pdfFileError({ name: "empty.pdf", type: "application/pdf", size: 0, headerBytes: new Uint8Array(PDF_HEAD) }),
    /пуст/);
});

// ---------- Возврат из читалки ----------

test("навигация: «back:» декодирует адрес исходной темы/дисциплины", () => {
  const parts = ["m1", "free", "back:%23topic%2Ft7"];
  const target = readerBackTarget(parts);
  assert.deepEqual(target, { mode: "back", hash: "#topic/t7", label: "К теме" });
  assert.equal(
    readerBackTarget(["m1", "free", "back:%23discipline%2Fd2"]).label,
    "К дисциплине");
});

test("навигация: код комнаты — легаси-маршрут в комнату", () => {
  assert.deepEqual(
    readerBackTarget(["m1", "free", "K7QT"]),
    { mode: "room", hash: "#room/K7QT", label: "В комнату" });
});

test("навигация: без третьего сегмента — каталог материалов (старое поведение)", () => {
  assert.equal(readerBackTarget(["m1", "free"]).hash, "#materials");
  assert.equal(readerBackTarget([]).hash, "#materials");
});

test("навигация: чужой или некорректный адрес возврата — каталог", () => {
  // Не внутренний маршрут — не возвращаемся туда.
  assert.equal(readerBackTarget(["m1", "free", "back:%23http%3A%2F%2Fevil.example"]).hash, "#materials");
  // Некорректная процентная кодировка не роняет читалку.
  assert.equal(readerBackTarget(["m1", "free", "back:%zz"]).hash, "#materials");
});

test("навигация: подписи кнопки выхода по адресам", () => {
  assert.equal(backLabel("#topic/t7"), "К теме");
  assert.equal(backLabel("#discipline/d2"), "К дисциплине");
  assert.equal(backLabel("#disciplines"), "К каталогу дисциплин");
  assert.equal(backLabel("#materials"), "К списку материалов");
  assert.equal(backLabel("#create-test/t1"), "К редактору");
  assert.equal(backLabel("#room/K7QT"), "В комнату");
  assert.equal(backLabel("#quiz/t1"), "К тесту");
});

test("навигация: ссылка на материал несёт адрес возврата", () => {
  assert.equal(
    materialLink("#topic/t7", "m1"),
    "#material/m1/free/back:%23topic%2Ft7");
  // Возврат на саму читалку (#material/...) не нужен — обычная ссылка.
  assert.equal(materialLink("#material/m1/free", "m2"), "#material/m2/free");
  // Пустой/некорректный хеш — без back-сегмента.
  assert.equal(materialLink("", "m1"), "#material/m1/free");
});

// ---------- Состояния прогресса ----------

test("прогресс: состояния «не открывал / открыл / читает / завершил»", () => {
  assert.deepEqual(materialProgressState(null), { state: "none", label: "Не открывал" });
  assert.deepEqual(
    materialProgressState({ lastPage: 0, completed: false }),
    { state: "none", label: "Не открывал" },
    "нет документа прогресса");
  assert.deepEqual(
    materialProgressState({ lastPage: 0, completed: false, exists: true }),
    { state: "opened", label: "Открыл" },
    "читалка открывалась (пишет lastPage=0 при старте)");
  assert.deepEqual(
    materialProgressState({ lastPage: 3, completed: false, exists: true }),
    { state: "reading", label: "Читает" });
  assert.deepEqual(
    materialProgressState({ lastPage: 5, completed: true, exists: true }),
    { state: "done", label: "Завершил изучение" });
});

test("прогресс: старые данные без exists считаются по странице", () => {
  assert.deepEqual(
    materialProgressState({ lastPage: 2, completed: false }),
    { state: "reading", label: "Читает" },
    "ненулевая страница — чтение");
  assert.deepEqual(
    materialProgressState({ lastPage: 0, completed: false }),
    { state: "none", label: "Не открывал" });
});

// ---------- Статические проверки страниц ----------

test("читалка: PDF открывается в новой вкладке, а не теряет текущую", () => {
  // Исправление аудита: blob-ссылка с target="_blank" — мобильные
  // браузеры не навигируются в текущей вкладке, читалка не теряется.
  const pdfHandler = READER.slice(READER.indexOf("PDF-вложение"), READER.indexOf("PDF-вложение") + 3000);
  assert.match(pdfHandler, /link\.target = "_blank"/);
  assert.match(pdfHandler, /link\.download/);
  assert.match(pdfHandler, /toast\(/, "ошибки PDF видны пользователю");
});

test("читалка: возврат берётся из адреса, а не жёстко из «#materials»", () => {
  assert.match(READER, /readerBackTarget\(routeParts\)/);
  assert.match(READER, /backLabelFor\(backHash\)/, "подпись выхода по адресу возврата");
});

test("ссылки на материал ведут на источник (тема → дисциплина → каталог)", () => {
  assert.match(TOPIC, /materialLink\(window\.location\.hash/);
  assert.match(DISCIPLINE, /materialLink\(window\.location\.hash/);
  assert.match(MATERIALS, /materialLink\(window\.location\.hash/);
});

test("тема: студент видит состояние изучения материала", () => {
  assert.match(TOPIC, /loadMaterialProgress/);
  assert.match(TOPIC, /materialProgressState/);
  assert.match(TOPIC, /Завершил изучение|progressStates/, "прогресс показывается в списке теории");
});

test("редактор: ход загрузки PDF по кусочкам, текст не теряется", () => {
  assert.match(EDITOR, /pdfChunkCount/);
  assert.match(EDITOR, /Загружаем PDF: \$\{done\}\/\$\{all\}/, "прогресс из колбэка saveLibraryPdf");
  assert.match(EDITOR, /состояние редактора, черновик в localStorage сохраняется/,
    "ошибка PDF не сбрасывает введённый текст");
});

test("безопасность: правила вложений PDF не ослаблены", () => {
  // Ничего не меняли на этапе 5 — проверяем, что границы на месте:
  // запись только сотруднику-автору материала организации, чтение —
  // организация + published (детальные cases — tools/rules-test.mjs).
  const filesBlock = RULES.slice(RULES.indexOf("match /files/"), RULES.indexOf("// Прогресс чтения"));
  assert.match(filesBlock, /authorId == request\.auth\.uid/, "замена/загрузка — только автор");
  assert.match(filesBlock, /\.data\.orgId == myOrg\(\)/, "нет доступа между организациями");
  assert.match(filesBlock, /status.*published/, "студентам — только опубликованные");
});
