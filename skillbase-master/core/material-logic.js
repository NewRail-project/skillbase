// core/material-logic.js — чистая логика учебного материала-книги.
// Без DOM и Firebase: проверяется в Node (tests/material-logic.test.js).
//
// Хранение: materials/{testId} (title, pageCount, orgId, authorId) и
// подколлекция materials/{testId}/pages/{n} — одна страница на документ
// (лимит документа Firestore 1 МБ легко соблюдать, страница ≈1200 символов).
// Страница = { blocks: [...] }.

export const BLOCK_TYPES = ["heading", "paragraph", "list", "callout", "image", "quote"];
export const CALLOUT_KINDS = ["info", "warning", "rule"];

// Лимиты страницы (под экран телефона без прокрутки).
export const PAGE_MIN_TEXT = 200;          // пустую страницу сохранить нельзя
export const PAGE_MAX_TEXT = 1200;         // ≈ экран
export const IMAGE_MAX_BYTES = 300 * 1024; // 300 КБ после сжатия
export const IMAGE_MAX_DIM = 1000;         // сторона картинки до 1000 px

function blockText(block) {
  if (!block || typeof block !== "object") return "";
  if (Array.isArray(block.items)) {
    return block.items.map(item => String(item ?? "")).join("\n");
  }
  return typeof block.text === "string" ? block.text : "";
}

// Сколько «понятного» текста даёт страница: слова параграфов, списков,
// вызовов, цитат и подписей картинок.
export function pageTextLength(blocks) {
  return (Array.isArray(blocks) ? blocks : []).reduce((sum, block) => {
    if (block?.type === "image") return sum + String(block.caption ?? "").trim().length;
    if (block?.type === "heading") {
      // Заголовок не текст повествования: не добирает порог пустоты.
      return sum + Math.max(0, String(block.text ?? "").length - 40);
    }
    return sum + blockText(block).length;
  }, 0);
}

export function hasImageWithCaption(blocks) {
  return (Array.isArray(blocks) ? blocks : []).some(block =>
    block?.type === "image"
    && typeof block.src === "string" && block.src.length > 0
    && String(block.caption ?? "").trim().length > 0);
}

// Валидация БЛОКА: возвращает список ошибок (кратко, на русском).
export function validateBlock(block, context = "Блок") {
  const errors = [];
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    return [`${context}: некорректные данные`];
  }
  switch (block.type) {
    case "heading":
      if (!String(block.text ?? "").trim()) errors.push(`${context}: заголовок пуст`);
      else if (String(block.text).length > 120) errors.push(`${context}: заголовок длиннее 120 символов`);
      break;
    case "paragraph":
    case "quote":
      if (!String(block.text ?? "").trim()) errors.push(`${context}: текст отсутствует`);
      else if (String(block.text).length > 1200) errors.push(`${context}: длиннее 1200 символов`);
      break;
    case "list":
      if (!Array.isArray(block.items) || !block.items.length) {
        errors.push(`${context}: список пуст`);
      } else {
        block.items.forEach((item, index) => {
          if (!String(item ?? "").trim()) errors.push(`${context}: пункт ${index + 1} пуст`);
        });
      }
      break;
    case "callout":
      if (!CALLOUT_KINDS.includes(block.kind)) errors.push(`${context}: вид вызова — info, warning или rule`);
      if (!String(block.text ?? "").trim()) errors.push(`${context}: текст вызова отсутствует`);
      break;
    case "image": {
      const src = String(block.src ?? "");
      if (!src.startsWith("https://") && !src.startsWith("data:image/")) {
        errors.push(`${context}: только https-ссылка или изображение с устройства`);
      } else if (src.length > 500_000) {
        errors.push(`${context}: изображение больше 300 КБ`);
      }
      if (!String(block.caption ?? "").trim()) errors.push(`${context}: подпись к изображению обязательна`);
      break;
    }
    default:
      errors.push(`${context}: неизвестный тип блока`);
  }
  return errors;
}

// Валидация страницы: минимум текста или картинка с подписью,
// максимум ~1200 символов, все блоки структурно корректны.
export function validatePage(blocks) {
  const errors = [];
  const list = Array.isArray(blocks) ? blocks : [];
  if (!list.length) {
    return ["Страница пуста: добавьте текст или изображение с подписью."];
  }

  list.forEach((block, index) => {
    validateBlock(block, `Блок ${index + 1}`).forEach(err => errors.push(err));
  });

  if (errors.length) return errors;

  const textLength = pageTextLength(list);
  if (textLength < PAGE_MIN_TEXT && !hasImageWithCaption(list)) {
    errors.push(`Страница слишком короткая: минимум ${PAGE_MIN_TEXT} символов текста или изображение с подписью.`);
  }
  const bodyLength = pageTextLength(list.filter(b => b?.type !== "heading"));
  if (bodyLength > PAGE_MAX_TEXT) {
    errors.push(`Страница слишком длинная: до ${PAGE_MAX_TEXT} символов текста.`);
  }
  return errors;
}

// Валидация всей книги перед сохранением карточки материала.
export function validateMaterial({ pageCount, pages }) {
  const errors = [];
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    errors.push("Материал должен содержать хотя бы одну страницу.");
  }
  (Array.isArray(pages) ? pages : []).forEach((blocks, index) => {
    validatePage(blocks).forEach(err =>
      errors.push(`Страница ${index + 1}: ${err}`));
  });
  return errors;
}

// Индикатор заполненности страницы 0..1: отношением набранного
// текста к норме (картинка с подписью считается закрытой страницей).
export function pageFillRatio(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  if (hasImageWithCaption(list)) return 1;
  return Math.min(1, pageTextLength(list) / PAGE_MIN_TEXT);
}

// Прогресс читалки: { lastPage, completed }. completed — дошли до конца.
export function materialProgress(pages, lastPage) {
  const pageCount = Array.isArray(pages) ? pages.length : 0;
  const page = Number.isInteger(lastPage) && lastPage >= 0 ? lastPage : 0;
  return {
    lastPage: Math.min(page, Math.max(0, pageCount - 1)),
    completed: pageCount > 0 && page >= pageCount - 1
  };
}

// Что видит студент: материал открыт, пока идёт попытка этого теста —
// проверка идёт правилами через activeAttempts; здесь только логика
// «срок маркера освобождает материал».
export function markerReleased(marker, now = Date.now()) {
  if (!marker?.attemptId) return true;
  const ms = marker.deadlineAt?.toMillis?.()
    ?? (typeof marker.deadlineAt?.seconds === "number" ? marker.deadlineAt.seconds * 1000 : null)
    ?? (marker.deadlineAt instanceof Date ? marker.deadlineAt.getTime() : null);
  return ms !== null && now >= ms;
}
