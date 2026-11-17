// tests/helpers/fake-dom.js — минимальный DOM для запуска настоящих страниц
// в Node без браузера (jsdom в проекте нет). Реализует ровно то, что нужно
// shared/dom.js (h), charts.js и страницам: создание элементов, дерево,
// события, value у select, textContent. Это заглушка окружения, а не
// заглушка логики страницы: сама страница выполняется целиком.

class TextNode {
  constructor(text) { this.nodeType = 3; this.nodeValue = String(text); this.parentNode = null; }
  get textContent() { return this.nodeValue; }
}

export class El {
  constructor(tag) {
    this.nodeType = 1;
    this.tag = tag;
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.dataset = {};
    this.style = {};
    this.className = "";
    this.parentNode = null;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  // Как в браузере: null/undefined/число превращаются в ТЕКСТ («null»), а не
  // пропускаются — именно так на странице дисциплины появлялось слово «null».
  append(...items) {
    for (const item of items) {
      this.appendChild(item && typeof item === "object" ? item : new TextNode(String(item)));
    }
  }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type, extra = {}) {
    const event = { type, target: this, preventDefault() {}, ...extra };
    // Как в браузере: и addEventListener, и свойство onchange/onclick/...
    if (typeof this["on" + type] === "function") this["on" + type](event);
    for (const fn of this.listeners[type] || []) fn(event);
  }
  click() { this.dispatch("click"); }
  // Простые селекторы: "tag" и ".class" — достаточно страницам проекта.
  matches(selector) {
    return selector.startsWith(".")
      ? this.className.split(/\s+/).includes(selector.slice(1))
      : this.tag === selector;
  }
  closest(selector) {
    for (let el = this; el; el = el.parentNode) if (el.nodeType === 1 && el.matches(selector)) return el;
    return null;
  }
  querySelectorAll(selector) {
    const out = [];
    const walk = el => { for (const c of el.children) if (c.nodeType === 1) { if (c.matches(selector)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  get textContent() { return this.children.map(c => c.textContent).join(""); }
  set textContent(value) { this.children = value === "" ? [] : [new TextNode(value)]; }
  // select.value — значение выбранного option (как в браузере).
  get value() {
    if (this.tag !== "select") return this._value ?? "";
    const opts = this.children.filter(c => c.tag === "option");
    const picked = opts.find(o => o.selected) || opts[0];
    return picked ? (picked.getAttribute("value") ?? "") : "";
  }
  set value(v) {
    if (this.tag !== "select") { this._value = v; return; }
    for (const o of this.children.filter(c => c.tag === "option")) o.selected = (o.getAttribute("value") ?? "") === v;
  }
}

export function installFakeDom() {
  globalThis.document = {
    createElement: tag => new El(tag),
    createElementNS: (_ns, tag) => new El(tag),
    createTextNode: text => new TextNode(text)
  };
}

// ---------- Помощники запросов к дереву ----------
export function findAll(root, predicate, out = []) {
  if (root.nodeType === 1) {
    if (predicate(root)) out.push(root);
    for (const child of root.children) findAll(child, predicate, out);
  }
  return out;
}
export const findOne = (root, predicate) => findAll(root, predicate)[0] || null;
export const byLabel = (root, label) => findOne(root, e => e.attrs["aria-label"] === label);
export const text = el => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

// Панель (section.panel) по заголовку h2.
export function panelByTitle(root, title) {
  return findOne(root, e => e.tag === "section" && findOne(e, x => x.tag === "h2" && text(x) === title));
}
// Опции select → [{ value, label, selected }].
export function optionsOf(select) {
  return select.children.filter(c => c.tag === "option")
    .map(o => ({ value: o.getAttribute("value") ?? "", label: text(o), selected: Boolean(o.selected) }));
}
// Выбор значения в select + событие change (как действие пользователя).
export function choose(select, value) {
  select.value = value;
  select.dispatch("change");
}
// Карточки .stat → { "Подпись": { value, hint } }.
export function statsOf(panel) {
  const out = {};
  for (const el of findAll(panel, e => e.className === "stat")) {
    const label = text(findOne(el, e => e.className === "stat-label"));
    out[label] = {
      value: text(findOne(el, e => e.className === "stat-value")),
      hint: text(findOne(el, e => /stat-hint/.test(e.className)))
    };
  }
  return out;
}
// Строки таблицы → массив массивов ячеек.
export function tableRows(root) {
  return findAll(root, e => e.tag === "tr")
    .filter(tr => findOne(tr, c => c.tag === "td"))
    .map(tr => tr.children.map(c => text(c)));
}
