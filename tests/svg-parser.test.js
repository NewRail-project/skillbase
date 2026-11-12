import test from "node:test";
import assert from "node:assert/strict";
import { createIcon } from "../shared/svg.js";
import { icons } from "../shared/icons.js";

// Минимальная заглушка DOM: createIcon строит элементы через
// document.createElementNS, без парсеров (DOMParser/innerHTML запрещены).
function makeElement(tag) {
  return {
    tag,
    attrs: {},
    children: [],
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    appendChild(child) {
      this.children.push(child);
    }
  };
}

globalThis.document = {
  createElementNS: (_ns, tag) => makeElement(tag)
};

test("createIcon: корректный path, viewBox (camelCase) сохраняется", () => {
  const svg = createIcon('<svg viewBox="0 0 24 24" fill="none"><path d="M3 9l9-7 9 7v11z"/></svg>');
  assert.equal(svg.tag, "svg");
  assert.equal(svg.attrs.viewBox, "0 0 24 24");
  assert.equal(svg.attrs.fill, "none");
  assert.equal(svg.children.length, 1);
  assert.equal(svg.children[0].tag, "path");
  assert.equal(svg.children[0].attrs.d, "M3 9l9-7 9 7v11z");
});

test("createIcon: polyline с points проходит", () => {
  const svg = createIcon('<svg viewBox="0 0 24 24"><polyline points="9 22 9 12 15 12 15 22"/></svg>');
  assert.equal(svg.children[0].tag, "polyline");
  assert.equal(svg.children[0].attrs.points, "9 22 9 12 15 12 15 22");
});

test("createIcon: несколько дочерних элементов сохраняют порядок", () => {
  const svg = createIcon('<svg viewBox="0 0 24 24"><rect x="1" y="1" width="4" height="4" rx="1"/><line x1="0" y1="0" x2="2" y2="2"/><circle cx="12" cy="12" r="3"/></svg>');
  assert.deepEqual(svg.children.map(c => c.tag), ["rect", "line", "circle"]);
});

test("createIcon: <script> отклоняется", () => {
  assert.throws(() => createIcon('<svg><script>alert(1)</script></svg>'), /недопустимый тег/);
});

test("createIcon: атрибут onload отклоняется", () => {
  assert.throws(() => createIcon('<svg onload="alert(1)"></svg>'), /недопустимый атрибут/);
});

test("createIcon: неизвестный SVG-тег (foreignObject) отклоняется", () => {
  assert.throws(() => createIcon('<svg><foreignObject/></svg>'), /недопустимый тег/);
});

test("createIcon: style и href отклоняются", () => {
  assert.throws(() => createIcon('<svg style="fill:red"></svg>'), /недопустимый атрибут/);
  assert.throws(() => createIcon('<svg><path href="/x"/></svg>'), /недопустимый атрибут/);
});

test("createIcon: некорректная структура даёт понятную ошибку", () => {
  assert.throws(() => createIcon('<svg><path d="M1 1"'), /<svg \.\.\.<\/svg>|некорректная иконка/);
  assert.throws(() => createIcon("не svg вообще"), /некорректная иконка/);
  // Закрывающий тег ребёнка — не формат иконок (все дети самозакрывающиеся).
  assert.throws(() => createIcon('<svg><path d="M1 1"></path></svg>'), /лишняя разметка/);
});

test("createIcon: все иконки shared/icons.js проходят и сохраняют viewBox", () => {
  const names = Object.keys(icons);
  assert.ok(names.length >= 20, `ожидается не меньше 20 иконок, получено ${names.length}`);
  for (const name of names) {
    const svg = createIcon(icons[name]);
    assert.equal(svg.tag, "svg", name);
    assert.match(svg.attrs.viewBox || "", /^0 0 24 24$/, `viewBox потерян у «${name}»`);
    assert.ok(svg.children.length > 0, `иконка «${name}» без детей`);
  }
});
