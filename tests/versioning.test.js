// tests/versioning.test.js
// Тесты для версионирования ключей.

import { normalizeTestVersion } from '../core/test-storage.js';
import { selectKeysForAttempt } from '../core/test-storage.js';

// Тест: нормализация версии.
function testNormalizeVersion() {
  const tests = [
    { value: null, expected: null },
    { value: "", expected: null },
    { value: "1", expected: 1 },
    { value: "10", expected: 10 },
    { value: "100", expected: 100 },
    { value: "abc", expected: null },
    { value: "", expected: null },
    { value: 1, expected: 1 },
    { value: 100000, expected: 100000 }
  ];
  tests.forEach(({ value, expected }) => {
    const result = normalizeTestVersion(value);
    if (result !== expected) {
      throw new Error(`normalizeTestVersion(${value}) => ${result} != ${expected}`);
    }
  });
}

// Тест: выбор версионных ключей.
function testSelectKeysForAttempt() {
  const currentItems = {
    "0": { type: "single", points: 2, correct: [1] },
    "1": { type: "multiple", points: 3, correct: [0, 2] }
  };
  const versionedItems = {
    "1": {
      "0": { type: "single", points: 2, correct: [1] },
      "1": { type: "multiple", points: 3, correct: [0, 2] }
    }
  };
  const result = selectKeysForAttempt(currentItems, versionedItems, 1);
  if (result !== versionedItems["1"]) {
    throw new Error("Выбор версионных ключей неверен.");
  }
}

// Запуск тестов.
if (typeof describe === "function") {
  describe("Тесты версионирования", () => {
    test("normalizeTestVersion", testNormalizeVersion);
    test("selectKeysForAttempt", testSelectKeysForAttempt);
  });
}