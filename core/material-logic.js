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

// ---------- Разбивка сплошного текста на страницы ----------
// Преподаватель вставляет (или загружает .txt) весь материал одним куском,
// а эта функция превращает его в страницы книги: { blocks: [...] }.
// Правила: страница ≈ PAGE_TARGET_TEXT символов (экран телефона), абзацы
// не рвутся без нужды (длинные режутся по предложениям), заголовок всегда
// остаётся на одной странице со следующим за ним текстом, маленький
// «хвост» дописывается к соседней странице — каждая страница проходит
// validatePage.

export const PAGE_TARGET_TEXT = 950;

const BULLET_RE = /^\s*(?:[-–—•*·▪●]|\d{1,2}[.)])\s+/u;
const TERMINAL_RE = /[.!?…:;,»”"')]$/u;
const STRONG_HEADING_RE = /^(?:(?:глава|раздел|тема|часть|урок|модуль|бөлім|тарау)\s|§\s*\d|\d+(?:\.\d+)*\.?\s+\S)/iu;

function normalizeText(text) {
  return String(text ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\u00AD/g, "");
}

function bodyLen(blocks) {
  return pageTextLength(blocks.filter(block => block?.type !== "heading"));
}

// Режет текст на куски не длиннее max: по предложениям, затем по словам.
function splitByLength(text, max) {
  const clean = text.trim();
  if (clean.length <= max) return clean ? [clean] : [];
  const sentences = clean.match(/[^.!?…]+(?:[.!?…]+["»”)]*|$)\s*/gu) || [clean];
  const chunks = [];
  let current = "";
  const push = () => { if (current.trim()) chunks.push(current.trim()); current = ""; };
  for (const sentence of sentences) {
    if (sentence.length > max) {
      push();
      let part = "";
      for (const word of sentence.split(/\s+/)) {
        if (word.length > max) {
          if (part) { chunks.push(part.trim()); part = ""; }
          for (let i = 0; i < word.length; i += max) chunks.push(word.slice(i, i + max));
          continue;
        }
        if ((part + " " + word).trim().length > max) { chunks.push(part.trim()); part = word; }
        else part = (part + " " + word).trim();
      }
      if (part.trim()) chunks.push(part.trim());
      continue;
    }
    if ((current + sentence).trim().length > max) push();
    current += sentence;
  }
  push();
  return chunks;
}

function isHeadingLine(line, { strictOnly, hasNext }) {
  const text = line.trim();
  if (!text || text.length > 80 || BULLET_RE.test(text) && !STRONG_HEADING_RE.test(text)) return false;
  if (TERMINAL_RE.test(text)) return false;
  if (STRONG_HEADING_RE.test(text)) return true;
  return !strictOnly && hasNext;
}

// Текст → плоский список блоков (heading / paragraph / list), без деления по страницам.
export function textToBlocks(rawText) {
  const text = normalizeText(rawText).trim();
  if (!text) return [];

  const hasBlankLines = /\n\s*\n/.test(text);
  // Без пустых строк каждая строка — отдельный абзац; с пустыми строками
  // строки внутри абзаца склеиваются (текст из PDF с переносами).
  const groups = hasBlankLines
    ? text.split(/\n\s*\n/).map(g => g.split("\n").map(s => s.trim()).filter(Boolean))
    : text.split("\n").map(s => s.trim()).filter(Boolean).map(s => [s]);

  const blocks = [];
  const cleanGroups = groups.filter(g => g.length);
  cleanGroups.forEach((lines, groupIndex) => {
    const hasNext = groupIndex < cleanGroups.length - 1;
    let para = [];
    let items = [];
    const flushPara = () => {
      if (para.length) blocks.push({ type: "paragraph", text: para.join(" ").replace(/\s+/g, " ").trim() });
      para = [];
    };
    const flushItems = () => {
      if (items.length) blocks.push({ type: "list", items });
      items = [];
    };

    // Одна короткая строка без точки = заголовок.
    if (lines.length === 1) {
      const line = lines[0];
      const md = line.match(/^#{1,6}\s+(.+)$/);
      if (md) { blocks.push({ type: "heading", text: md[1].trim().slice(0, 120) }); return; }
      if (isHeadingLine(line, { strictOnly: !hasBlankLines, hasNext })) {
        blocks.push({ type: "heading", text: line.replace(/\s+/g, " ").slice(0, 120) });
        return;
      }
    }

    for (const line of lines) {
      const md = line.match(/^#{1,6}\s+(.+)$/);
      if (md) {
        flushPara(); flushItems();
        blocks.push({ type: "heading", text: md[1].trim().slice(0, 120) });
      } else if (BULLET_RE.test(line) && (lines.length > 1 || hasBlankLines)) {
        flushPara();
        items.push(line.replace(BULLET_RE, "").trim());
      } else {
        flushItems();
        para.push(line);
      }
    }
    flushPara(); flushItems();
  });
  return blocks;
}

// Блоки → «куски» не длиннее target: длинный абзац режется по предложениям,
// длинный список — по пунктам.
function toChunks(blocks, target) {
  const chunks = [];
  for (const block of blocks) {
    if (block.type === "paragraph" || block.type === "quote") {
      splitByLength(block.text, target).forEach(part => chunks.push({ ...block, text: part }));
    } else if (block.type === "list") {
      let current = [];
      let size = 0;
      for (const item of block.items) {
        const pieces = splitByLength(String(item), target);
        for (const piece of pieces) {
          if (current.length && size + piece.length + 1 > target) {
            chunks.push({ type: "list", items: current });
            current = []; size = 0;
          }
          current.push(piece);
          size += piece.length + 1;
        }
      }
      if (current.length) chunks.push({ type: "list", items: current });
    } else {
      chunks.push(block);
    }
  }
  return chunks;
}

// Главная функция: сплошной текст → массив страниц (каждая — массив блоков).
export function paginateText(rawText, { target = PAGE_TARGET_TEXT } = {}) {
  const chunks = toChunks(textToBlocks(rawText), target);
  if (!chunks.length) return [];

  // Заголовки приклеиваются к следующему куску (и друг к другу, если подряд).
  const units = [];
  let pendingHeadings = [];
  for (const chunk of chunks) {
    if (chunk.type === "heading") { pendingHeadings.push(chunk); continue; }
    units.push([...pendingHeadings, chunk]);
    pendingHeadings = [];
  }
  if (pendingHeadings.length) {
    if (units.length) units[units.length - 1].push(...pendingHeadings);
    else units.push(pendingHeadings);
  }

  let pages = [];
  let current = [];
  for (const unit of units) {
    if (current.length && bodyLen([...current, ...unit]) > target) {
      pages.push(current);
      current = [];
    }
    current.push(...unit);
  }
  if (current.length) pages.push(current);

  // Короткие страницы (меньше PAGE_MIN_TEXT) дописываем к соседней,
  // пока суммарно влезает в PAGE_MAX_TEXT.
  let merged = true;
  while (merged && pages.length > 1) {
    merged = false;
    for (let i = 0; i < pages.length; i++) {
      if (pageTextLength(pages[i]) >= PAGE_MIN_TEXT) continue;
      const neighbours = [i - 1, i + 1].filter(j => j >= 0 && j < pages.length);
      const j = neighbours.find(k => bodyLen([...pages[Math.min(i, k)], ...pages[Math.max(i, k)]]) <= PAGE_MAX_TEXT);
      if (j === undefined) continue;
      const [a, b] = i < j ? [i, j] : [j, i];
      pages.splice(a, 2, [...pages[a], ...pages[b]]);
      merged = true;
      break;
    }
  }
  return pages;
}
