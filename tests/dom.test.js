import test from "node:test";
import assert from "node:assert/strict";
import { h } from "../shared/dom.js";

// Минимальная заглушка DOM: проверяем именно контракт h(), без браузера.
function makeElement(tag) {
  return {
    tag,
    attrs: {},
    children: [],
    dataset: {},
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    appendChild(child) {
      this.children.push(child);
    },
    addEventListener() {}
  };
}

globalThis.document = {
  createElement: makeElement,
  createTextNode: text => ({ text })
};

test("h: false для логического атрибута не включает его", () => {
  const input = h("input", { type: "checkbox", checked: false, disabled: false });

  assert.equal(input.checked, false);
  assert.equal(input.disabled, false);
  assert.equal("checked" in input.attrs, false);
  assert.equal("disabled" in input.attrs, false);
  assert.equal(input.attrs.type, "checkbox");
});

test("h: true для логического атрибута включает DOM-свойство", () => {
  assert.equal(h("input", { checked: true }).checked, true);
  assert.equal(h("button", { disabled: true }).disabled, true);
  assert.equal(h("div", { hidden: true }).hidden, true);
});

test("h: строковое значение логического атрибута тоже включает его", () => {
  assert.equal(h("button", { disabled: "disabled" }).disabled, true);
  assert.equal(h("div", { hidden: "hidden" }).hidden, true);
});

test("h: обычные атрибуты и текст остаются прежними", () => {
  const link = h("a", { href: "#tests", class: "btn" }, "Тесты");

  assert.equal(link.href, "#tests");
  assert.equal(link.className, "btn");
  assert.deepEqual(link.children, [{ text: "Тесты" }]);
});
