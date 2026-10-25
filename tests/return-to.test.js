import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHash,
  isReturnableHash,
  safeReturnTo,
  saveReturnTo,
  peekReturnTo,
  consumeReturnTo,
  clearReturnTo
} from "../shared/return-to.js";

test("хэш приводится к виду #route", () => {
  assert.equal(normalizeHash("quiz/t1"), "#quiz/t1");
  assert.equal(normalizeHash("#quiz/t1"), "#quiz/t1");
  assert.equal(normalizeHash("  #/results/t1 "), "#/results/t1");
  assert.equal(normalizeHash(""), "");
  assert.equal(normalizeHash(null), "");
});

test("ссылка на тест годится для возврата", () => {
  assert.equal(isReturnableHash("#quiz/t1"), true);
  assert.equal(isReturnableHash("quiz/t1"), true);
  assert.equal(isReturnableHash("#quiz/t1/as1"), true);
  assert.equal(isReturnableHash("#quiz/t1?from=qr"), true);
  assert.equal(isReturnableHash("#/assignments"), true);
  assert.equal(isReturnableHash("#results/t1"), true);
});

test("формы входа не становятся точкой возврата", () => {
  assert.equal(isReturnableHash("#login"), false);
  assert.equal(isReturnableHash("#/login"), false);
  assert.equal(isReturnableHash("#register"), false);
  assert.equal(isReturnableHash("#"), false);
  assert.equal(isReturnableHash("#/"), false);
  assert.equal(isReturnableHash(""), false);
  assert.equal(isReturnableHash(null), false);
});

test("небезопасная ссылка заменяется запасной", () => {
  assert.equal(safeReturnTo("#quiz/t1"), "#quiz/t1");
  assert.equal(safeReturnTo("#login"), "#/");
  assert.equal(safeReturnTo(null, "#profile"), "#profile");
});

test("сохранение и получение ссылки в sessionStorage", () => {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  };

  try {
    assert.equal(saveReturnTo("#quiz/t1"), true);
    assert.equal(peekReturnTo(), "#quiz/t1");
    assert.equal(consumeReturnTo("#/"), "#quiz/t1");
    // Повторный вход не должен возвращать на старый тест.
    assert.equal(peekReturnTo(), null);
    assert.equal(consumeReturnTo("#profile"), "#profile");
  } finally {
    delete globalThis.sessionStorage;
  }
});

test("служебные ссылки не сохраняются", () => {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  };

  try {
    assert.equal(saveReturnTo("#login"), false);
    assert.equal(saveReturnTo("#register"), false);
    assert.equal(peekReturnTo(), null);
    saveReturnTo("#quiz/t1");
    clearReturnTo();
    assert.equal(peekReturnTo(), null);
  } finally {
    delete globalThis.sessionStorage;
  }
});
