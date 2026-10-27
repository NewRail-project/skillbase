// tests/live-room.test.js — проверки UI join.js и чистого контракта Live-комнат.
// ПРИМЕЧАНИЕ: Юнит-тесты выполняются с клиентскими заглушками и НЕ ПРОВЕРЯЮТ реальные Firestore Rules.

import test from "node:test";
import assert from "node:assert/strict";
import { h } from "../shared/dom.js";
import { normalizeRoomCode } from "../core/rooms-logic.js";

// Минимальная заглушка DOM для проверки создания элементов в join.js
function makeElement(tag) {
  const children = [];
  return {
    tag,
    attrs: {},
    children,
    dataset: {},
    style: {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    appendChild(child) { children.push(child); },
    append(...nodes) { children.push(...nodes); },
    addEventListener() {},
    classList: {
      toggle() {},
      add() {},
      remove() {}
    },
    focus() {}
  };
}

globalThis.document = {
  createElement: makeElement,
  createTextNode: text => ({ text })
};

test("join.js: hero вызов возвращает DOM-элемент (исправление join.js:98)", async () => {
  const JoinPageModule = await import("../ui/pages/join.js");
  const JoinPage = JoinPageModule.default;
  const page = await JoinPage();

  assert.ok(page, "Страница join создана");
  assert.equal(typeof page, "object");
  // Страница имеет заголовок (hero) первым дочерним элементом
  assert.ok(page.children.length > 0);
  assert.equal(page.children[0].attrs.class, "page-head");
});

test("normalizeRoomCode: нормализует и проверяет формат кодов комнат", () => {
  assert.equal(normalizeRoomCode("abc123"), "ABC123");
  assert.equal(normalizeRoomCode(" ABC123 "), "ABC123");
  assert.equal(normalizeRoomCode(" invalid "), null);
  assert.equal(normalizeRoomCode(""), null);
});
