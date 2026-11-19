// tests/material-delete-flow.test.js — фактический поток удаления материала
// из ui/components/delete-flows.js: проверка зависимостей, отказ с именем
// удерживающего теста, отвязка и повторное удаление. Страница выполняется
// целиком, Firestore подменён заглушками tests/helpers/stubs/* (реальные
// документы взяты из организации default-org).
//
// Данные из Firestore (2026-11-19):
//   материал  fLTvAcYntQMF693yssYH «Махметов»        — status draft, 11 страниц;
//   тест      lvoIv7KaHTRyI8CvrbUO «Махметов 4 темы» — published, requireMaterial,
//             materialId = fLTvAcYntQMF693yssYH, автор qlBOS5…;
//   материал  HSkQinTZ7Gm279B0eu7o «Инструктаж»      — автор SZZ3B7…, его же
//             чужой опубликованный тест требует прочитать.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { installFakeDom, findOne, text } from "./helpers/fake-dom.js";
import { splitForStorage } from "../core/test-storage.js";
import { materialDeleteBlockers } from "../core/material-library-logic.js";

register("./helpers/stub-loader.mjs", import.meta.url);
installFakeDom();

const { deleteMaterialFlow } = await import("../ui/components/delete-flows.js");
const tick = () => new Promise(r => setTimeout(r, 0));

const AUTHOR = "qlBOS5ERKThW0TaReXc3MSqaw9s1";
const COLLEAGUE = "SZZ3B7YcfGOBVBuoKG6kT9jqqj13";
const ORG = "default-org";

const MATERIAL = {
  id: "fLTvAcYntQMF693yssYH", title: "Махметов", status: "draft",
  orgId: ORG, authorId: AUTHOR, pageCount: 11, subjectId: null, topicId: null, order: 0
};

const HOLDING_TEST = {
  id: "lvoIv7KaHTRyI8CvrbUO", title: "Махметов 4 темы", status: "published",
  materialId: "fLTvAcYntQMF693yssYH", requireMaterial: true,
  authorId: AUTHOR, orgId: ORG
};

function setup({ profile = { uid: AUTHOR, role: "teacher", orgId: ORG }, tests = [], material = MATERIAL, ...rest } = {}) {
  globalThis.__SB = {
    profile, calls: [], deleted: [], tests, materials: [material], ...rest
  };
  return globalThis.__SB;
}

// Запускает поток и даёт дождаться его завершения без зависания на окне
// подтверждения: blocked-пути отвечают сразу, разрешённые ждут клика.
async function runFlow(material) {
  const promise = deleteMaterialFlow(material);
  await tick(); await tick();
  const confirmShown = modalOpen();
  const ok = confirmShown ? null : await promise;
  return { promise, confirmShown, ok };
}

async function confirmAndAwait(promise) {
  const btn = confirmBtn();
  assert.ok(btn, "кнопка подтверждения на месте");
  btn.click();
  return await promise;
}

const toasts = () => document.body.children.filter(c => /toast/.test(c.className || ""));
const lastToast = () => {
  const list = toasts();
  return list.length ? text(list[list.length - 1]) : "";
};
const modalOpen = () => Boolean(findOne(document.body, e => /modal-overlay/.test(e.className || "")));
const confirmBtn = () => findOne(document.body,
  e => e.tag === "button" && /^Удалить/.test(text(e)) && !/Отмена/.test(text(e)));

// ---------- Зависимости ----------

test("блокировка называет конкретный тест, который удерживает материал", async () => {
  const sb = setup({ tests: [HOLDING_TEST] });
  const { ok, confirmShown } = await runFlow(MATERIAL);

  assert.equal(ok, false, "связанный с тестом материал не удаляется");
  assert.equal(confirmShown, false, "окно подтверждения не показывается");
  assert.match(lastToast(), /Махметов 4 темы/, "тост показывает, какой именно тест удерживает материал");
  assert.match(lastToast(), /Сначала отвяжите его в редакторе теста/);
  assert.deepEqual(sb.deleted, [], "ничего не удалено");
  assert.equal(sb.calls.some(c => c[0] === "deleteLibraryMaterial"), false);
});

test("удалённый тест (status deleted) привязкой не считается", async () => {
  const sb = setup({ tests: [{ ...HOLDING_TEST, status: "deleted" }] });
  const { promise, confirmShown, ok } = await runFlow(MATERIAL);

  assert.equal(confirmShown, true, "зависимостей нет — показывается подтверждение");
  assert.equal(await confirmAndAwait(promise), true);
  await tick();
  assert.deepEqual(sb.deleted, [MATERIAL.id]);
  assert.match(lastToast(), /Материал удалён/);
});

test("после отвязки (materialId = null) удаление разрешается", async () => {
  const sb = setup({ tests: [{ ...HOLDING_TEST, materialId: null }] });
  const { promise, confirmShown } = await runFlow(MATERIAL);

  assert.equal(confirmShown, true, "после отвязки блокировки нет");
  assert.equal(await confirmAndAwait(promise), true);
  await tick();
  assert.deepEqual(sb.deleted, [MATERIAL.id]);
  assert.match(lastToast(), /Материал удалён/);
});

test("отвязка доходит до записи: materialId = null не отбрасывается при сохранении", () => {
  const { publicTest } = splitForStorage({ ...HOLDING_TEST, materialId: null, questions: [] });
  assert.ok("materialId" in publicTest, "поле materialId попадает в публичный документ");
  assert.equal(publicTest.materialId, null, "null переживает sanitizePublicTest — связь реально снимается");
  assert.equal(materialDeleteBlockers(MATERIAL.id, [publicTest]).length, 0,
    "после записи блокировок не остаётся");
});

test("материал чужого автора удерживает чужой опубликованный тест — удаление блокируется", async () => {
  // Права преподавателя ограничивают listMyTests его собственными тестами,
  // но правила разрешают читать опубликованные тесты организации. Проверка
  // зависимостей обязана видеть и их, иначе чужой опубликованный тест остался
  // бы без обязательного материала.
  const sb = setup({
    profile: { uid: COLLEAGUE, role: "teacher", orgId: ORG },
    material: { ...MATERIAL, id: "HSkQinTZ7Gm279B0eu7o", title: "Инструктаж", authorId: COLLEAGUE, status: "published" },
    tests: [{ ...HOLDING_TEST, materialId: "HSkQinTZ7Gm279B0eu7o" }]
  });
  const colleagueMaterial = { ...MATERIAL, id: "HSkQinTZ7Gm279B0eu7o", title: "Инструктаж", authorId: COLLEAGUE };

  const { ok, confirmShown } = await runFlow(colleagueMaterial);

  assert.equal(confirmShown, false, "чужой опубликованный тест защищает материал");
  assert.equal(ok, false);
  assert.match(lastToast(), /Махметов 4 темы/);
  assert.deepEqual(sb.deleted, []);
});

test("чужой черновик не блокирует: правила не дают его прочитать", async () => {
  setup({
    profile: { uid: COLLEAGUE, role: "teacher", orgId: ORG },
    material: { ...MATERIAL, id: "HSkQinTZ7Gm279B0eu7o", title: "Инструктаж", authorId: COLLEAGUE, status: "published" },
    // Чужой черновик: коллега его не читает ни по авторству, ни по статусу.
    tests: [{ ...HOLDING_TEST, materialId: "HSkQinTZ7Gm279B0eu7o", status: "draft", authorId: AUTHOR }]
  });
  const colleagueMaterial = { ...MATERIAL, id: "HSkQinTZ7Gm279B0eu7o", title: "Инструктаж", authorId: COLLEAGUE };

  const { promise, confirmShown } = await runFlow(colleagueMaterial);
  assert.equal(confirmShown, true, "чужой черновик вне досягаемости правил — подтверждение показывается");
  findOne(document.body, e => e.tag === "button" && /Отмена/.test(text(e))).click();
  assert.equal(await promise, false);
});

// ---------- Отказы Firestore ----------

test("сбой чтения тестов не даёт удалить материал вслепую", async () => {
  const sb = setup({
    tests: [HOLDING_TEST],
    listTestsError: Object.assign(new Error("index"), { code: "failed-precondition" })
  });

  const { ok, confirmShown } = await runFlow(MATERIAL);

  assert.equal(ok, false);
  assert.equal(confirmShown, false, "без списка зависимостей подтверждение не показывается");
  assert.match(lastToast(), /Не удалось проверить, привязан ли материал/);
  assert.deepEqual(sb.deleted, []);
});

test("сбой записи после подтверждения показывает ошибку, материал остаётся", async () => {
  const sb = setup({
    tests: [{ ...HOLDING_TEST, materialId: null }],
    deleteMaterialError: new Error("Missing or insufficient permissions.")
  });

  const { promise, confirmShown } = await runFlow(MATERIAL);
  assert.equal(confirmShown, true);
  assert.equal(await confirmAndAwait(promise), false);
  await tick();
  assert.match(lastToast(), /Missing or insufficient permissions/);
  assert.deepEqual(sb.deleted, [], "удаления не произошло");
});

test("права: материал чужого автора не удаляется и без зависимостей", async () => {
  const sb = setup({ profile: { uid: COLLEAGUE, role: "teacher", orgId: ORG } });

  const { ok, confirmShown } = await runFlow(MATERIAL);

  assert.equal(ok, false);
  assert.equal(confirmShown, false);
  assert.match(lastToast(), /Материал может удалить только его автор/);
  assert.equal(sb.calls.some(c => c[0] === "listMyTests"), false, "права проверяются до чтения тестов");
  assert.deepEqual(sb.deleted, []);
});
