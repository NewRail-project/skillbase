// tests/reader-progress.test.js — регрессия сохранения прогресса чтения.
//
// ui/pages/material.js — браузерный код (тянет Firebase SDK), в Node не
// импортируется. Проверяем исходник по образцу room-leaderboard-defect
// теста: студент должен сохранять прогресс чтения (materialProgress) и в
// добровольном режиме #material/<id>/free, а не только по факту
// «Прочитано» — иначе, вернувшись, он начинает с первой страницы.
// Правила Firestore это разрешают (tools/rules-test.mjs: «студент
// продолжает чтение — обновляет свой прогресс»).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(path.join(ROOT, "ui/pages/material.js"), "utf8");

// Блок сохранения прогресса в paintPage(): от вычисления state до конца
// ветки записи.
const marker = "const state = materialProgress(material.pages, index);";
const start = src.indexOf(marker);
assert.ok(start !== -1, "в читалке должен вычисляться materialProgress");
const block = src.slice(start, start + 800);

test("читалка: студент сохраняет прогресс и в свободном режиме (free)", () => {
  // Запись для студентов не должна гейтиться условием про freeMode:
  // исторический дефект — ((!freeMode && !previewMode) || state.completed)
  // оставлял студента без промежуточного прогресса в добровольном чтении.
  const saveIdx = block.indexOf("saveMaterialProgress(State.user.uid, testId, state)");
  assert.ok(saveIdx !== -1, "прогресс студента должен сохраняться через saveMaterialProgress");
  const guard = block.slice(0, saveIdx);
  assert.ok(
    !/freeMode[^]*?isStudent|isStudent[^]*?freeMode/.test(guard.slice(guard.lastIndexOf("if"))),
    "сохранение прогресса студента не должно зависеть от режима free"
  );
  // Общий затвор — только предпросмотр (он ничего не пишет).
  assert.match(guard, /if\s*\(!previewMode\)/, "запись отключается только в предпросмотре");
});

test("читалка: предпросмотр не пишет прогресс в Firestore", () => {
  // Блок с сохранением должен целиком находиться внутри if (!previewMode):
  // иначе редакторский предпросмотр засорял бы materialProgress.
  const previewIdx = block.indexOf("if (!previewMode)");
  const saveIdx = block.indexOf("saveMaterialProgress(State.user.uid, testId, state)");
  assert.ok(previewIdx !== -1 && saveIdx > previewIdx,
    "saveMaterialProgress должен быть внутри if (!previewMode)");
  // Внутри блока не должно быть второго saveMaterialProgress вне затвора.
  assert.equal(block.split("saveMaterialProgress(").length - 1, 1,
    "сохранение прогресса — ровно один вызов, под затвором предпросмотра");
});

test("читалка: персонал хранит последнюю страницу локально", () => {
  assert.match(block, /storageSet\(lastPageKey/, "персоналу последняя страница — в localStorage");
});
