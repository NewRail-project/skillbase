// tests/test-binding.test.js — привязка теста к предмету/теме/материалу.
//
// core/test-binding.js — чистый модуль (без Firebase): проверяется в Node.
// Ключевой контракт — materialForTest: и клиентский гейт «сначала теория»
// (ui/pages/quiz.js), и правило Firestore attemptMaterialId должны
// смотреть на один и тот же материал (test.materialId, если привязан,
// иначе книга самого теста). Расхождение блокирует студента навсегда.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TEST_BINDING_FIELDS,
  normalizeTestBinding,
  validateTestBinding,
  materialForTest
} from "../core/test-binding.js";

test("materialForTest: привязанный библиотечный материал имеет приоритет", () => {
  const test = { id: "t1", materialId: "m-lib" };
  assert.equal(materialForTest(test), "m-lib");
});

test("materialForTest: без привязки гейт смотрит на книгу теста", () => {
  assert.equal(materialForTest({ id: "t1" }), "t1");
  assert.equal(materialForTest({ id: "t1", materialId: "   " }), "t1");
  assert.equal(materialForTest({ id: "t1", materialId: 42 }), "t1");
});

test("normalizeTestBinding: пустые привязки → null, флаг — boolean", () => {
  assert.deepEqual(normalizeTestBinding({}), {
    subjectId: null, topicId: null, materialId: null, requireMaterial: false
  });
  assert.deepEqual(
    normalizeTestBinding({ subjectId: "s1", topicId: "t9", requireMaterial: 1 }),
    { subjectId: "s1", topicId: "t9", materialId: null, requireMaterial: true }
  );
});

test("validateTestBinding: слишком длинные и нестроковые id отклоняются", () => {
  assert.ok(validateTestBinding({ subjectId: "x".repeat(65) }).length > 0);
  assert.ok(validateTestBinding({ topicId: 5 }).length > 0);
  assert.ok(validateTestBinding({ materialId: "x".repeat(65) }).length > 0);
  assert.ok(validateTestBinding({ requireMaterial: "yes" }).length > 0);
  assert.deepEqual(validateTestBinding({ subjectId: "s1", requireMaterial: true }), []);
});

test("набор полей привязки согласован со схемой теста", async () => {
  // emptyTest содержит ровно поля привязки из TEST_BINDING_FIELDS.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../core/test-schema.js", import.meta.url), "utf8");
  for (const field of TEST_BINDING_FIELDS) {
    assert.ok(src.includes(`${field}:`), `test-schema: не найдено поле ${field}`);
  }
});
