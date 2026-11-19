// tests/test-editor-binding.test.js — фактическая работа блока привязки
// теории в редакторе теста (ui/pages/create-test.js, buildMaterialEditor):
// привязанный материал не исчезает из списка и не отвязывается молча при
// сохранении; отвязка — только явным выбором «Без теории из библиотеки».
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { installFakeDom, findOne, findAll, text } from "./helpers/fake-dom.js";

register("./helpers/stub-loader.mjs", import.meta.url);
installFakeDom();

const createTest = await import("../ui/pages/create-test.js");
const tick = () => new Promise(r => setTimeout(r, 0));

const AUTHOR = "qlBOS5ERKThW0TaReXc3MSqaw9s1";
const ORG = "default-org";
const TEST_ID = "lvoIv7KaHTRyI8CvrbUO";
const BOUND_ID = "fLTvAcYntQMF693yssYH";

function testDoc(materialId) {
  return {
    id: TEST_ID, title: "Махметов 4 темы", description: "",
    status: "draft", authorId: AUTHOR, orgId: ORG,
    materialId, requireMaterial: true,
    subjectId: null, topicId: null,
    settings: {}, questions: [
      { type: "single", text: "Вопрос?", options: [{ text: "Да", correct: true }, { text: "Нет" }] }
    ]
  };
}

async function open({ catalog = [], materialId = BOUND_ID, catalogError = null } = {}) {
  globalThis.__SB = {
    profile: { uid: AUTHOR, role: "teacher", orgId: ORG },
    routeParam: TEST_ID,
    calls: [], deleted: [],
    tests: [testDoc(materialId)],
    materials: catalog,
    subjects: [], topics: [], assignments: [],
    materialsError: catalogError
  };
  const page = await createTest.default();
  // IIFE с предметами/темами/материалами отрабатывает после return страницы.
  await tick(); await tick(); await tick();
  return page;
}

const materialSel = page => findOne(page, e => e.tag === "select" && e.attrs.id === "t-material");
const saveBtn = page => findOne(page, e => e.attrs.id === "save-btn");
const options = sel => sel.children.filter(c => c.tag === "option")
  .map(o => ({ value: o.getAttribute("value"), label: text(o) }));
const drafts = () => globalThis.__SB.calls.filter(c => c[0] === "updateTest");

// Каталог, в котором привязанного материала нет (архив отфильтрован).
const CATALOG_WITHOUT_BOUND = [
  { id: "HSkQinTZ7Gm279B0eu7o", title: "Инструктаж", status: "published" },
  { id: "iasL2qNyZ4NDlt5Gej8J", title: "Инструктаж Тб", status: "archived" }
];

test("привязанный материал остаётся в списке, даже если каталог его не отдаёт", async () => {
  const page = await open({ catalog: CATALOG_WITHOUT_BOUND });
  const sel = materialSel(page);
  assert.ok(sel, "select привязки теории на странице есть");

  const opts = options(sel);
  assert.ok(opts.some(o => o.value === BOUND_ID),
    `привязанный материал присутствует: ${JSON.stringify(opts)}`);
  assert.equal(sel.value, BOUND_ID, "значение select — привязанный материал, а не пусто");
});

test("в обычном каталоге привязка подставляется без лишних опций", async () => {
  const page = await open({
    catalog: [
      { id: BOUND_ID, title: "Махметов", status: "draft" },
      { id: "HSkQinTZ7Gm279B0eu7o", title: "Инструктаж", status: "published" }
    ]
  });
  const sel = materialSel(page);
  assert.equal(sel.value, BOUND_ID);
  // опция «Без теории из библиотеки» + 2 материала каталога, без дублей
  assert.equal(options(sel).length, 3, "дублей нет");
});

test("ошибка каталога не превращает привязку в пустую", async () => {
  const err = Object.assign(new Error("index"), { code: "failed-precondition" });
  const page = await open({ catalogError: err });
  const sel = materialSel(page);

  assert.ok(options(sel).some(o => o.value === BOUND_ID),
    "опция привязанного материала добавлена и при отказе чтения");
  assert.equal(sel.value, BOUND_ID);
  assert.match(text(sel.children.find(c => c.getAttribute("value") === BOUND_ID)),
    /нет в каталоге/);
});

test("сохранение теста не снимает привязку молча", async () => {
  const page = await open({ catalog: CATALOG_WITHOUT_BOUND });
  assert.equal(materialSel(page).value, BOUND_ID);

  saveBtn(page).click();
  await tick(); await tick();

  const saved = drafts();
  assert.equal(saved.length, 1, "тест записан");
  assert.equal(saved[0][1].materialId, BOUND_ID,
    "materialId ушёл в запись прежним, а не null");
  assert.equal(saved[0][1].requireMaterial, true);
});

test("отвязка — только явным выбором «Без теории из библиотеки»", async () => {
  const page = await open({ catalog: CATALOG_WITHOUT_BOUND });
  const sel = materialSel(page);

  sel.value = "";
  saveBtn(page).click();
  await tick(); await tick();

  const saved = drafts();
  assert.equal(saved.length, 1);
  assert.equal(saved[0][1].materialId, null,
    "после явного выбора «Без теории» связь снимается");
});
