// tests/guest.test.js — гостевой вход на тест по прямой ссылке.
//
// Проверяются чистые функции ФИО (core/guest.js): нормализация пробелов,
// валидация формы (фамилия и имя обязательны, отчество — нет) и
// сохранение имени гостевой сессии в localStorage.

import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeGuestNameParts,
  validateGuestName,
  validateGuestForm,
  saveGuestName,
  getGuestName,
  clearGuestName
} from "../core/guest.js";

// ---------- Нормализация ----------

test("ФИО гостя нормализуется: пробелы по краям и между частями", () => {
  assert.equal(
    normalizeGuestNameParts({ surname: "  Иванов ", name: "Иван", patronymic: "  " }),
    "Иванов Иван"
  );
  assert.equal(
    normalizeGuestNameParts({ surname: "Иванов", name: "Иван", patronymic: "Иванович" }),
    "Иванов Иван Иванович"
  );
  // Двойные пробелы внутри частей схлопываются.
  assert.equal(
    normalizeGuestNameParts({ surname: "Иванов", name: "Иван    Иванович" }),
    "Иванов Иван Иванович"
  );
});

// ---------- Валидация формы ----------

test("Форма гостя требует фамилию и имя", () => {
  assert.equal(validateGuestForm({ surname: "", name: "Иван" }).ok, false);
  assert.equal(validateGuestForm({ surname: "Иванов", name: "" }).ok, false);
  assert.match(validateGuestForm({ surname: "", name: "" }).error, /фамилию/);
});

test("Отчество необязательно", () => {
  const direct = validateGuestForm({ surname: "Иванов", name: "Иван" });
  assert.equal(direct.ok, true);
  assert.equal(direct.value, "Иванов Иван");

  const withMiddle = validateGuestForm({ surname: "Иванов", name: "Иван", patronymic: "Иванович" });
  assert.equal(withMiddle.ok, true);
  assert.equal(withMiddle.value, "Иванов Иван Иванович");
});

test("ФИО гостя ограничено 120 символами по правилам Firestore", () => {
  const long = "В".repeat(121);
  assert.equal(validateGuestName(long).ok, false);
  assert.equal(validateGuestName({ surname: long, name: "И" }).ok, false);
  const exact = "В".repeat(120);
  assert.equal(validateGuestName(exact).ok, true);
});

test("Одна буква в фамилии/имени отклоняется формой", () => {
  assert.equal(validateGuestForm({ surname: "И", name: "Иван" }).ok, false);
  assert.equal(validateGuestForm({ surname: "Иванов", name: "Я" }).ok, false);
});

// ---------- Хранение имени сессии ----------

test("Имя гостя сохраняется и возвращается без искажений", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  };

  clearGuestName();
  assert.equal(getGuestName(), "");

  saveGuestName("  Петров   Пётр Петрович  ");
  assert.equal(getGuestName(), "Петров Пётр Петрович");

  // Невалидное имя не сохраняется и не затирает предыдущее.
  assert.equal(saveGuestName("   "), false);
  assert.equal(getGuestName(), "Петров Пётр Петрович");

  clearGuestName();
  assert.equal(getGuestName(), "");
});
