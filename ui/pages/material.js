// ui/pages/material.js — читалка учебного материала-книги,
// маршрут #material/<testId>. Полноэкранный режим: без сайдбара и меню,
// бумажная типографика, листание кнопками/свайпом/стрелками.
// Хеш-страж: пока читалка открыта, hashchange возвращает на текущую
// страницу; выйти можно только кнопкой «К тесту» после последней страницы.
// Читалка имеет свои режимы «бумага» / «ночь» и размер шрифта (A− / A+),
// выбор хранится на устройстве. Из лобби Live-комнаты открывается как
// #material/<testId>/free/<код комнаты> и возвращает обратно в комнату.
import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { loadMaterial, loadMaterialProgress, saveMaterialProgress } from "../../core/materials.js";
import { materialProgress } from "../../core/material-logic.js";
import {
  deriveChapters, hasToc
} from "../../core/material-library-logic.js";
import {
  pdfBlob, loadLibraryPdf
} from "../../core/material-library.js";
import { setHashGuard, leaveWithHash } from "../../shared/app.js";
import { t as tr, lt } from "../../core/i18n.js";

// Метаданные книги не берём из router: нужно знать orgId, чтобы правила
// разрешили чтение. Материал грузим напрямую.

const REDUCED = window.matchMedia
  ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
  : false;

let exit = null;

const PREFS_KEY = "sb-reader";

// localStorage может быть недоступен (приватный режим) — все обращения
// через безопасные обёртки.
function storageGet(key) {
  try { return window.localStorage.getItem(key); } catch (_) { return null; }
}

function storageSet(key, value) {
  try { window.localStorage.setItem(key, value); } catch (_) { /* нет storage */ }
}
const SIZE_MIN = 15, SIZE_MAX = 28, SIZE_STEP = 1;

function loadPrefs() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}; } catch (_) { /* нет storage */ }
  const siteDark = document.documentElement.getAttribute("data-theme") === "dark";
  const mode = saved.mode === "night" || saved.mode === "paper" ? saved.mode : (siteDark ? "night" : "paper");
  const size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, Number(saved.size) || 19));
  return { mode, size };
}

function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) { /* приватный режим */ }
}

function blockEl(block) {
  switch (block?.type) {
    case "heading":
      // level 2 — подзаголовок (глава — по умолчанию, как и раньше).
      return block.level === 2
        ? h("h3", { class: "book-h book-sub" }, block.text || "")
        : h("h2", { class: "book-h" }, block.text || "");
    case "paragraph":
      return h("p", { class: "book-p" }, block.text || "");
    case "list":
      return h("ul", { class: "book-list" },
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
        imgEl(block.src),
        h("figcaption", { class: "book-caption" }, block.caption || ""));
    case "quote":
      return h("blockquote", { class: "book-quote" }, block.text || "");
    default:
      return null;
  }
}

function imgEl(src) {
  if (String(src || "").startsWith("data:")) {
    return h("img", { src, alt: "" });
  }
  return h("img", { src, alt: "", referrerpolicy: "no-referrer" });
}

export default async function MaterialPage() {
  const page = h("div", { class: "reader" });
  const routeParts = (State.routeParam || "").split("/");
  const testId = decodeURIComponent(routeParts[0] || "");
  // #material/<id>/free — добровольное чтение: выйти к тесту можно в любой момент.
  const freeMode = routeParts[1] === "free";
  const previewMode = routeParts[1] === "preview";
  // Код комнаты (чтение из лобби): «К тесту» возвращает в комнату.
  const roomCode = routeParts[2] ? decodeURIComponent(routeParts[2]).toUpperCase() : "";
  // Самостоятельный материал (этап 3): возврат в каталог материалов,
  // а не к несуществующему тесту. Редактор открывает предпросмотр как
  // #material/<id>/preview/materials — «К редактору» вернёт в каталог.
  const fromLibrary = freeMode ? !roomCode : previewMode && routeParts[2] === "materials";
  const backHash = fromLibrary ? "#materials"
    : previewMode ? `#create-test/${testId}`
      : (roomCode ? `#room/${roomCode}` : `#quiz/${testId}`);
  const prefs = loadPrefs();
  page.dataset.rd = prefs.mode;
  page.style.setProperty("--rd-size", `${prefs.size}px`);

  let material = null;
  let progress = { lastPage: 0, completed: false };
  const isStudent = State.profile?.role === "student";
  const lastPageKey = `sb-reader-last:${testId}`;
  try {
    material = await loadMaterial(testId);
    progress = await loadMaterialProgress(State.user.uid, testId);
    if (!isStudent && !progress.lastPage) {
      // Прогресс Firestore пишут только студенты (правила). Персоналу
      // последняя страница запоминается на устройстве.
      const local = Number(storageGet(lastPageKey));
      if (Number.isInteger(local) && local >= 0) progress = { lastPage: local, completed: false };
    }
  } catch (err) {
    // Нет доступа — материал закрыт правилом (идёт попытка?):
    page.appendChild(h("div", { class: "reader-stage" },
      h("div", { class: "book" },
        h("div", { class: "book-page" },
          h("h1", { class: "book-h" }, "Материал недоступен"),
          h("p", { class: "book-p" },
            err?.code === "permission-denied"
              ? lt("mat.closedDuring")
              : "Книга не найдена или сеть недоступна."),
          exitBtn(backHash)
        )
      )
    ));
    return page;
  }

  if (!material?.pages?.length) {
    page.appendChild(h("div", { class: "reader-stage" },
      h("div", { class: "book" }, h("div", { class: "book-page" },
        h("h1", { class: "book-h" }, lt("mat.none")),
        h("p", { class: "book-p" }, lt("mat.noneHint")),
        exitBtn(backHash)
      ))
    ));
    return page;
  }

  const startIndex = materialProgress(material.pages, progress.lastPage).lastPage;
  let index = Math.min(startIndex, material.pages.length - 1);
  let exitRequested = false;

  // Хеш-страж: любые смены хеша, кроме разрешённого выхода, откатываются.
  if (!freeMode && !previewMode) {
    setHashGuard(nextHash => {
      if (exitRequested || nextHash.startsWith(`#material/${testId}/`)) {
        return true;
      }
      return false;
    });
  }

  document.body.classList.add("reading-mode");

  const title = h("div", { class: "reader-title" }, material.title || "Материал");
  const progressBar = h("div", { class: "reader-progress-bar" });
  const progressWrap = h("div", { class: "reader-progress", role: "progressbar", "aria-label": "Прогресс чтения" }, progressBar);

  const sizeDown = h("button", { type: "button", class: "reader-tool", "aria-label": "Уменьшить шрифт" }, "A−");
  const sizeUp = h("button", { type: "button", class: "reader-tool", "aria-label": "Увеличить шрифт" }, "A+");
  const modeBtn = h("button", { type: "button", class: "reader-tool" });
  const paintMode = () => {
    modeBtn.textContent = prefs.mode === "night" ? "Бумага" : "Ночь";
    modeBtn.setAttribute("aria-label", prefs.mode === "night" ? "Включить светлый режим" : "Включить ночной режим");
    page.dataset.rd = prefs.mode;
  };
  paintMode();
  const applySize = (delta) => {
    prefs.size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, prefs.size + delta));
    page.style.setProperty("--rd-size", `${prefs.size}px`);
    sizeDown.disabled = prefs.size <= SIZE_MIN;
    sizeUp.disabled = prefs.size >= SIZE_MAX;
    savePrefs(prefs);
  };
  sizeDown.addEventListener("click", () => applySize(-SIZE_STEP));
  sizeUp.addEventListener("click", () => applySize(SIZE_STEP));
  modeBtn.addEventListener("click", () => {
    prefs.mode = prefs.mode === "night" ? "paper" : "night";
    paintMode();
    savePrefs(prefs);
  });
  applySize(0);

  // ---------- Оглавление книги ----------
  const toc = hasToc(material.pages) ? deriveChapters(material.pages) : null;
  const tocBtn = h("button", {
    type: "button", class: "reader-tool", "aria-label": "Оглавление", "aria-expanded": "false"
  }, "☰");
  if (!toc) tocBtn.style.display = "none";
  const tocPanel = h("div", { class: "reader-toc", hidden: "hidden" },
    h("div", { class: "reader-toc-title" }, "Оглавление"));
  if (toc) {
    toc.forEach(chapter => {
      const row = h("button", {
        type: "button", class: "reader-toc-row",
        onclick: () => {
          index = chapter.page;
          paintPage();
          tocPanel.hidden = true;
          tocBtn.setAttribute("aria-expanded", "false");
        }
      }, h("span", { class: "reader-toc-name" }, chapter.title),
        h("span", { class: "reader-toc-page" }, String(chapter.page + 1)));
      tocPanel.appendChild(row);
    });
  }
  tocBtn.addEventListener("click", () => {
    const open = tocPanel.hidden;
    tocPanel.hidden = !open;
    tocBtn.setAttribute("aria-expanded", String(open));
  });

  // ---------- PDF-вложение ----------
  const pdfBtn = material.pdfName
    ? h("button", { type: "button", class: "reader-tool", "aria-label": "Открыть PDF" }, "PDF")
    : null;
  if (pdfBtn) {
    pdfBtn.addEventListener("click", async () => {
      pdfBtn.disabled = true;
      try {
        const pdf = await loadLibraryPdf(testId);
        if (!pdf) throw new Error("PDF не найден.");
        const url = URL.createObjectURL(pdfBlob(pdf.base64));
        // Открыть системным просмотрщиком устройства / скачать.
        // blob: URL не проходит белый список href у h() — создаём
        // ссылку напрямую (это собственный объектный URL, не данные).
        const link = document.createElement("a");
        link.href = url;
        link.download = pdf.name;
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (err) {
        console.error("PDF:", err);
      } finally {
        pdfBtn.disabled = false;
      }
    });
  }

  const toolsChildren = [sizeDown, sizeUp, modeBtn, tocBtn, pdfBtn].filter(Boolean);
  const bar = h("div", { class: "reader-bar" }, title, h("div", { class: "reader-tools" }, toolsChildren));
  const pageNumEl = h("div", { class: "reader-page-num" });
  const stage = h("div", { class: "reader-stage" });
  const book = h("article", { class: "book" });
  stage.appendChild(book);
  stage.appendChild(tocPanel);

  const prevBtn = h("button", { type: "button", class: "reader-arrow left", "aria-label": "Предыдущая страница" }, "←");
  const nextBtn = h("button", { type: "button", class: "reader-arrow right", "aria-label": "Следующая страница" }, "→");

  const exitRow = h("div", { class: "reader-exit" });

  page.append(progressWrap, bar, stage, prevBtn, nextBtn, pageNumEl, exitRow);

  function paintPage() {
    book.style.transition = REDUCED ? "none" : "transform .25s ease";
    book.textContent = "";
    const blocks = material.pages[index];
    const body = h("div", { class: "book-page" + (index === 0 ? " is-first" : "") },
      ...blocks.map(blockEl).filter(Boolean));
    const pct = Math.round(((index + 1) / material.pages.length) * 100);
    progressBar.style.width = `${pct}%`;
    progressWrap.setAttribute("aria-valuenow", String(pct));
    book.appendChild(body);

    pageNumEl.textContent = `${index + 1} / ${material.pages.length}`;
    prevBtn.disabled = index === 0;

    const isLast = index >= material.pages.length - 1;
    nextBtn.disabled = false;
    nextBtn.textContent = isLast ? "" : "→";
    nextBtn.setAttribute("aria-label", isLast ? "Последняя страница" : "Следующая страница");

    // Кнопка выхода: в обязательном режиме только на последней странице,
    // в добровольном (#material/<id>/free) — всегда.
    exitRow.textContent = "";
    const backLabel = fromLibrary ? "К списку материалов" : previewMode ? "К редактору" : "К тесту";
    if ((freeMode || previewMode) && !isLast) {
      exitRow.appendChild(h("button", {
        type: "button", class: "btn secondary",
        onclick: () => exitTo(backHash)
      }, backLabel));
    } else if (isLast) {
      exitRow.appendChild(h("button", {
        type: "button", class: "btn primary",
        onclick: () => exitTo(backHash)
      }, backLabel));
      exitRow.appendChild(h("span", { class: "reader-complete badge badge-success" }, "Прочитано"));
    } else {
      exitRow.appendChild(h("span", { class: "reader-hint muted" },
        `Прочитайте до конца — после последней страницы появится кнопка «${backLabel}».`));
    }

    // Прогресс: последняя страница и флаг completed — materialProgress.
    // Студентам — в Firestore при каждом перелистывании (правила
    // materialProgress разрешают свой прогресс): и в обязательном режиме,
    // и в добровольном (#material/<id>/free) — вернувшись, студент
    // продолжает с места остановки, а не с первой страницы. Персоналу —
    // локально, чтобы «запоминание последней страницы» работало у всех.
    // Предпросмотр ничего не пишет.
    const state = materialProgress(material.pages, index);
    if (!previewMode) {
      if (isStudent) {
        saveMaterialProgress(State.user.uid, testId, state).catch(err => {
          console.error("Не удалось сохранить прогресс:", err);
        });
      } else {
        storageSet(lastPageKey, String(state.lastPage));
      }
    }
  }

  function turn(delta) {
    const target = index + delta;
    if (target < 0 || target >= material.pages.length) {
      return;
    }
    if (REDUCED) {
      index = target;
      paintPage();
      return;
    }
    book.style.transform = `translateX(${delta > 0 ? "-14%" : "14%"})`;
    setTimeout(() => {
      index = target;
      book.style.transition = "none";
      book.style.transform = `translateX(${delta > 0 ? "6%" : "-6%"})`;
      paintPage();
      requestAnimationFrame(() => {
        book.style.transition = "transform .25s ease";
        book.style.transform = "translateX(0)";
      });
    }, 0);
  }

  function exitTo(hash) {
    document.body.classList.remove("reading-mode");
    cleanupHooks();
    leaveWithHash(hash);
  }

  prevBtn.addEventListener("click", () => turn(-1));
  nextBtn.addEventListener("click", () => turn(1));

  const keyHandler = (event) => {
    if (event.key === "ArrowLeft") turn(-1);
    else if (event.key === "ArrowRight") turn(1);
  };
  document.addEventListener("keydown", keyHandler);

  // Свайп: минимальный порог, чтобы случайные касания не листали книгу.
  let touchX = null;
  const touchStart = (e) => { touchX = e.touches[0].clientX; };
  const touchEnd = (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 60) turn(dx < 0 ? 1 : -1);
  };
  stage.addEventListener("touchstart", touchStart, { passive: true });
  stage.addEventListener("touchend", touchEnd, { passive: true });

  paintPage();

  function cleanupHooks() {
    document.removeEventListener("keydown", keyHandler);
    setHashGuard(null);
  }

  exit = () => {
    cleanupHooks();
    document.body.classList.remove("reading-mode");
  };

  // Свободный «К тесту» без прочтения запрещён постановкой, поэтому
  // кнопка exitBtn здесь используется только в одном месте — last page.
  return page;
}

function exitBtn(hash) {
  const label = hash.startsWith("#create-test") ? "К редактору"
    : hash === "#materials" ? "К списку материалов"
      : "К тесту";
  return h("a", {
    class: "btn secondary",
    onclick: () => {
      setHashGuard(null);
      document.body.classList.remove("reading-mode");
      window.location.hash = hash;
    }
  }, label);
}

export function cleanup() {
  if (exit) { exit(); exit = null; }
}
