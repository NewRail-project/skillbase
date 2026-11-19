// tests/material-editor.test.js — фактическая работа страницы
// #material-editor/<id>: открытие опубликованного материала, черновика и
// книги без поля status, сохранение, отказы Firestore и права автора.
// Firebase подменён заглушкой tests/helpers/stubs/material-library.js
// (валидация карточки настоящая), DOM — минимальный, страница выполняется целиком.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { installFakeDom, findAll, findOne, text } from "./helpers/fake-dom.js";

register("./helpers/stub-loader.mjs", import.meta.url);
installFakeDom();

const editor = await import("../ui/pages/material-editor.js");
const tick = () => new Promise(r => setTimeout(r, 0));

const LONG_TEXT = "Текст страницы материала. ".repeat(16); // > PAGE_MIN_TEXT
const page0 = [{ type: "paragraph", text: LONG_TEXT }];

function fixture(overrides = {}) {
  return {
    profile: { uid: "u-author", role: "teacher", orgId: "default-org" },
    staff: true,
    calls: [],
    subjects: [],
    topics: [],
    materials: [],
    routeParam: "m1",
    ...overrides
  };
}

async function open(overrides = {}) {
  const { materials, ...rest } = overrides;
  globalThis.__SB = fixture({
    materials: materials || [],
    // Адрес #material-editor/<id>: параметр должен указывать на материал.
    routeParam: materials?.[0]?.id || "m1",
    ...rest
  });
  const page = await editor.default();
  await tick(); await tick();
  return page;
}

const statusSelect = page => findAll(page, e => e.tag === "select")
  .find(s => s.children.some(c => c.tag === "option" && c.getAttribute("value") === "published"));
const titleInput = page => findOne(page, e => e.tag === "input" && e.attrs.placeholder === "Название материала");
const saveBtn = page => findAll(page, e => e.tag === "button").find(b => /Сохранить материал|Создать материал/.test(text(b)));
const saveStatus = page => findOne(page, e => e.attrs?.role === "status");
const calls = (name) => globalThis.__SB.calls.filter(c => c[0] === name);

// Реальные документы из Firestore (org default-org).
const PUBLISHED = {
  id: "iasL2qNyZ4NDlt5Gej8J", title: "Инструктаж Тб", description: "",
  subjectId: "vWkriwcLEndIhaWqHcO2", topicId: "IJBmC1Qk1MLSYEAxDcWZ",
  order: 1, status: "published", orgId: "default-org", authorId: "u-author",
  pageCount: 9, pages: [page0]
};
const DRAFT = {
  id: "fLTvAcYntQMF693yssYH", title: "Махметов", description: "",
  subjectId: "vWkriwcLEndIhaWqHcO2", topicId: "SkwI7NHI9spc3gQsDDbD",
  order: 0, status: "draft", orgId: "default-org", authorId: "u-author",
  pageCount: 11, pages: [page0]
};
// Книга из редактора тестов: поля status/subjectId/topicId/order нет вовсе.
const BOOK = {
  id: "JSx39fupDlp7c1wtA1No", title: "Кветко", orgId: "default-org",
  authorId: "u-author", pageCount: 18, pages: [page0]
};

test("редактор: опубликованный материал открывается, статус «Опубликован», сохранение доступно", async () => {
  const page = await open({ materials: [PUBLISHED] });
  assert.equal(titleInput(page).value, "Инструктаж Тб");
  assert.equal(statusSelect(page).value, "published");
  assert.equal(saveBtn(page).disabled ?? false, false);
  assert.match(text(saveStatus(page)), /Данные не менялись|Сохранено/);
  assert.equal(calls("loadLibraryMaterial")[0][1], PUBLISHED.id, "материал загружен по id из адреса");
  assert.ok(!/Материал не найден|Правила Firestore/.test(text(page)));
});

test("редактор: черновик открывается как черновик и остаётся черновиком после сохранения", async () => {
  const page = await open({ materials: [DRAFT] });
  assert.equal(statusSelect(page).value, "draft");
  saveBtn(page).click();
  await tick(); await tick();
  const payload = calls("updateLibraryMaterial")[0][2];
  assert.equal(payload.status, "draft", "черновик не должен превратиться в опубликованный");
  assert.match(text(saveStatus(page)), /Материал сохранён/);
  assert.equal(calls("saveLibraryMaterialPages").length, 1, "страницы сохраняются вместе с карточкой");
});

test("редактор: книга без поля status — опубликована, сохранение не прячет её от студентов", async () => {
  // isPublished() считает отсутствующее status опубликованным (как правила
  // Firestore для студентов). Редактор обязан показывать то же самое:
  // иначе сохранение книги пишет status="draft" и студенты теряют доступ.
  const page = await open({ materials: [BOOK] });
  assert.equal(statusSelect(page).value, "published",
    "книга без status должна открываться как опубликованная");
  saveBtn(page).click();
  await tick(); await tick();
  const payload = calls("updateLibraryMaterial")[0][2];
  assert.equal(payload.status, "published",
    "сохранение книги не должно записывать status=draft");
});

test("редактор: изменение и сохранение уходит в Firestore (карточка и страницы)", async () => {
  const page = await open({ materials: [PUBLISHED] });
  titleInput(page).value = "Инструктаж Тб (новое название)";
  titleInput(page).dispatch("input");
  saveBtn(page).click();
  await tick(); await tick();
  const payload = calls("updateLibraryMaterial")[0][2];
  assert.equal(payload.title, "Инструктаж Тб (новое название)");
  assert.equal(payload.status, "published");
  assert.equal(payload.subjectId, PUBLISHED.subjectId);
  assert.equal(calls("saveLibraryMaterialPages")[0][2].length, 1);
  assert.match(text(saveStatus(page)), /Материал сохранён/);
});

test("редактор: материал другого автора — сохранение отключено (правила требуют authorId == uid)", async () => {
  const page = await open({ materials: [{ ...PUBLISHED, id: "HSkQinTZ7Gm279B0eu7o", authorId: "u-other" }] });
  assert.equal(saveBtn(page).disabled, true, "запись другого автора запрещена правилами");
  assert.match(text(saveStatus(page)), /Материал другого автора/);
  saveBtn(page).click();
  await tick();
  assert.equal(calls("updateLibraryMaterial").length, 0, "записи не было");
});

test("редактор: администратор организации правит материал коллеги", async () => {
  // Правила update: автор ИЛИ админ организации (та же модель, что у tests
  // и удаления материалов). Гейт страницы не должен блокировать запись.
  const page = await open({
    profile: { uid: "u-admin", role: "admin", orgId: "default-org" },
    materials: [{ ...PUBLISHED, id: "HSkQinTZ7Gm279B0eu7o", authorId: "u-other" }]
  });
  assert.equal(saveBtn(page).disabled ?? false, false,
    "администратор организации может править чужой материал");
  saveBtn(page).click();
  await tick(); await tick();
  const payload = calls("updateLibraryMaterial")[0][2];
  assert.equal(payload.status, "published");
  assert.equal(payload.subjectId, PUBLISHED.subjectId);
});

test("редактор: документ не найден — понятная панель вместо редактора", async () => {
  const page = await open({ materials: [] });
  assert.match(text(page), /Материал не найден/);
  saveBtn(page).click();
  await tick();
  assert.equal(calls("updateLibraryMaterial").length, 0, "по несуществующему id ничего не пишется");
});

test("редактор: отказ правил при чтении показывается явно", async () => {
  const err = new Error("Missing or insufficient permissions.");
  err.code = "permission-denied";
  const page = await open({ loadError: err });
  assert.match(text(page), /Правила Firestore не разрешают чтение материала/);
  saveBtn(page).click();
  await tick();
  assert.equal(calls("updateLibraryMaterial").length, 0, "после отказа чтения записи нет");
});

test("редактор: сбой записи не теряет текст — сообщение «Не сохранено»", async () => {
  const err = new Error("Нет подключения");
  const page = await open({ materials: [PUBLISHED], saveError: err });
  saveBtn(page).click();
  await tick(); await tick();
  assert.match(text(saveStatus(page)), /Не сохранено: Нет подключения/);
  assert.equal(saveStatus(page).className, "form-error");
});
