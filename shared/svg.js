// shared/svg.js — безопасные SVG-хелперы.
// Создают SVG DOM-элементы без использования парсеров.

const SVG_NS = "http://www.w3.org/2000/svg";
const ALLOWED_TAGS = ['svg', 'path', 'polyline', 'rect', 'line', 'circle', 'defs', 'linearGradient', 'stop', 'radialGradient', 'ellipse', 'g'];
const ALLOWED_ATTRS = ['viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd', 'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'points', 'x1', 'y1', 'x2', 'y2', 'aria-hidden', 'focusable', 'class', 'opacity', 'id', 'offset', 'stop-color', 'stop-opacity', 'preserveAspectRatio'];

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

  let attr;
  while ((attr = attrRegex.exec(match[1])) !== null) {
    if (!ALLOWED_ATTRS.includes(attr[1])) throw new Error(`Forbidden attribute: ${attr[1]}`);
    svg.setAttribute(attr[1], attr[2]);
  }

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

export function createRailScene() {
  const defs = createSVGElement('defs');

  const skyGradient = createSVG('linearGradient', {
    id: 'sb-sky',
    x1: '0',
    y1: '0',
    x2: '0',
    y2: '1'
  }, [
    createSVGElement('stop', { offset: '0', class: 'sky-top', 'stop-color': 'var(--hero-sky-1)' }),
    createSVGElement('stop', { offset: '0.72', class: 'sky-mid', 'stop-color': 'var(--hero-sky-2)' }),
    createSVGElement('stop', { offset: '1', class: 'sky-low', 'stop-color': 'var(--hero-sky-3)' })
  ]);

  const ballastGradient = createSVG('linearGradient', {
    id: 'sb-ballast',
    x1: '0',
    y1: '0',
    x2: '0',
    y2: '1'
  }, [
    createSVGElement('stop', { offset: '0', class: 'bal-top', 'stop-color': 'var(--hero-ballast-1)' }),
    createSVGElement('stop', { offset: '1', class: 'bal-low', 'stop-color': 'var(--hero-ballast-2)' })
  ]);

  const glowGradient = createSVG('radialGradient', {
    id: 'sb-glow',
    cx: '0.5',
    cy: '0.55',
    r: '0.5'
  }, [
    createSVGElement('stop', { offset: '0', 'stop-color': 'var(--hero-glow)', 'stop-opacity': '0.95' }),
    createSVGElement('stop', { offset: '1', 'stop-color': 'var(--hero-glow)', 'stop-opacity': '0' })
  ]);

  defs.appendChild(skyGradient);
  defs.appendChild(ballastGradient);
  defs.appendChild(glowGradient);

  const rect = createSVGElement('rect', {
    width: '1200',
    height: '420',
    fill: 'url(#sb-sky)'
  });

  const ellipse = createSVGElement('ellipse', {
    cx: '600',
    cy: '250',
    rx: '520',
    ry: '150',
    fill: 'url(#sb-glow)'
  });

  const farGroup = createSVGElement('g', {
    class: 'rail-far',
    fill: 'var(--hero-far)',
    opacity: '0.5'
  });

  [
    { d: 'M0 258 H1200 V420 H0 Z', opacity: '0.35' },
    { d: 'M60 258 v-26 h70 v26 z' },
    { d: 'M150 258 v-44 h34 v44 z' },
    { d: 'M232 258 v-18 h96 v18 z' },
    { d: 'M980 258 v-36 h54 v36 z' },
    { d: 'M1060 258 v-22 h86 v22 z' },
    { d: 'M330 258 c30-30 70-30 100 0 z' },
    { d: 'M820 258 c40-40 90-40 130 0 z' }
  ].forEach(p => farGroup.appendChild(createSVGElement('path', p)));

  const mastsGroup = createSVGElement('g', {
    class: 'rail-masts',
    stroke: 'var(--hero-mast)',
    fill: 'none',
    'stroke-linecap': 'round',
    opacity: '0.55'
  });

  [
    { d: 'M170 420 V212', 'stroke-width': '4' },
    { d: 'M170 236 H292', 'stroke-width': '3' },
    { d: 'M170 262 H268', 'stroke-width': '3' },
    { d: 'M1030 420 V212', 'stroke-width': '4' },
    { d: 'M908 236 H1030', 'stroke-width': '3' },
    { d: 'M932 262 H1030', 'stroke-width': '3' },
    { d: 'M600 240 V196', 'stroke-width': '2' },
    { d: 'M566 214 H634', 'stroke-width': '2' },
    { d: 'M292 236 L600 196 L908 236', 'stroke-width': '1.4', opacity: '0.7' },
    { d: 'M268 262 L600 196 L932 262', 'stroke-width': '1.2', opacity: '0.5' }
  ].forEach(p => mastsGroup.appendChild(createSVGElement('path', p)));

  const ballast = createSVGElement('path', {
    d: 'M40 420 L560 240 H640 L1160 420 Z',
    fill: 'url(#sb-ballast)'
  });

  const sleepersGroup = createSVGElement('g', {
    class: 'rail-sleepers',
    stroke: 'var(--hero-sleeper)',
    'stroke-linecap': 'round',
    fill: 'none'
  });

  const sleepers = [
    [595.2, 233.1, 604.8, 1.25], [587.6, 236.1, 612.4, 1.40], [575.6, 240.8, 624.4, 1.62],
    [559.4, 247.3, 640.6, 1.93], [539.0, 255.3, 661.0, 2.32], [514.5, 265.0, 685.5, 2.78],
    [486.1, 276.2, 713.9, 3.32], [453.8, 288.9, 746.2, 3.93], [417.7, 303.2, 782.3, 4.61],
    [377.7, 319.0, 822.3, 5.37], [334.0, 336.3, 866.0, 6.19], [286.5, 355.0, 913.5, 7.09],
    [235.3, 375.2, 964.7, 8.06], [180.5, 396.9, 1019.5, 9.09], [122.0, 420.0, 1078.0, 10.20]
  ];

  sleepers.forEach(([x1, y, x2, w]) => {
    sleepersGroup.appendChild(createSVGElement('path', { d: `M${x1} ${y} H${x2}`, 'stroke-width': String(w) }));
  });

  const railsGroup = createSVGElement('g', {
    class: 'rail-lines',
    fill: 'var(--hero-rail)'
  });

  [
    { d: 'M142 420 L592 232 L600 232 L146 420 Z' },
    { d: 'M1058 420 L608 232 L600 232 L1054 420 Z' },
    { d: 'M140 420 L146 420 L600 232 L594 232 Z', opacity: '0.55' },
    { d: 'M1054 420 L1060 420 L606 232 L600 232 Z', opacity: '0.55' }
  ].forEach(p => railsGroup.appendChild(createSVGElement('path', p)));

  const signalGroup = createSVGElement('g', { class: 'rail-signal' });
  signalGroup.appendChild(createSVGElement('rect', { x: '1116', y: '286', width: '6', height: '134', fill: 'var(--hero-mast)', opacity: '0.6' }));
  signalGroup.appendChild(createSVGElement('circle', { cx: '1119', cy: '282', r: '7', fill: 'var(--signal)' }));
  signalGroup.appendChild(createSVGElement('circle', { cx: '1119', cy: '282', r: '13', fill: 'var(--signal)', opacity: '0.18' }));

  return createSVG('svg', {
    class: 'rail-scene',
    viewBox: '0 0 1200 420',
    'preserveAspectRatio': 'xMidYMid slice',
    'aria-hidden': 'true',
    'focusable': 'false'
  }, [defs, rect, ellipse, farGroup, mastsGroup, ballast, sleepersGroup, railsGroup, signalGroup, createSVGElement('rect', { y: '300', width: '1200', height: '120', fill: 'var(--hero-fade)' })]);
}