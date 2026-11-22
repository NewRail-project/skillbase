// ui/components/avatar.js — аватар-чип и выбор аватара с превью.
// ЖД-аватары рисуются inline SVG (shared/avatars.js), эмодзи-пресеты
// продолжают показываться как раньше.
import { h } from "../../shared/dom.js";
import {
  avatarPreset, avatarSvg, PICKER_PRESETS, DEFAULT_AVATAR_VALUE, isImageAvatar, validateAvatarFile
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
  // Собственное фото (JPEG data-URL, проверено isImageAvatar): везде, где
  // показывается пользователь — рейтинг, Live, Battle, история.
  if (isImageAvatar(value)) {
    return h("span", { class: `${cls} avatar-chip-img`, "aria-hidden": "true" },
      h("img", { src: value, alt: "", draggable: "false", decoding: "async" }));
  }
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
// allowUpload + processFile(file) → Promise<dataUrl>: загрузка своего фото
// (только профиль зарегистрированного пользователя; гости остаются на пресетах).
export function avatarPicker({ value = DEFAULT_AVATAR_VALUE, onChange = null, presets = PICKER_PRESETS, allowUpload = false, processFile = null } = {}) {
  let current = (avatarPreset(value) || (allowUpload && isImageAvatar(value))) ? value : DEFAULT_AVATAR_VALUE;
  const previewBox = h("div", { class: "avatar-preview", "aria-hidden": "true" });
  const previewLabel = h("div", { class: "avatar-preview-label", "aria-live": "polite" });
  const grid = h("div", { class: "avatar-preset-grid avatar-picker-grid", role: "radiogroup", "aria-label": "Аватар" });
  const cells = new Map();

  const paintPreview = () => {
    const preset = avatarPreset(current);
    previewBox.textContent = "";
    if (isImageAvatar(current)) {
      previewBox.style.background = "transparent";
      previewBox.appendChild(h("img", { src: current, alt: "", class: "avatar-preview-img" }));
      previewLabel.textContent = "Ваше фото";
      return;
    }
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
    // Выбрано своё фото: пресеты остаются доступны с клавиатуры (Tab).
    if (!avatarPreset(current)) { const first = cells.values().next().value; if (first) first.tabIndex = 0; }
    removeBtn.hidden = !isImageAvatar(current);
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

  // ---- Свое фото ----
  const uploadError = h("div", { class: "avatar-error", role: "alert" });
  const fileInput = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", class: "avatar-file-input", hidden: "hidden", "aria-label": "Выбрать фото" });
  const uploadBtn = h("button", { type: "button", class: "btn secondary", onclick: () => fileInput.click() }, "Загрузить своё фото");
  const removeBtn = h("button", { type: "button", class: "btn secondary", hidden: "hidden", onclick: () => { uploadError.textContent = ""; select(DEFAULT_AVATAR_VALUE); } }, "Убрать фото");
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    uploadError.textContent = "";
    if (!file) return;
    const problem = validateAvatarFile(file);
    if (problem) { uploadError.textContent = problem; return; }
    uploadBtn.disabled = true;
    uploadBtn.textContent = "Обрабатываем…";
    try {
      select(await processFile(file));
    } catch (err) {
      uploadError.textContent = err?.message || "Не удалось обработать изображение.";
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = "Загрузить своё фото";
    }
  });
  const uploadBox = allowUpload && typeof processFile === "function"
    ? h("div", { class: "avatar-upload" },
      h("div", { class: "btn-row" }, uploadBtn, removeBtn, fileInput),
      h("p", { class: "form-hint" }, "JPEG, PNG или WebP до 5 МБ. Фото обрежется до квадрата и уменьшится — другие участники увидят его в рейтингах и Live."),
      uploadError)
    : null;

  const el = h("div", { class: "avatar-picker" },
    h("div", { class: "avatar-picker-head" }, previewBox, previewLabel),
    uploadBox,
    grid);
  select(current, false);
  return {
    el,
    getValue: () => current,
    setValue: (v) => { if (avatarPreset(v) || (allowUpload && isImageAvatar(v))) select(v, false); }
  };
}
