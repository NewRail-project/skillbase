// tests/quiz-gate.test.js — регрессия гейта «сначала теория» в quiz.js.
//
// ui/pages/quiz.js — браузерный код, в Node не импортируется. Проверяем
// исходник: гейт обязательной теории должен смотреть на тот же материал,
// что и правило Firestore attemptMaterialId (test.materialId, если он
// привязан, иначе книга теста). Исторический дефект: клиент проверял
// materialCompleted(uid, test.id), игнорируя привязанный материал, —
// студент, прочитавший теорию темы, оставался заблокирован.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(path.join(ROOT, "ui/pages/quiz.js"), "utf8");

test("quiz: гейт теории использует materialForTest, а не test.id", () => {
  assert.match(src, /import \{ materialForTest \} from "\.\.\/\.\.\/core\/test-binding\.js"/,
    "должен импортироваться materialForTest из core/test-binding.js");
  const gateIdx = src.indexOf("const gateMaterialId = materialForTest(test);");
  assert.ok(gateIdx !== -1, "гейт должен вычислять materialForTest(test)");

  const gate = src.slice(gateIdx, src.indexOf("let canReadMaterial", gateIdx) + 400);
  assert.match(gate, /materialCompleted\(State\.user\.uid, gateMaterialId\)/,
    "проверка прочтения — по gateMaterialId");
  assert.match(gate, /hasMaterial\(gateMaterialId\)/,
    "наличие книги для добровольного чтения — по gateMaterialId");
  // Прямые обращения к test.id в гейте не возвращаются.
  assert.equal(
    /materialCompleted\(State\.user\.uid, test\.id\)|hasMaterial\(test\.id\)/.test(src),
    false,
    "гейт не должен проверять test.id напрямую (расхождение с правилами)"
  );
});
