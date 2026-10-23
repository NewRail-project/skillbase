// shared/dom.js — безопасные DOM-хелперы.
// Контракт: h() создаёт элементы без innerHTML. Данные пользователя только через textContent.
// esc() — для редких случаев, где нужен HTML-текст (например, атрибуты).

const ALLOWED_HREF = /^#|^https:|^mailto:/;

// Логические атрибуты нельзя выставлять через setAttribute(false):
// атрибут "checked=false" всё равно считается присутствующим, и браузер
// включает чекбокс/кнопку. Поэтому для них используем DOM-свойства.
const BOOLEAN_PROPS = {
  checked: "checked",
  disabled: "disabled",
  selected: "selected",
  hidden: "hidden",
  readonly: "readOnly",
  required: "required",
  multiple: "multiple"
};

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') {
      el.className = value;
    } else if (key === 'dataset') {
      for (const [dk, dv] of Object.entries(value)) {
        el.dataset[dk] = dv;
      }
    } else if (key.startsWith('aria-')) {
      el.setAttribute(key, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      const evt = key.slice(2).toLowerCase();
      el.addEventListener(evt, value);
    } else if (key === 'href') {
      if (typeof value === 'string' && ALLOWED_HREF.test(value)) {
        el.href = value;
      }
    } else if (Object.prototype.hasOwnProperty.call(BOOLEAN_PROPS, key)) {
      el[BOOLEAN_PROPS[key]] = Boolean(value);
    } else {
      el.setAttribute(key, value);
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      el.appendChild(document.createTextNode(String(child)));
    } else {
      el.appendChild(child);
    }
  }
  return el;
}

export function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}