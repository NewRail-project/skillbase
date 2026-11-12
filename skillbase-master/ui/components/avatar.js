// ui/components/avatar.js — аватар-чип и выбор аватара с превью.
// ЖД-аватары рисуются inline SVG (shared/avatars.js), эмодзи-пресеты
// продолжают показываться как раньше.
import { h } from "../../shared/dom.js";
import {
  avatarPreset, avatarSvg, PICKER_PRESETS, DEFAULT_AVATAR_VALUE
} from "../../shared/avatars.js";

// h() не поддерживает innerHTML (сделано намеренно: данные — только через
// textContent), поэтому статичный SVG из shared/avatars.js (собран из
// констант, без пользовательских данных) вставляется явно.
export function withSvg(el, svg) {
  el.innerHTML = svg;
  return el;
}

// Круглый аватар для рейтинга, подиума, списков. value — "preset:<id>".
export function avatarChip(value, name = "", extraClass = "") {
  const preset = avatarPreset(value);
  const cls = `avatar-chip ${extraClass}`.trim();
  if (preset) {
    const svg = avatarSvg(preset, 40);
    if (svg) {
      return withSvg(h("span", {
        class: `${cls} avatar-chip-svg`,
        style: `background:${preset.bg}`,
        "aria-hidden": "true"
      }), svg);
    }
    return h("span", { class: cls, style: `background:${preset.bg}`, "aria-hidden": "true" }, preset.emoji);
  }
  return h("span", { class: `${cls} avatar-chip-fallback`, "aria-hidden": "true" },
    String(name || "У").trim().slice(0, 1).toUpperCase() || "?");
}

// Выбор аватара: крупное превью + сетка вариантов (radiogroup, доступна
// с клавиатуры стрелками). Возвращает { el, getValue, setValue }.
export function avatarPicker({ value = DEFAULT_AVATAR_VALUE, onChange = null, presets = PICKER_PRESETS } = {}) {
  let current = avatarPreset(value) ? value : DEFAULT_AVATAR_VALUE;
  const previewBox = h("div", { class: "avatar-preview", "aria-hidden": "true" });
  const previewLabel = h("div", { class: "avatar-preview-label", "aria-live": "polite" });
  const grid = h("div", { class: "avatar-preset-grid avatar-picker-grid", role: "radiogroup", "aria-label": "Аватар" });
  const cells = new Map();

  const paintPreview = () => {
    const preset = avatarPreset(current);
    previewBox.textContent = "";
    if (!preset) return;
    previewBox.style.background = preset.bg;
    const svg = avatarSvg(preset, 96);
    if (svg) previewBox.innerHTML = svg; else previewBox.textContent = preset.emoji;
    previewLabel.textContent = preset.label || preset.id;
  };

  const select = (next, notify = true) => {
    current = next;
    for (const [id, cell] of cells) {
      const on = id === current;
      cell.classList.toggle("selected", on);
      cell.setAttribute("aria-checked", String(on));
      cell.tabIndex = on ? 0 : -1;
    }
    paintPreview();
    if (notify && onChange) onChange(current);
  };

  presets.forEach((preset, index) => {
    const id = `preset:${preset.id}`;
    const cell = withSvg(h("button", {
      type: "button",
      role: "radio",
      class: "avatar-preset-cell",
      style: `background:${preset.bg}`,
      title: preset.label || preset.id,
      "aria-label": `${preset.label || preset.id}, вариант ${(preset.id.split("-")[1]) || index + 1}`,
      onclick: () => select(id),
      onkeydown: (event) => {
        const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        if (!(event.key in keys)) return;
        event.preventDefault();
        const nextPreset = presets[(index + keys[event.key] + presets.length) % presets.length];
        select(`preset:${nextPreset.id}`);
        cells.get(`preset:${nextPreset.id}`)?.focus();
      }
    }), avatarSvg(preset, 44));
    cells.set(id, cell);
    grid.appendChild(cell);
  });

  const el = h("div", { class: "avatar-picker" },
    h("div", { class: "avatar-picker-head" }, previewBox, previewLabel),
    grid);
  select(current, false);
  return { el, getValue: () => current, setValue: (v) => { if (avatarPreset(v)) select(v, false); } };
}
