// shared/svg.js — безопасные SVG-хелперы.
// Создают SVG DOM-элементы без использования парсеров.

const SVG_NS = "http://www.w3.org/2000/svg";
const ALLOWED_TAGS = ['svg', 'path', 'polyline', 'rect', 'line', 'circle'];
const ALLOWED_ATTRS = ['viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd', 'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'points', 'x1', 'y1', 'x2', 'y2', 'aria-hidden', 'focusable', 'class', 'opacity'];

export function createSVGElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null) el.setAttribute(key, value);
  }
  return el;
}

export function createSVG(tag, attrs = {}, children = []) {
  const svg = createSVGElement(tag, attrs);
  for (const child of children) {
    if (child) svg.appendChild(child);
  }
  return svg;
}

export function createIcon(iconData) {
  const match = iconData.match(/^<svg([^>]*)>([\s\S]*)<\/svg>$/);
  if (!match) throw new Error('Invalid icon format: must be <svg>...</svg>');

  const svg = createSVGElement('svg');
  const attrRegex = /([a-z-]+)="([^"]*)"/g;
  
  // Парсинг атрибутов SVG
  let attr;
  while ((attr = attrRegex.exec(match[1])) !== null) {
    if (!ALLOWED_ATTRS.includes(attr[1])) throw new Error(`Forbidden attribute: ${attr[1]}`);
    svg.setAttribute(attr[1], attr[2]);
  }

  // Парсинг дочерних элементов
  const childRegex = /<([a-z]+)([^/>]*)(\/?)>/g;
  let childMatch;
  while ((childMatch = childRegex.exec(match[2])) !== null) {
    const tag = childMatch[1];
    if (!ALLOWED_TAGS.includes(tag)) throw new Error(`Forbidden tag: ${tag}`);
    
    const el = createSVGElement(tag);
    const attrsStr = childMatch[2];
    let attr;
    while ((attr = attrRegex.exec(attrsStr)) !== null) {
      if (!ALLOWED_ATTRS.includes(attr[1])) throw new Error(`Forbidden attribute: ${attr[1]}`);
      el.setAttribute(attr[1], attr[2]);
    }
    svg.appendChild(el);
  }
  
  return svg;
}

export function createRailScene() { /* ... сохраненная реализация ... */ }