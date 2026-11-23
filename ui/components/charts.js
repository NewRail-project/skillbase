// ui/components/charts.js — лёгкие графики без зависимостей.
// lineChart (SVG), barChart и progressMeter (HTML: хорошо читаются на
// телефоне и не требуют библиотек). Данные попадают в DOM только через
// textContent/атрибуты — без innerHTML.
import { h } from "../../shared/dom.js";
import { createSVG, createSVGElement } from "../../shared/svg.js";

const clampPct = (v) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));
const tone = (v) => (v >= 75 ? "is-high" : v >= 50 ? "is-mid" : "is-low");

// points: [{ label, value }] — значения 0..100.
export function lineChart(points = [], { ariaLabel = "График", height = 180 } = {}) {
  const data = (points || []).filter(p => Number.isFinite(p?.value));
  if (!data.length) return h("p", { class: "chart-empty" }, "Нет данных для графика.");
  const W = 320, padL = 28, padR = 10, padT = 10, padB = 24;
  const innerW = W - padL - padR, innerH = height - padT - padB;
  const x = (i) => padL + (data.length === 1 ? innerW / 2 : (innerW * i) / (data.length - 1));
  const y = (v) => padT + innerH * (1 - clampPct(v) / 100);
  const svg = createSVG("svg", {
    viewBox: `0 0 ${W} ${height}`, class: "chart-line", role: "img", "aria-label": ariaLabel
  });
  for (const g of [0, 50, 100]) {
    svg.appendChild(createSVGElement("line", { class: "chart-grid", x1: padL, x2: W - padR, y1: y(g), y2: y(g) }));
    const t = createSVGElement("text", { x: 2, y: y(g) + 4 });
    t.textContent = String(g);
    svg.appendChild(t);
  }
  svg.appendChild(createSVGElement("polyline", {
    class: "chart-path", points: data.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ")
  }));
  const step = Math.max(1, Math.ceil(data.length / 6));
  data.forEach((p, i) => {
    const dot = createSVGElement("circle", { class: "chart-dot", cx: x(i).toFixed(1), cy: y(p.value).toFixed(1), r: 3.5 });
    const title = createSVGElement("title");
    title.textContent = `${p.label}: ${Math.round(p.value)}%`;
    dot.appendChild(title);
    svg.appendChild(dot);
    if (i % step === 0 || (i === data.length - 1 && (data.length - 1) % step >= Math.ceil(step / 2))) {
      // Крайние подписи прижаты внутрь, иначе последняя дата обрезается краем графика.
      const anchor = data.length > 1 && i === 0 ? "start" : (data.length > 1 && i >= data.length - 1 - (data.length - 1) % step && i === data.length - 1) ? "end" : "middle";
      const t = createSVGElement("text", { x: x(i).toFixed(1), y: height - 6, "text-anchor": anchor });
      t.textContent = String(p.label ?? "");
      svg.appendChild(t);
    }
  });
  return svg;
}

// items: [{ label, value, hint? }] — значения 0..max.
export function barChart(items = [], { ariaLabel = "Диаграмма", max = 100 } = {}) {
  const rows = (items || []).filter(i => Number.isFinite(i?.value));
  if (!rows.length) return h("p", { class: "chart-empty" }, "Нет данных для диаграммы.");
  return h("ul", { class: "chart-bars", role: "list", "aria-label": ariaLabel },
    rows.map(r => {
      const pct = max > 0 ? Math.max(0, Math.min(100, (r.value / max) * 100)) : 0;
      const fill = h("div", { class: `chart-bar-fill ${tone(pct)}` });
      fill.style.width = `${pct}%`;
      return h("li", { class: "chart-bar" },
        h("span", { class: "chart-bar-label", title: String(r.label ?? "") }, String(r.label ?? "—")),
        h("div", { class: "chart-bar-track", role: "presentation" }, fill),
        h("span", { class: "chart-bar-value" }, r.hint ?? `${Math.round(r.value)}%`));
    }));
}

// percent: 0..100 или null (нет данных).
export function progressMeter(percent, { label = "Прогресс" } = {}) {
  const known = Number.isFinite(percent);
  const pct = known ? clampPct(percent) : 0;
  const fill = h("div", { class: `chart-bar-fill ${tone(pct)}` });
  fill.style.width = `${pct}%`;
  return h("div", { class: "progress-meter", role: "progressbar",
    "aria-label": label, "aria-valuemin": "0", "aria-valuemax": "100",
    "aria-valuenow": known ? String(Math.round(pct)) : null },
    h("div", { class: "progress-meter-head" }, h("span", {}, label), h("b", {}, known ? `${Math.round(pct)}%` : "—")),
    h("div", { class: "chart-bar-track" }, fill));
}
