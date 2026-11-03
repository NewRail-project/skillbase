// ui/pages/material.js — читалка учебного материала-книги,
// маршрут #material/<testId>. Полноэкранный режим: без сайдбара и меню,
// бумажная типографика, листание кнопками/свайпом/стрелками.
// Хеш-страж: пока читалка открыта, hashchange возвращает на текущую
// страницу; выйти можно только кнопкой «К тесту» после последней страницы.
// Тёмная тема в читалке не применяется.
import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { db, doc, getDoc } from "../../shared/firebase.js";
import { loadMaterial, loadMaterialProgress, saveMaterialProgress } from "../../core/materials.js";
import { materialProgress } from "../../core/material-logic.js";
import { setHashGuard, leaveWithHash } from "../../shared/app.js";

// Метаданные книги не берём из router: нужно знать orgId, чтобы правила
// разрешили чтение. Материал грузим напрямую.

const REDUCED = window.matchMedia
  ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
  : false;

let exit = null;

function blockEl(block) {
  switch (block?.type) {
    case "heading":
      return h("h2", { class: "book-h" }, block.text || "");
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

  let material = null;
  let progress = { lastPage: 0, completed: false };
  let authorName = null;
  try {
    material = await loadMaterial(testId);
    progress = await loadMaterialProgress(State.user.uid, testId);
    // Получаем имя автора из publicProfiles
    if (material.authorId) {
      try {
        const pub = await getDoc(doc(db, "publicProfiles", material.authorId));
        if (pub.exists()) {
          authorName = pub.data().displayName || null;
        }
      } catch (pubErr) {
        console.warn("Автор недоступен:", pubErr);
      }
    }
  } catch (err) {
    // Нет доступа — материал закрыт правилом (идёт попытка?):
    page.appendChild(h("div", { class: "reader-stage" },
      h("div", { class: "book" },
        h("div", { class: "book-page" },
          h("h1", { class: "book-h" }, "Материал недоступен"),
          h("p", { class: "book-p" },
            err?.code === "permission-denied"
              ? "Во время активной попытки учебный материал закрыт, чтобы его не подсматривали."
              : "Книга не найдена или сеть недоступна."),
          exitBtn("#quiz/" + testId)
        )
      )
    ));
    return page;
  }

  if (!material?.pages?.length) {
    page.appendChild(h("div", { class: "reader-stage" },
      h("div", { class: "book" }, h("div", { class: "book-page" },
        h("h1", { class: "book-h" }, "Материала пока нет"),
        h("p", { class: "book-p" }, "К этому тесту ещё не добавлен учебный материал."),
        exitBtn("#quiz/" + testId)
      ))
    ));
    return page;
  }

  const startIndex = materialProgress(material.pages, progress.lastPage).lastPage;
  let index = Math.min(startIndex, material.pages.length - 1);
  let exitRequested = false;

  // Хеш-страж: любые смены хеша, кроме разрешённого выхода, откатываются.
  if (!freeMode) {
    setHashGuard(nextHash => {
      if (exitRequested || nextHash.startsWith(`#material/${testId}/`)) {
        return true;
      }
      return false;
    });
  }

  document.body.classList.add("reading-mode");

  // Прогресс-бар
  const progressEl = h("div", { class: "reader-progress" });
  const progressFill = h("div", { class: "reader-progress-fill" });
  progressEl.appendChild(progressFill);

  // Заголовок книги (running header)
  const title = h("div", { class: "reader-title" }, material.title || "Материал");

  // Навигация и контейнер страниц
  const pageNumEl = h("div", { class: "reader-page-num" });
  const stage = h("div", { class: "reader-stage" });
  const book = h("article", { class: "book" });
  stage.appendChild(book);

  const prevBtn = h("button", { type: "button", class: "reader-arrow left", "aria-label": "Предыдущая страница" }, "←");
  const nextBtn = h("button", { type: "button", class: "reader-arrow right", "aria-label": "Следующая страница" }, "→");

  const exitRow = h("div", { class: "reader-exit" });

  page.append(progressEl, title, stage, prevBtn, nextBtn, pageNumEl, exitRow);

  // Обложка книги (типографический фронтиспис)
  function coverEl() {
    const cover = h("div", { class: "book-cover" });
    cover.appendChild(h("h1", { class: "book-cover-title" }, material.title || "Учебный материал"));
    
    // Подзаголовок/информация
    if (material.description) {
      cover.appendChild(h("p", { class: "book-cover-subtitle" }, material.description));
    }
    
    // Автор
    if (authorName) {
      cover.appendChild(h("div", { class: "book-cover-author" }, `Преподаватель: ${authorName}`));
    }
    
    // Информация о материале
    const meta = h("div", { class: "book-cover-meta" });
    meta.appendChild(h("div", { class: "book-cover-chapter" }, `Глава ${index + 1}`));
    meta.appendChild(h("div", { class: "book-cover-pages" }, `${material.pages.length} страниц`));
    if (material.updatedAt) {
      const date = new Date(material.updatedAt.seconds * 1000).toLocaleDateString("ru-RU");
      meta.appendChild(h("div", { class: "book-cover-date" }, `Обновлено: ${date}`));
    }
    cover.appendChild(meta);
    
    return cover;
  }

  function paintPage() {
    book.style.transition = REDUCED ? "none" : "transform .25s ease";
    book.textContent = "";
    
    // На первой странице добавляем обложку
    if (index === 0) {
      const cover = coverEl();
      book.appendChild(cover);
    }
    
    const blocks = material.pages[index];
    const body = h("div", { class: "book-page" },
      ...blocks.map(blockEl).filter(Boolean));
    book.appendChild(body);

    // Обновляем прогресс-бар
    const progress = (index + 1) / material.pages.length;
    progressFill.style.width = `${progress * 100}%`;
    
    pageNumEl.textContent = `${index + 1} / ${material.pages.length}`;
    prevBtn.disabled = index === 0;

    const isLast = index >= material.pages.length - 1;
    nextBtn.disabled = false;
    nextBtn.textContent = isLast ? "" : "→";
    nextBtn.setAttribute("aria-label", isLast ? "Последняя страница" : "Следующая страница");

    // Кнопка выхода: в обязательном режиме только на последней странице,
    // в добровольном (#material/<id>/free) — всегда.
    exitRow.textContent = "";
    if (freeMode && !isLast) {
      exitRow.appendChild(h("button", {
        type: "button", class: "btn secondary",
        onclick: () => exitTo("#quiz/" + testId)
      }, "К тесту"));
    } else if (isLast) {
      exitRow.appendChild(h("button", {
        type: "button", class: "btn primary",
        onclick: () => exitTo("#quiz/" + testId)
      }, "К тесту"));
      exitRow.appendChild(h("span", { class: "reader-complete badge badge-success" }, "Прочитано"));
    } else {
      exitRow.appendChild(h("span", { class: "reader-hint muted" },
        "Прочитайте до конца — после последней страницы появится кнопка «К тесту»."));
    }

    // Прогресс: последняя страница и флаг completed — materialProgress.
    const state = materialProgress(material.pages, index);
    if (!freeMode || state.completed) saveMaterialProgress(State.user.uid, testId, state).catch(err => {
      console.error("Не удалось сохранить прогресс:", err);
    });
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
  return h("a", {
    class: "btn secondary",
    onclick: () => {
      setHashGuard(null);
      document.body.classList.remove("reading-mode");
      window.location.hash = hash;
    }
  }, "К тесту");
}

export function cleanup() {
  if (exit) { exit(); exit = null; }
}
