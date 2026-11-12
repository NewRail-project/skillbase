// ui/pages/material-editor.js — редактор самостоятельных материалов
// (маршрут #material-editor/<id>; без id — новый материал). Только
// персонал. Логика страниц — core/material-logic.js (paginateText,
// validatePage), Firestore-слой — core/material-library.js; карточка
// материала живёт в той же коллекции materials/{id}, что и книги тестов.
//
// Редактор построен «нажми и заполни»: страница книги показывается как
// читалка, клик по любому блоку открывает его правку, между блоками и
// после последнего блока — кнопки добавления. На телефоне — те же
// крупные зоны касания.
//
// Автосохранение: изменения всегда дублируются в localStorage черновик
// (задержка 1 с, не чаще), в Firestore — 8 с после последнего ввода, если
// материал уже создан (правила требуют ≥ 1 страницы). Защита от
// конфликтов: одновременных записей нет (флаг в полёте), после ошибки
// локальный черновик сохраняется и предлагается к восстановлению.
import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { toast } from "../components/toast.js";
import { confirmAction } from "../components/confirm.js";
import {
  paginateText, validatePage, pageTextLength, pageFillRatio,
  PAGE_MIN_TEXT, IMAGE_MAX_BYTES, IMAGE_MAX_DIM, CALLOUT_KINDS
} from "../../core/material-logic.js";
import {
  validateMaterialMeta, normalizeStatus, draftKeyFor, serializeEditorDraft,
  parseEditorDraft, draftIsNewer, LEVEL_CHAPTER, LEVEL_SUB
} from "../../core/material-library-logic.js";
import {
  loadLibraryMaterial, createLibraryMaterial, updateLibraryMaterial,
  saveLibraryMaterialPages, saveLibraryPdf, removeLibraryPdf,
  readPdfFile
} from "../../core/material-library.js";
import { getSubjects, getTopics } from "../../core/subjects.js";

const DRAFT_LOCAL_MS = 1000;   // пауза перед записью локального черновика
const DRAFT_REMOTE_MS = 8000;  // пауза перед записью в Firestore
const BLOCK_TYPES = [
  ["heading", "Заголовок"], ["paragraph", "Абзац"], ["list", "Список"],
  ["callout", "Вызов"], ["image", "Изображение"], ["quote", "Цитата"]
];
const BLOCK_LABELS = {
  heading: "Заголовок", paragraph: "Абзац", list: "Список",
  callout: "Вызов", image: "Изображение", quote: "Цитата"
};

// ---------- Сжатие изображения (как в редакторе тестов) ----------

async function compressImageFile(file, targetBytes = IMAGE_MAX_BYTES) {
  const srcUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const probe = new Image();
      probe.onload = () => resolve(probe);
      probe.onerror = reject;
      probe.src = srcUrl;
    });
    let width = Math.min(img.naturalWidth, IMAGE_MAX_DIM);
    let height = Math.round(img.naturalHeight * (width / img.naturalWidth));
    let quality = 0.7;
    for (let step = 0; step < 6; step++) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrl.length * 0.75 <= targetBytes) return dataUrl;
      if (width > 480) {
        width = Math.round(width * 0.8);
        height = Math.round(height * 0.8);
      } else quality = Math.max(0.4, quality - 0.1);
    }
    throw new Error("Не удалось сжать изображение до 300 КБ.");
  } finally {
    URL.revokeObjectURL(srcUrl);
  }
}

// ---------- Предпросмотр блока (тот же вид, что в читалке) ----------

function blockPreview(block) {
  switch (block?.type) {
    case "heading":
      return h(block.level === LEVEL_SUB ? "h3" : "h2",
        { class: "book-h ed-bp-h" }, block.text || "");
    case "list":
      return h("ul", { class: "book-list ed-bp" },
        (block.items || []).map(item => h("li", {}, String(item ?? ""))));
    case "callout": {
      const cls = block.kind === "warning" ? "book-callout warning"
        : block.kind === "rule" ? "book-callout rule" : "book-callout";
      return h("aside", { class: cls },
        h("span", { class: "book-callout-label" },
          block.kind === "warning" ? "Важно" : block.kind === "rule" ? "Правило" : "К сведению"),
        h("p", { class: "book-p", style: "margin:0" }, block.text || ""));
    }
    case "image":
      return h("figure", { class: "book-figure" },
        block.src ? h("img", { src: block.src, alt: "" }) : null,
        h("figcaption", { class: "book-caption" }, block.caption || ""));
    case "quote":
      return h("blockquote", { class: "book-quote" }, block.text || "");
    default:
      return h("p", { class: "book-p ed-bp" }, block.text || "");
  }
}

export default async function MaterialEditorPage() {
  const page = h("div", { class: "page material-editor-page" });
  const materialId = decodeURIComponent((State.routeParam || "").split("/")[0] || "");
  // «new» и пустой id — новый материал (#material-editor/new из каталога).
  const isNew = !materialId || materialId === "new";

  // ---------- Состояние редактора ----------
  const state = {
    id: isNew ? "" : materialId,
    title: "",
    description: "",
    subjectId: "",
    topicId: "",
    order: null,
    status: normalizeStatus("draft"),
    pages: isNew ? [[{ type: "paragraph", text: "" }]] : [],
    // системные поля созданного документа
    authorId: "", updatedAtMs: 0, pdf: null
  };
  let pageIndex = 0;
  let loaded = false;
  let dirty = false;          // есть несохранённые изменения
  let saveInFlight = false;   // защита от конфликтующих параллельных записей
  let remoteTimer = null;
  let localTimer = null;
  const draftKey = draftKeyFor(materialId);

  const storage = (() => {
    try {
      const probe = window.localStorage;
      probe.setItem("sb-probe", "1");
      probe.removeItem("sb-probe");
      return probe;
    } catch (_) {
      return null;
    }
  })();

  // ---------- Каркас страницы ----------
  const back = h("a", { class: "btn secondary", href: "#materials" }, "К списку материалов");
  const headTitle = h("h1", {}, isNew ? "Новый материал" : "Редактор материала");

  const titleInput = h("input", { type: "text", maxlength: "160", placeholder: "Название материала" });
  const descriptionInput = h("textarea", { rows: "3", maxlength: "600", placeholder: "Описание (необязательно)" });
  const subjectSelect = h("select", {}, h("option", { value: "" }, "Предмет (не выбран)"));
  const topicSelect = h("select", { disabled: "disabled" }, h("option", { value: "" }, "Сначала выберите предмет"));
  const orderInput = h("input", { type: "number", min: "0", max: "9999", placeholder: "Порядок в каталоге" });
  const statusSelect = h("select", {},
    [["draft", "Черновик"], ["published", "Опубликован"], ["archived", "В архиве"]]
      .map(([v, label]) => h("option", { value: v }, label)));

  const subjectsCache = [];
  const topicsCache = new Map();

  // ---------- Индикация сохранения ----------
  const saveStatus = h("div", { class: "form-hint", role: "status" }, "Данные не менялись.");
  function paintSaveStatus(text, isError) {
    saveStatus.textContent = text;
    saveStatus.className = isError ? "form-error" : "form-hint";
  }

  // ---------- Метаданные:subjects/topics ----------
  async function loadSubjects() {
    try {
      const subjects = await getSubjects();
      subjectsCache.length = 0;
      subjects.forEach(s => { if (s.status !== "archived") subjectsCache.push(s); });
      paintSubjectOptions();
      if (state.subjectId) {
        await loadTopics(state.subjectId, state.topicId);
      }
    } catch (err) {
      console.error(err);
    }
  }

  function paintSubjectOptions() {
    subjectSelect.textContent = "";
    subjectSelect.appendChild(h("option", { value: "" }, "Предмет (не выбран)"));
    subjectsCache.forEach(s => {
      subjectSelect.appendChild(h("option", { value: s.id }, s.title || "Предмет"));
    });
    subjectSelect.value = state.subjectId || "";
  }

  async function loadTopics(subjectId, selectedTopicId = "") {
    topicSelect.textContent = "";
    topicSelect.appendChild(h("option", { value: "" }, "Тема (не выбрана)"));
    if (!subjectId) {
      topicSelect.disabled = true;
      state.topicId = "";
      return;
    }
    if (!topicsCache.has(subjectId)) {
      try {
        topicsCache.set(subjectId, await getTopics(subjectId));
      } catch (err) {
        console.error(err);
        topicsCache.set(subjectId, []);
      }
    }
    (topicsCache.get(subjectId) || []).forEach(topic => {
      if (topic.status !== "archived") {
        topicSelect.appendChild(h("option", { value: topic.id }, topic.title || "Тема"));
      }
    });
    topicSelect.disabled = false;
    topicSelect.value = selectedTopicId || "";
    state.topicId = topicSelect.value || "";
  }

  subjectSelect.addEventListener("change", () => {
    state.subjectId = subjectSelect.value || "";
    state.topicId = "";
    markDirty();
    loadTopics(state.subjectId);
  });
  topicSelect.addEventListener("change", () => {
    state.topicId = topicSelect.value || "";
    markDirty();
  });

  // ---------- Автосохранение ----------
  function markDirty() {
    dirty = true;
    scheduleLocalDraft();
    scheduleRemoteSave();
  }

  function scheduleLocalDraft() {
    if (!storage) return;
    if (localTimer) clearTimeout(localTimer);
    localTimer = setTimeout(() => {
      localTimer = null;
      paintSaveStatus("Сохранено на устройстве…");
      const raw = serializeEditorDraft(state);
      try {
        if (raw) storage.setItem(draftKey, raw);
      } catch (_) { /* приватный режим */ }
    }, DRAFT_LOCAL_MS);
  }

  function scheduleRemoteSave() {
    if (!loaded || !state.id) return; // новый материал: Firestore после «Создать»
    if (remoteTimer) clearTimeout(remoteTimer);
    remoteTimer = setTimeout(() => { remoteTimer = null; saveToFirestore(); }, DRAFT_REMOTE_MS);
  }

  async function saveToFirestore(silent = true) {
    if (saveInFlight || !state.id || !loaded) return;
    const metaErrors = validateMaterialMeta(state, false);
    if (metaErrors.length) {
      paintSaveStatus(`Черновик не сохранён в каталоге: ${metaErrors[0]}`, true);
      return;
    }
    const badPages = state.pages
      .map((blocks, i) => (validatePage(blocks).length ? i + 1 : null))
      .filter(Boolean);
    if (badPages.length) {
      paintSaveStatus(`Черновик не сохранён в каталоге: заполните страницы ${badPages.join(", ")}.`, true);
      return;
    }
    saveInFlight = true;
    if (!silent) paintSaveStatus("Сохраняем…");
    try {
      await updateLibraryMaterial(state.id, state);
      await saveLibraryMaterialPages(state.id, state.pages);
      dirty = false;
      if (storage) {
        try { storage.removeItem(draftKey); } catch (_) { /* пусто */ }
      }
      paintSaveStatus(silent
        ? `Сохранено в ${timeNow()}.`
        : `Материал сохранён: ${state.pages.length} стр.`);
      if (!silent) toast("Материал сохранён", "success");
    } catch (err) {
      // Локальный черновик уже хранит введённый текст: данные не потеряны.
      paintSaveStatus(`Не сохранено: ${err?.message || "ошибка записи"}`, true);
    } finally {
      saveInFlight = false;
      if (dirty) scheduleRemoteSave();
    }
  }

  function timeNow() {
    return new Date().toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
  }

  // Кнопка «Сохранить» — немедленная запись вне таймеров.
  const saveBtn = h("button", { type: "button", class: "btn primary" }, "Сохранить материал");
  saveBtn.addEventListener("click", () => saveToFirestore(false));

  // ---------- Создание материала ----------
  const createBtn = h("button", { type: "button", class: "btn primary" }, "Создать материал");
  createBtn.addEventListener("click", async () => {
    paintSaveStatus("");
    const metaErrors = validateMaterialMeta({ ...state, pages: state.pages }, true);
    const badPages = state.pages
      .map((blocks, i) => (validatePage(blocks).length ? i + 1 : null))
      .filter(Boolean);
    if (metaErrors.length || badPages.length) {
      paintSaveStatus(
        (metaErrors[0] || "") + (badPages.length ? ` Заполните страницы: ${badPages.join(", ")}.` : ""),
        true);
      return;
    }
    createBtn.disabled = true;
    try {
      const id = await createLibraryMaterial(state);
      state.id = id;
      // Дальше редактор продолжает работу над созданным документом.
      window.history.replaceState(null, "", `#material-editor/${id}`);
      headTitle.textContent = "Редактор материала";
      createBtn.replaceWith(saveBtn);
      previewBtn.disabled = false;
      pdfUploadBtn.disabled = false;
      await saveToFirestore(true);
      toast("Материал создан", "success");
    } catch (err) {
      paintSaveStatus(err?.message || "Не удалось создать материал.", true);
    } finally {
      createBtn.disabled = false;
    }
  });

  const previewBtn = h("button", {
    type: "button", class: "btn secondary",
    onclick: () => {
      if (state.id) {
        // Самостоятельный материал: предпросмотр вернёт в каталог
        // материалов (см. fromLibrary в ui/pages/material.js).
        window.location.hash = `#material/${encodeURIComponent(state.id)}/preview/materials`;
      }
    }
  }, "Предпросмотр");

  // ---------- Загрузка существующего материала ----------
  async function loadExisting() {
    try {
      const material = await loadLibraryMaterial(materialId);
      if (!material) {
        page.appendChild(h("div", { class: "panel" },
          h("p", {}, "Материал не найден."),
          back));
        return false;
      }
      state.id = material.id;
      state.title = material.title || "";
      state.description = material.description || "";
      state.subjectId = material.subjectId || "";
      state.topicId = material.topicId || "";
      state.order = material.order != null ? Number(material.order) : null;
      state.status = normalizeStatus(material.status, "draft");
      state.authorId = material.authorId || "";
      state.updatedAtMs = material.updatedAt?.toMillis?.() || 0;
      state.pdf = material.pdfName ? {
        name: material.pdfName,
        size: Number(material.pdfSize) || 0
      } : null;
      state.pages = material.pages.length
        ? material.pages.map(blocks => blocks.map(b => ({ ...b })))
        : [[{ type: "paragraph", text: "" }]];
      loaded = true;
      return true;
    } catch (err) {
      page.appendChild(h("div", { class: "panel" },
        h("p", { class: "form-error" },
          err?.code === "permission-denied"
            ? "Правила Firestore не разрешают чтение материала."
            : (err?.message || "Материал не загружен.")),
        back));
      return false;
    }
  }

  // ---------- Восстановление локального черновика ----------
  function restoreDraft() {
    if (!storage) return;
    let raw = null;
    try { raw = storage.getItem(draftKey); } catch (_) { /* нет storage */ }
    const draft = parseEditorDraft(raw);
    if (!draft || !draft.pages.length) return;
    if (!draftIsNewer(draft, state.updatedAtMs)) {
      try { storage.removeItem(draftKey); } catch (_) { /* пусто */ }
      return;
    }
    // Черновик новее документа: не затираем работу молча — спрашиваем.
    confirmAction({
      title: "Восстановить черновик?",
      text: "На устройстве есть более новая несохранённая версия материала. "
        + "«Восстановить» вернёт её, «Отменить» продолжит с версией каталога.",
      confirmLabel: "Восстановить"
    }).then(ok => {
      if (!ok) {
        try { storage.removeItem(draftKey); } catch (_) { /* пусто */ }
        return;
      }
      state.title = draft.title || state.title;
      state.description = draft.description || state.description;
      state.subjectId = draft.subjectId || state.subjectId;
      state.topicId = draft.topicId || state.topicId;
      state.order = draft.order != null ? draft.order : state.order;
      state.status = normalizeStatus(draft.status, state.status);
      state.pages = draft.pages.map(blocks => blocks.map(b => ({ ...b })));
      pageIndex = 0;
      paintMeta();
      paintSubjectOptions();
      loadTopics(state.subjectId, state.topicId);
      paintPagesNav();
      paintPageEditor();
      paintSaveStatus("Черновик восстановлен с устройства.");
    }).catch(() => { /* окно отклонено — работаем дальше */ });
  }

  // ---------- Блочный редактор страницы ----------
  const pagesNav = h("div", { class: "btn-row mat-pages-nav", style: "flex-wrap:wrap" });
  const pageCanvas = h("div", { class: "book mat-page-canvas" });
  const canvasNote = h("div", { class: "form-hint" });

  function paintPageEditor() {
    const blocks = state.pages[pageIndex] || [];
    pageCanvas.textContent = "";
    canvasNote.textContent = `Страница ${pageIndex + 1}: текста — ${pageTextLength(blocks)} симв. `
      + `Нажмите на блок, чтобы заполнить или изменить его.`;

    // Каждый блок — зона касания: клик открывает правку, между блоками —
    // кнопки добавления нового блока.
    const adderAt = (position) => {
      const btn = h("button", {
        type: "button", class: "btn secondary mat-adder",
        "aria-label": "Добавить блок"
      }, "+ Блок");
      btn.addEventListener("click", () => {
        const choice = buildBlockChooser();
        choice.then(block => {
          if (!block) return;
          blocks.splice(position, 0, block);
          markDirty();
          paintPageEditor();
          paintPagesNav();
        });
      });
      return btn;
    };

    pageCanvas.appendChild(adderAt(0));
    blocks.forEach((block, i) => {
      const card = h("div", {
        class: "mat-block-slot",
        role: "button",
        tabindex: "0",
        "aria-label": `Блок ${i + 1}: ${BLOCK_LABELS[block.type] || block.type}`
      },
        h("div", { class: "mat-block-tag" }, `Блок ${i + 1} · ${BLOCK_LABELS[block.type] || block.type}`),
        blockPreview(block));
      card.addEventListener("click", () => openBlockEditor(i));
      card.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openBlockEditor(i);
        }
      });
      pageCanvas.appendChild(card);
      pageCanvas.appendChild(adderAt(i + 1));
    });

    const fill = pageFillRatio(blocks);
    canvasNote.textContent += ` Заполнено ${Math.round(fill * 100)}%`
      + ` (страница проходит проверку от ${PAGE_MIN_TEXT} симв. текста).`;
  }

  // Выбор типа нового блока — маленькое окно-меню, возвращает блок.
  function buildBlockChooser() {
    return new Promise(resolve => {
      const menu = h("div", { class: "modal-overlay", role: "dialog", "aria-label": "Тип блока" },
        h("div", { class: "modal mat-chooser" },
          h("h3", {}, "Добавить блок"),
          h("div", { class: "mat-chooser-list" },
            BLOCK_TYPES.map(([type, label]) => h("button", {
              type: "button", class: "btn secondary",
              onclick: () => { close(); resolve(makeBlock(type)); }
            }, label)),
            h("button", {
              type: "button", class: "btn secondary",
              onclick: () => { close(); resolve(null); }
            }, "Отмена"))));
      const close = () => menu.remove();
      page.appendChild(menu);
    });
  }

  function makeBlock(type) {
    if (type === "heading") return { type, text: "", level: LEVEL_CHAPTER };
    if (type === "list") return { type, items: [] };
    if (type === "callout") return { type, kind: "info", text: "" };
    if (type === "image") return { type, src: "", caption: "" };
    return { type, text: "" };
  }

  // Правка блока: inline-карта с полями по типу. Всё крупно, под палец.
  function openBlockEditor(index) {
    const blocks = state.pages[pageIndex] || [];
    const block = blocks[index];
    if (!block) return;
    const card = h("div", { class: "mat-block-edit" });
    const textInput = h("textarea", { rows: "4", maxlength: "1200" });
    textInput.value = block.text || "";
    const levelSelect = h("select", {},
      [["1", "Глава (в оглавление)"], ["2", "Подзаголовок"]]
        .map(([v, label]) => h("option", { value: v }, label)));
    levelSelect.value = String(block.level === LEVEL_SUB ? LEVEL_SUB : LEVEL_CHAPTER);
    let subFields = h("div", {});

    function rebuild() {
      subFields.textContent = "";
      if (block.type === "heading") {
        subFields.appendChild(h("label", {}, "Уровень"), levelSelect,
          h("label", {}, "Заголовок"), textInput);
      } else if (block.type === "list") {
        const itemsInput = h("textarea", { rows: "4", placeholder: "Пункт 1\nПункт 2" });
        itemsInput.value = (block.items || []).join("\n");
        itemsInput.addEventListener("input", () => {
          block.items = itemsInput.value.split("\n").map(s => s.trim()).filter(Boolean);
          markDirty();
        });
        subFields.appendChild(h("label", {}, "Пункты (по одному в строке)"), itemsInput);
      } else if (block.type === "callout") {
        const kindSelect = h("select", {},
          [["info", "К сведению"], ["warning", "Важно"], ["rule", "Правило"]]
            .map(([v, x]) => h("option", { value: v }, x)));
        kindSelect.value = CALLOUT_KINDS.includes(block.kind) ? block.kind : "info";
        kindSelect.addEventListener("change", () => {
          block.kind = kindSelect.value;
          markDirty();
        });
        subFields.appendChild(h("label", {}, "Вид вызова"), kindSelect,
          h("label", {}, "Текст"), textInput);
      } else if (block.type === "image") {
        const fileInput = h("input", { type: "file", accept: "image/*" });
        const caption = h("input", { type: "text", maxlength: "200", placeholder: "Подпись обязательна" });
        caption.value = block.caption || "";
        caption.addEventListener("input", () => {
          block.caption = caption.value;
          markDirty();
        });
        fileInput.addEventListener("change", async () => {
          const file = fileInput.files?.[0];
          if (!file) return;
          try {
            paintSaveStatus("Сжимаем изображение…");
            block.src = await compressImageFile(file);
            markDirty();
            paintSaveStatus("Изображение готово.");
          } catch (err) {
            paintSaveStatus(err?.message || "Изображение не загружено.", true);
          }
        });
        subFields.appendChild(h("label", {}, "Файл изображения"), fileInput,
          h("label", {}, "Подпись"), caption);
      } else {
        subFields.appendChild(h("label", {}, "Текст"), textInput);
      }
    }

    textInput.addEventListener("input", () => {
      block.text = textInput.value;
      markDirty();
    });
    levelSelect.addEventListener("change", () => {
      block.level = Number(levelSelect.value);
      markDirty();
    });
    rebuild();

    const actions = h("div", { class: "btn-row" },
      h("button", {
        type: "button", class: "btn secondary",
        disabled: index === 0,
        onclick: () => {
          [blocks[index - 1], blocks[index]] = [blocks[index], blocks[index - 1]];
          markDirty(); close(); paintPageEditor();
        }
      }, "↑ Выше"),
      h("button", {
        type: "button", class: "btn secondary",
        disabled: index >= blocks.length - 1,
        onclick: () => {
          [blocks[index + 1], blocks[index]] = [blocks[index], blocks[index + 1]];
          markDirty(); close(); paintPageEditor();
        }
      }, "↓ Ниже"),
      h("button", {
        type: "button", class: "btn danger",
        onclick: () => {
          blocks.splice(index, 1);
          markDirty(); close(); paintPageEditor(); paintPagesNav();
        }
      }, "Удалить блок"),
      h("button", { type: "button", class: "btn primary", onclick: close }, "Готово"));

    card.append(subFields, actions);
    pageCanvas.querySelectorAll(".mat-block-edit").forEach(el => el.remove());
    pageCanvas.querySelectorAll(".mat-block-slot")[index]?.after(card);
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // ---------- Навигация по страницам ----------
  function paintPagesNav() {
    pagesNav.textContent = "";
    state.pages.forEach((blocks, n) => {
      const chip = h("button", {
        type: "button",
        class: "chip" + (n === pageIndex ? " active" : ""),
        "aria-pressed": String(n === pageIndex)
      }, `${n + 1} · ${Math.round(pageFillRatio(blocks) * 100)}%`);
      chip.addEventListener("click", () => {
        pageIndex = n;
        paintPageEditor();
        paintPagesNav();
      });
      pagesNav.appendChild(chip);
    });
    pagesNav.appendChild(h("button", {
      type: "button", class: "chip",
      onclick: () => {
        state.pages.push([{ type: "paragraph", text: "" }]);
        pageIndex = state.pages.length - 1;
        markDirty();
        paintPageEditor();
        paintPagesNav();
      }
    }, "+ страница"));
  }

  // ---------- Импорт текста (вставка и TXT) ----------
  const bulkInput = h("textarea", {
    rows: "6",
    placeholder: "Вставьте весь текст материала одним куском. Пустая строка — новый абзац; "
      + "короткая строка без точки или строка с «#» — глава; строки с «-» — список."
  });
  const bulkInfo = h("div", { class: "form-hint" }, "Текст ещё не вставлен.");
  const bulkFile = h("input", { type: "file", accept: ".txt,.md,text/plain" });
  const replaceBtn = h("button", { type: "button", class: "btn primary" }, "Разбить и заменить страницы");
  const appendBtn = h("button", { type: "button", class: "btn secondary" }, "Добавить в конец книги");

  function updateBulkInfo() {
    const text = bulkInput.value;
    if (!text.trim()) { bulkInfo.textContent = "Текст ещё не вставлен."; return; }
    bulkInfo.textContent = `${text.length} симв. → получится страниц: ${paginateText(text).length}.`;
  }
  bulkInput.addEventListener("input", updateBulkInfo);

  // TXT/MD: UTF-8, при «кракозябрах» — windows-1251.
  bulkFile.addEventListener("change", async () => {
    const file = bulkFile.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      let text = new TextDecoder("utf-8").decode(buffer);
      if (text.includes("\uFFFD")) text = new TextDecoder("windows-1251").decode(buffer);
      bulkInput.value = text;
      updateBulkInfo();
    } catch (err) {
      paintSaveStatus(err?.message || "Не удалось прочитать файл.", true);
    }
  });

  async function applyBulk(mode) {
    const newPages = paginateText(bulkInput.value);
    if (!newPages.length) {
      paintSaveStatus("Вставьте текст материала.", true);
      return;
    }
    const hasContent = state.pages.some(blocks => pageTextLength(blocks) > 0);
    if (mode === "replace" && hasContent) {
      const ok = await confirmAction({
        title: "Заменить страницы?",
        text: `Текущие страницы (${state.pages.length}) будут заменены новыми (${newPages.length}).`,
        confirmLabel: "Заменить",
        tone: "danger"
      });
      if (!ok) return;
    }
    if (mode === "replace" || !hasContent) state.pages.length = 0;
    else if (state.pages.length && !pageTextLength(state.pages[state.pages.length - 1])) state.pages.pop();
    pageIndex = state.pages.length;
    state.pages.push(...newPages);
    bulkInput.value = "";
    bulkInfo.textContent = "Текст ещё не вставлен.";
    markDirty();
    paintPageEditor();
    paintPagesNav();
    const bad = newPages.map((b, i) => (validatePage(b).length ? i + 1 : null)).filter(Boolean);
    paintSaveStatus(`Готово: ${newPages.length} стр.`
      + (bad.length ? ` Слишком короткие страницы: ${bad.join(", ")} — дополните текст.` : ""),
      bad.length > 0);
  }
  replaceBtn.addEventListener("click", () => applyBulk("replace"));
  appendBtn.addEventListener("click", () => applyBulk("append"));

  // ---------- PDF ----------
  const pdfInput = h("input", { type: "file", accept: ".pdf,application/pdf" });
  const pdfInfo = h("div", { class: "form-hint" }, state.pdf ? `Вложение: ${state.pdf.name}` : "PDF не вложен.");
  const pdfUploadBtn = h("button", { type: "button", class: "btn secondary", disabled: isNew ? "disabled" : "" }, "Загрузить PDF");
  const pdfRemoveBtn = h("button", { type: "button", class: "btn danger", disabled: state.pdf ? "" : "disabled" }, "Убрать PDF");

  pdfUploadBtn.addEventListener("click", () => pdfInput.click());
  pdfInput.addEventListener("change", async () => {
    const file = pdfInput.files?.[0];
    if (!file) return;
    if (!state.id) {
      paintSaveStatus("Сначала создайте материал — PDF сохраняется в его документ.", true);
      return;
    }
    try {
      paintSaveStatus("Загружаем PDF…");
      const pdf = await readPdfFile(file);
      const total = Math.ceil(pdf.size / (256 * 1024));
      paintSaveStatus(`Загружаем PDF: 0/${total}…`);
      await saveLibraryPdf(state.id, pdf);
      state.pdf = { name: pdf.name, size: pdf.size };
      pdfInfo.textContent = `Вложение: ${pdf.name} (${(pdf.size / 1024 / 1024).toFixed(1)} МБ).`;
      pdfRemoveBtn.disabled = false;
      paintSaveStatus(`PDF загружен: ${total} частей.`);
      toast("PDF загружен", "success");
    } catch (err) {
      paintSaveStatus(err?.message || "PDF не загружен.", true);
    } finally {
      pdfInput.value = "";
    }
  });

  pdfRemoveBtn.addEventListener("click", async () => {
    if (!state.id || !state.pdf) return;
    const ok = await confirmAction({
      title: "Убрать PDF?",
      text: "Вложение будет удалено из материала.",
      confirmLabel: "Убрать"
    });
    if (!ok) return;
    try {
      await removeLibraryPdf(state.id);
      state.pdf = null;
      pdfInfo.textContent = "PDF не вложен.";
      pdfRemoveBtn.disabled = true;
      paintSaveStatus(`PDF убран (${timeNow()}).`);
    } catch (err) {
      paintSaveStatus(err?.message || "Не удалось убрать PDF.", true);
    }
  });

  // ---------- Метаданные: события и отрисовка ----------
  titleInput.addEventListener("input", () => { state.title = titleInput.value; markDirty(); });
  descriptionInput.addEventListener("input", () => { state.description = descriptionInput.value; markDirty(); });
  orderInput.addEventListener("input", () => {
    const value = orderInput.value.trim();
    state.order = value === "" ? null : Number(value);
    markDirty();
  });
  statusSelect.addEventListener("change", () => {
    state.status = normalizeStatus(statusSelect.value, state.status);
    markDirty();
  });

  function paintMeta() {
    titleInput.value = state.title || "";
    descriptionInput.value = state.description || "";
    orderInput.value = state.order == null ? "" : String(state.order);
    statusSelect.value = state.status;
  }

  // ---------- Сборка страницы ----------
  const metaPanel = h("section", { class: "panel" },
    h("div", { class: "panel-head" }, h("h2", {}, "Карточка материала"),
      h("div", { style: "display:flex;gap:var(--space-2);flex-wrap:wrap" },
        previewBtn, isNew ? createBtn : saveBtn)),
    h("div", { class: "panel-body" },
      h("label", {}, "Название"), titleInput,
      h("label", {}, "Описание"), descriptionInput,
      h("div", { class: "split" },
        h("div", {}, h("label", {}, "Предмет"), subjectSelect, topicSelect),
        h("div", {}, h("label", {}, "Порядок в каталоге"), orderInput,
          h("label", {}, "Статус"), statusSelect)),
      saveStatus));

  const bookPanel = h("section", { class: "panel" },
    h("div", { class: "panel-head" }, h("h2", {}, "Книга")),
    h("div", { class: "panel-body" },
      h("details", { class: "field", open: "open" },
        h("summary", {}, "Вставить весь текст (разбить на страницы автоматически)"),
        h("div", { class: "field" }, bulkInput, bulkInfo, bulkFile,
          h("div", { class: "btn-row" }, replaceBtn, appendBtn))),
      pagesNav, pageCanvas, canvasNote));

  const pdfPanel = h("section", { class: "panel" },
    h("div", { class: "panel-head" }, h("h2", {}, "PDF-вложение")),
    h("div", { class: "panel-body" },
      h("p", { class: "form-hint" },
        "PDF хранится частями (до 4 МБ). Студенты скачивают файл и открывают его на своём устройстве; "
        + "просмотрщик в браузере не требуется."),
      pdfInfo,
      h("div", { class: "btn-row" }, pdfUploadBtn, pdfRemoveBtn, pdfInput)));

  page.append(h("div", { class: "page-head" }, back, headTitle), metaPanel, bookPanel, pdfPanel);

  // ---------- Инициализация ----------
  paintPageEditor();
  paintPagesNav();
  loadSubjects();
  if (isNew) {
    loaded = true;
    previewBtn.disabled = true;
    restoreDraft();
  } else {
    const ok = await loadExisting();
    if (!ok) return page;
    // Правила разрешают изменять материал только автору; другие
    // сотрудники могут читать и предпросматривать.
    if (state.authorId && state.authorId !== State.user.uid) {
      saveBtn.disabled = true;
      createBtn.style.display = "none";
      paintSaveStatus("Материал другого автора — запись доступна только ему.", true);
    }
    paintMeta();
    await loadTopics(state.subjectId, state.topicId);
    paintPagesNav();
    paintPageEditor();
    restoreDraft();
    pdfInfo.textContent = state.pdf ? `Вложение: ${state.pdf.name}` : "PDF не вложен.";
    pdfRemoveBtn.disabled = state.pdf ? "" : "disabled";
  }
  return page;
}
