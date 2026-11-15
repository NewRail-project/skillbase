// core/material-library-logic.js — чистая логика библиотеки материалов
// (без DOM и Firebase: проверяется в Node, tests/material-library.test.js).
//
// Материалы переиспользуют существующую коллекцию materials/{id} +
// подколлекции pages/{n} (core/material-logic.js) — отдельной системы нет.
// Материал теста остаётся как был (id = testId); самостоятельные материалы
// имеют собственный auto-id и дополнительные поля: description, subjectId,
// topicId, order, status. Поля status нет у книг из редактора тестов —
// такое «наследие» считается опубликованным (isPublished).
//
// Зеркало ограничений firestore.rules для материалов: правила остаются
// основной границей безопасности, здесь те же проверки ради понятных
// ошибок на клиенте ДО записи.

export const MATERIAL_STATUS_DRAFT = "draft";
export const MATERIAL_STATUS_PUBLISHED = "published";
export const MATERIAL_STATUS_ARCHIVED = "archived";
export const MATERIAL_STATUSES = [
  MATERIAL_STATUS_DRAFT,
  MATERIAL_STATUS_PUBLISHED,
  MATERIAL_STATUS_ARCHIVED
];

// Лимиты согласованы с правилами: название как у материалов тестов
// (core/materials.js режет до 160), описание и порядок — как у тем
// (core/subjects-logic.js: описание ≤ 600).
export const MATERIAL_TITLE_MAX = 160;
export const MATERIAL_DESCRIPTION_MAX = 600;
export const ID_MAX = 64;
export const ORDER_MAX = 9999;

export const STATUS_LABEL = Object.freeze({
  [MATERIAL_STATUS_DRAFT]: "Черновик",
  [MATERIAL_STATUS_PUBLISHED]: "Опубликован",
  [MATERIAL_STATUS_ARCHIVED]: "В архиве"
});

export const LEVEL_CHAPTER = 1;   // уровень заголовка: глава (в оглавление)
export const LEVEL_SUB = 2;       // уровень заголовка: подзаголовок

// Статус нормализуем: неизвестное значение → fallback. Строки из
// недоверенного ввода в правила не попадут.
export function normalizeStatus(value, fallback = MATERIAL_STATUS_DRAFT) {
  return MATERIAL_STATUSES.includes(value) ? value : fallback;
}

// Опубликован ли документ: у книг из редактора тестов поля status нет —
// они считаются опубликованными (обратная совместимость, то же правило
// в firestore.rules). Явный архив и черновик студентам закрыты.
export function isPublished(data) {
  const status = data?.status;
  return status == null || status === MATERIAL_STATUS_PUBLISHED;
}

// Что видно в каталоге: студенту — только опубликованные; сотруднику —
// все, включая архив (архив восстанавливается).
export function visibleMaterials(items, role) {
  const list = Array.isArray(items) ? items : [];
  return role === "student"
    ? list.filter(item => isPublished(item))
    : list.slice();
}

// Сортировка каталога: order, затем название (как у предметов/тем).
export function sortMaterials(items) {
  return (Array.isArray(items) ? items.slice() : []).sort((a, b) =>
    (Number(a?.order) || 0) - (Number(b?.order) || 0)
    || String(a?.title || "").localeCompare(String(b?.title || ""), "ru"));
}

// ---------- Валидация карточки материала ----------

export function validateMaterialMeta(data, isCreate = false) {
  const errors = [];
  const d = data || {};
  const title = String(d.title ?? "").trim();
  if (!title) errors.push("Название материала не заполнено.");
  else if (title.length > MATERIAL_TITLE_MAX) {
    errors.push(`Название длиннее ${MATERIAL_TITLE_MAX} символов.`);
  }

  const description = String(d.description ?? "");
  if (description.length > MATERIAL_DESCRIPTION_MAX) {
    errors.push(`Описание длиннее ${MATERIAL_DESCRIPTION_MAX} символов.`);
  }

  if (d.status != null && !MATERIAL_STATUSES.includes(d.status)) {
    errors.push("Статус материала — черновик, опубликован или архив.");
  }

  if (d.order != null) {
    const order = Number(d.order);
    if (!Number.isInteger(order) || order < 0 || order > ORDER_MAX) {
      errors.push(`Порядок — целое число от 0 до ${ORDER_MAX}.`);
    }
  }

  for (const key of ["subjectId", "topicId"]) {
    // Пустая строка = «не выбрано» (то же, что отсутствие поля).
    if (d[key] == null || d[key] === "") continue;
    const value = String(d[key]);
    if (!value || value.length > ID_MAX || /[\/\s]/.test(value)) {
      errors.push(`Поле «${key === "subjectId" ? "предмет" : "тема"}» выбрано некорректно.`);
    }
  }
  // Тема без предмета не имеет смысла: правила организации проверяют
  // принадлежность через subjects, привязка всегда парой.
  if (d.topicId && !d.subjectId) {
    errors.push("Выберите предмет для выбранной темы.");
  }

  if (isCreate) {
    // Создание должно нести хотя бы одну страницу: правило materials
    // требует pageCount >= 1, страницы пишутся той же записью сохранения.
    const pages = Array.isArray(d.pages) ? d.pages : [];
    if (!pages.length) errors.push("Материал должен содержать хотя бы одну страницу.");
  }
  return errors;
}

// Поля карточки, которые уходят в Firestore (системные выставляет API).
// subjectId/topicId пишутся всегда: null снимает привязку (пустой выбор
// в редакторе должен стирать старую привязку, а не оставлять её).
export function materialMetaPatch(data) {
  const d = data || {};
  const patch = {
    title: String(d.title ?? "").trim().slice(0, MATERIAL_TITLE_MAX),
    description: String(d.description ?? "").slice(0, MATERIAL_DESCRIPTION_MAX),
    subjectId: d.subjectId ? String(d.subjectId) : null,
    topicId: d.topicId ? String(d.topicId) : null,
    order: Math.min(ORDER_MAX, Math.max(0, Number(d.order) || 0))
  };
  if (d.status != null) patch.status = normalizeStatus(d.status);
  return patch;
}

// ---------- Оглавление книги ----------

// Главы = заголовки уровня главы (level 1 или без level — книги,
// созданные раньше, и текст, разбитый из TXT, всегда дают главы).
// Возвращает [{ title, page }] — page: индекс страницы с 0.
export function deriveChapters(pages) {
  const chapters = [];
  (Array.isArray(pages) ? pages : []).forEach((blocks, page) => {
    (Array.isArray(blocks) ? blocks : []).forEach(block => {
      if (block?.type === "heading"
        && (block.level == null || block.level === LEVEL_CHAPTER)
        && String(block.text ?? "").trim()) {
        chapters.push({ title: String(block.text).trim(), page });
      }
    });
  });
  return chapters;
}

// Есть ли у книги оглавление из нескольких глав (показывать кнопку).
export function hasToc(pages) {
  return deriveChapters(pages).length > 1;
}

// ---------- Импорт и PDF ----------

// PDF хранится в подколлекции materials/{id}/files/{n} кусочками base64:
// Firestore-документ ограничен 1 МБ, кусок 256 КБ бинарно → ≈350 КБ base64.
// Встраивать PDF в браузерный просмотрщик не требуется: читалка отдаёт
// файл на скачивание и открытие системным просмотрщиком устройства.
export const PDF_MAX_BYTES = 4 * 1024 * 1024;
export const PDF_CHUNK_BIN = 256 * 1024;

export function pdfChunkCount(size) {
  const bytes = Number(size) || 0;
  if (bytes <= 0) return 0;
  return Math.ceil(bytes / PDF_CHUNK_BIN);
}

export function isValidPdfName(name) {
  const value = String(name ?? "");
  return value.length > 0 && value.length <= 120
    && !value.includes("/") && !value.includes("\\")
    && value.toLowerCase().endsWith(".pdf");
}

// ---------- Проверка содержимого PDF (этап 5, аудит) ----------
//
// Раньше проверялось только имя и размер: переименованный файл любого
// типа (например, .exe.pdf) загружался, а падал уже при открытии у
// ученика. Теперь дополнительно проверяются MIME-тип и магическая
// подпись «%PDF-» в начале файла.

// Допустимые MIME-типы. Пустая строка разрешена: часть браузеров и
// вебвью не выставляет type, но присылает корректную подпись.
const PDF_MIME_TYPES = ["application/pdf", "application/x-pdf", ""];

export function pdfMimeOk(type) {
  return PDF_MIME_TYPES.includes(String(type ?? "").toLowerCase());
}

// Магическая подпись PDF: первые байты файла начинаются с «%PDF-».
// bytes — Uint8Array/массив байтов; некорректный ввод → false.
export function pdfHeaderOk(bytes) {
  const sig = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
  if (!bytes || typeof bytes.length !== "number" || bytes.length < sig.length) {
    return false;
  }
  return sig.every((byte, i) => bytes[i] === byte);
}

// Полная проверка файла перед загрузкой: имя, MIME, подпись, размер.
// Возвращает строку ошибки или null.
export function pdfFileError(file) {
  if (!isValidPdfName(file?.name)) {
    return "Выберите файл PDF (имя без символов / \\, до 120 символов).";
  }
  if (!pdfMimeOk(file?.type)) {
    return "Это не похоже на PDF: тип файла не поддерживается.";
  }
  if (Number(file?.size) > PDF_MAX_BYTES) {
    return `Файл больше 4 МБ (${(file.size / 1024 / 1024).toFixed(1)} МБ). Сожмите PDF.`;
  }
  if (!file?.size) return "Файл пуст.";
  if (!pdfHeaderOk(file?.headerBytes)) {
    return "Файл не является PDF (нет подписи %PDF-). Возможно, расширение изменено вручную.";
  }
  return null;
}

// ---------- Возврат из читалки (этап 5) ----------
//
// Ссылки из темы передают источник в маршруте:
//   #material/<id>/free                      — старый формат: каталог материалов
//   #material/<id>/free/back:<encoded hash>  — возврат на исходную страницу
//   #material/<id>/free/<КОД КОМНАТЫ>        — из лобби Live-комнаты (легаси)
//   #material/<id>/preview/materials         — предпросмотр из каталога
// Разбор чистый: тестируется в Node.

export function readerBackTarget(parts) {
  const third = String(parts?.[2] || "");
  // Легаси: третий сегмент — код Live-комнаты (заглавные буквы/цифры).
  // «back:» — новый формат: закодированный адрес возврата.
  if (third.startsWith("back:")) {
    try {
      const target = decodeURIComponent(third.slice(5));
      // Возврат только на внутренние маршруты приложения.
      if (/^#(topic|discipline|disciplines|materials|quiz|room|assignments|student|home)\//.test(target)
        || /^(#(topic|disciplines|materials|assignments|student|home))$/.test(target)) {
        return { mode: "back", hash: target, label: backLabel(target) };
      }
      return { mode: "catalog", hash: "#materials", label: "К списку материалов" };
    } catch (_) {
      return { mode: "catalog", hash: "#materials", label: "К списку материалов" };
    }
  }
  if (third) return { mode: "room", hash: `#room/${third}`, label: "В комнату" };
  return { mode: "catalog", hash: "#materials", label: "К списку материалов" };
}

// Подпись кнопки выхода по адресу возврата.
export function backLabel(hash) {
  const h = String(hash || "");
  if (h.startsWith("#topic")) return "К теме";
  if (h.startsWith("#discipline/")) return "К дисциплине";
  if (h.startsWith("#disciplines")) return "К каталогу дисциплин";
  if (h.startsWith("#materials")) return "К списку материалов";
  if (h.startsWith("#create-test")) return "К редактору";
  if (h.startsWith("#room")) return "В комнату";
  if (h.startsWith("#assignments")) return "К заданиям";
  return "К тесту";
}

// Ссылка на материал с возвратом на текущую страницу:
//   materialLink(currentHash, materialId, mode)
// mode: "free" (добровольное чтение) — по умолчанию.
// Текущий хеш кодируется одним сегментом (# → %23, / → %2F), поэтому
// обновление страницы сохраняет контекст возврата.
export function materialLink(currentHash, materialId, mode = "free") {
  const back = String(currentHash || "").trim();
  if (!back || !/^#[a-zA-Z]/.test(back) || back.startsWith("#material")) {
    return `#material/${encodeURIComponent(materialId)}/${mode}`;
  }
  return `#material/${encodeURIComponent(materialId)}/${mode}/back:${encodeURIComponent(back)}`;
}

// ---------- Состояния прогресса изучения (этап 5) ----------
//
// Не открывал / Открыл / Читает / Завершил изучение. Состояния вычисляются
// из существующего materialProgress { lastPage, completed }:
//   • документа нет или lastPage == 0 и нет отметки чтения — «Не открывал»;
//   • документ есть (читалка открывалась — она пишет lastPage=0 при старте),
//     но страниц не листали и PDF не скачивали — «Открыл»;
//   • lastPage > 0 — «Читает»;
//   • completed — «Завершил изучение».
// Скачивание PDF НЕ считает материал завершённым: completed ставит только
// листание до последней страницы книги.

export function materialProgressState(progress) {
  const lastPage = Number(progress?.lastPage) || 0;
  const completed = progress?.completed === true;
  // exists — документ materialProgress существует: читалка открывалась
  // (она пишет lastPage=0 при старте). Старые данные без exists при
  // ненулевой странице всё равно считаются «читает/завершено».
  const opened = progress?.exists === true;
  if (completed) return { state: "done", label: "Завершил изучение" };
  if (lastPage > 0) return { state: "reading", label: "Читает" };
  if (opened) return { state: "opened", label: "Открыл" };
  return { state: "none", label: "Не открывал" };
}

// ---------- Черновик редактора (автосохранение) ----------

// Ключ локального черновика: для нового материала — «new».
export function draftKeyFor(materialId) {
  return `sb-mat-draft:${String(materialId || "").trim() || "new"}`;
}

// Структура черновика: карточка + страницы + время сохранения.
// serializeEditorDraft возвращает строку JSON или null (нечего хранить).
export function serializeEditorDraft(draft) {
  const d = draft || {};
  const pages = (Array.isArray(d.pages) ? d.pages : [])
    .map(blocks => (Array.isArray(blocks) ? blocks : []));
  const data = {
    title: String(d.title ?? "").slice(0, MATERIAL_TITLE_MAX),
    description: String(d.description ?? "").slice(0, MATERIAL_DESCRIPTION_MAX),
    subjectId: d.subjectId ? String(d.subjectId) : "",
    topicId: d.topicId ? String(d.topicId) : "",
    order: Number.isInteger(Number(d.order)) ? Number(d.order) : null,
    status: normalizeStatus(d.status),
    pages,
    savedAt: Number(d.savedAt) || Date.now()
  };
  try {
    return JSON.stringify(data);
  } catch (_) {
    return null; // приватный режим или цикл в данных
  }
}

// Восстановление черновика: некорректный JSON и чужая структура → null.
export function parseEditorDraft(raw) {
  if (!raw || typeof raw !== "string") return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    return null;
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.pages)) return null;
  const pages = data.pages
    .filter(blocks => Array.isArray(blocks))
    .map(blocks => blocks.filter(b => b && typeof b === "object"));
  return {
    title: String(data.title ?? ""),
    description: String(data.description ?? ""),
    subjectId: data.subjectId ? String(data.subjectId) : "",
    topicId: data.topicId ? String(data.topicId) : "",
    order: Number.isInteger(Number(data.order)) ? Number(data.order) : null,
    status: normalizeStatus(data.status),
    pages,
    savedAt: Number(data.savedAt) || 0
  };
}

// Пережил ли черновик перезапись: локальный новее документа Firestore —
// предлагаем восстановить локальный (защита от конфликтующих сохранений:
// параллельная вкладка не затирает работу молча).
export function draftIsNewer(draft, updatedAtMs) {
  const savedAt = Number(draft?.savedAt) || 0;
  return savedAt > (Number(updatedAtMs) || 0) + 1000;
}
