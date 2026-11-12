import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRoomCode,
  isValidRoomCode
} from "../core/rooms-logic.js";

test("normalizeRoomCode: приводит допустимый код к верхнему регистру", () => {
  assert.equal(normalizeRoomCode("abc234"), "ABC234");
  assert.equal(normalizeRoomCode(" ABC234 "), "ABC234");
});

test("normalizeRoomCode: отклоняет недопустимые коды", () => {
  assert.equal(normalizeRoomCode("invalid"), null);
  assert.equal(normalizeRoomCode(""), null);
  assert.equal(normalizeRoomCode(null), null);
});

test("isValidRoomCode: проверяет формат кода комнаты", () => {
  assert.equal(isValidRoomCode("ABC234"), true);
  assert.equal(isValidRoomCode("ABC0I1"), false);
  assert.equal(isValidRoomCode("abc"), false);
});
