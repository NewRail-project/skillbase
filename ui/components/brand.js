// ui/components/brand.js — фирменные элементы Skillbase.
//
// Знак: железнодорожная колея в перспективе, сходящаяся в вершину.
// Читается одновременно как рельсы, путь и рост. Один цвет (currentColor),
// поэтому одинаково работает в светлой и тёмной темах и в монохроме.
// Слова "Skillbase" в SVG нет: надпись живёт рядом как текст интерфейса,
// поэтому знак остаётся самостоятельным и не зависит от шрифтов.

import { h } from "../../shared/dom.js";

export const MARK_PATH = "M7.5 27 L16 4.5 L24.5 27";
export const MARK_SLEEPERS = [
  "M6.86 25 H25.14",
  "M8.74 20 H23.26",
  "M10.63 15 H21.37",
  "M12.52 10 H19.48"
];

export function markSVG({ size = 32, cls = "brand-mark" } = {}) {
  return `<svg class="${cls}" viewBox="0 0 32 32" width="${size}" height="${size}" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" focusable="false">
    <path d="${MARK_PATH}"/>
    ${MARK_SLEEPERS.map(d => `<path d="${d}"/>`).join("")}
  </svg>`;
}

// Логотип-лок: знак + надпись. Используется в шапке и боковой панели.
export function brandLockup({ tagline = "", href = "#/", size = 28, compact = false } = {}) {
  const link = h("a", {
    class: "brand" + (compact ? " brand-compact" : ""),
    href,
    "aria-label": "Skillbase — на главную"
  });
  link.innerHTML = markSVG({ size }) + `
    <span class="brand-text">
      <span class="brand-name">Skillbase</span>
      ${tagline ? `<span class="brand-tagline">${tagline}</span>` : ""}
    </span>`;
  return link;
}

// Перспектива железной дороги для шапки главной страницы.
// Геометрия просчитана: рельсы сходятся к точке схода (600, 232),
// шпалы укорачиваются и утолщаются к переднему плану.
export function railScene() {
  const sleepers = [
    [595.2, 233.1, 604.8, 1.25],
    [587.6, 236.1, 612.4, 1.40],
    [575.6, 240.8, 624.4, 1.62],
    [559.4, 247.3, 640.6, 1.93],
    [539.0, 255.3, 661.0, 2.32],
    [514.5, 265.0, 685.5, 2.78],
    [486.1, 276.2, 713.9, 3.32],
    [453.8, 288.9, 746.2, 3.93],
    [417.7, 303.2, 782.3, 4.61],
    [377.7, 319.0, 822.3, 5.37],
    [334.0, 336.3, 866.0, 6.19],
    [286.5, 355.0, 913.5, 7.09],
    [235.3, 375.2, 964.7, 8.06],
    [180.5, 396.9, 1019.5, 9.09],
    [122.0, 420.0, 1078.0, 10.20]
  ];

  const svg = `
  <svg class="rail-scene" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="sb-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" class="sky-top" stop-color="var(--hero-sky-1)"/>
        <stop offset="0.72" class="sky-mid" stop-color="var(--hero-sky-2)"/>
        <stop offset="1" class="sky-low" stop-color="var(--hero-sky-3)"/>
      </linearGradient>
      <linearGradient id="sb-ballast" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" class="bal-top" stop-color="var(--hero-ballast-1)"/>
        <stop offset="1" class="bal-low" stop-color="var(--hero-ballast-2)"/>
      </linearGradient>
      <radialGradient id="sb-glow" cx="0.5" cy="0.55" r="0.5">
        <stop offset="0" stop-color="var(--hero-glow)" stop-opacity="0.95"/>
        <stop offset="1" stop-color="var(--hero-glow)" stop-opacity="0"/>
      </radialGradient>
    </defs>

    <rect width="1200" height="420" fill="url(#sb-sky)"/>
    <ellipse cx="600" cy="250" rx="520" ry="150" fill="url(#sb-glow)"/>

    <!-- Дальний план: депо, водонапорная башня, мачты -->
    <g class="rail-far" fill="var(--hero-far)" opacity="0.5">
      <path d="M0 258 H1200 V420 H0 Z" opacity="0.35"/>
      <path d="M60 258 v-26 h70 v26 z"/>
      <path d="M150 258 v-44 h34 v44 z"/>
      <path d="M232 258 v-18 h96 v18 z"/>
      <path d="M980 258 v-36 h54 v36 z"/>
      <path d="M1060 258 v-22 h86 v22 z"/>
      <path d="M330 258 c30-30 70-30 100 0 z"/>
      <path d="M820 258 c40-40 90-40 130 0 z"/>
    </g>

    <!-- Контактная сеть -->
    <g class="rail-masts" stroke="var(--hero-mast)" fill="none" stroke-linecap="round" opacity="0.55">
      <path d="M170 420 V212" stroke-width="4"/>
      <path d="M170 236 H292" stroke-width="3"/>
      <path d="M170 262 H268" stroke-width="3"/>
      <path d="M1030 420 V212" stroke-width="4"/>
      <path d="M908 236 H1030" stroke-width="3"/>
      <path d="M932 262 H1030" stroke-width="3"/>
      <path d="M600 240 V196" stroke-width="2"/>
      <path d="M566 214 H634" stroke-width="2"/>
      <path d="M292 236 L600 196 L908 236" stroke-width="1.4" opacity="0.7"/>
      <path d="M268 262 L600 196 L932 262" stroke-width="1.2" opacity="0.5"/>
    </g>

    <!-- Балласт -->
    <path d="M40 420 L560 240 H640 L1160 420 Z" fill="url(#sb-ballast)"/>

    <!-- Шпалы -->
    <g class="rail-sleepers" stroke="var(--hero-sleeper)" stroke-linecap="round" fill="none">
      ${sleepers.map(([x1, y, x2, w]) => `<path d="M${x1} ${y} H${x2}" stroke-width="${w}"/>`).join("")}
    </g>

    <!-- Рельсы -->
    <g class="rail-lines" fill="var(--hero-rail)">
      <path d="M142 420 L592 232 L600 232 L146 420 Z"/>
      <path d="M1058 420 L608 232 L600 232 L1054 420 Z"/>
      <path d="M140 420 L146 420 L600 232 L594 232 Z" opacity="0.55"/>
      <path d="M1054 420 L1060 420 L606 232 L600 232 Z" opacity="0.55"/>
    </g>

    <!-- Сигнал -->
    <g class="rail-signal">
      <rect x="1116" y="286" width="6" height="134" fill="var(--hero-mast)" opacity="0.6"/>
      <circle cx="1119" cy="282" r="7" fill="var(--signal)"/>
      <circle cx="1119" cy="282" r="13" fill="var(--signal)" opacity="0.18"/>
    </g>

    <!-- Передний план: затемнение под текст -->
    <rect y="300" width="1200" height="120" fill="var(--hero-fade)"/>
  </svg>`;

  return svg;
}
