// ui/components/rating-jump.js — кнопка ведущего «К рейтингу TOP».
// Плавно прокручивает страницу к реальному блоку рейтинга. Блоки рейтинга
// помечены атрибутом data-rating-anchor (таблица комнаты, панель рейтинга,
// подиум итогов); берётся первый видимый в порядке документа.
//
// Учитывается закреплённая верхняя панель (.topbar): высота измеряется, а не
// угадывается, поэтому подиум и карточки не прячутся под ней. Прокрутка не
// зависит от числа участников: цель — верх блока, а не его низ; если страница
// короче, браузер сам ограничит прокрутку, и блок остаётся виден.

export const RATING_ANCHOR_ATTR = "data-rating-anchor";
const GAP_PX = 12;
const PENDING_MS = 1500;

let pendingUntil = 0;

// Идёт ли сейчас переход к рейтингу: перерисовка вида в это время не должна
// возвращать страницу на прежнюю позицию.
export function ratingJumpPending(now = Date.now()) {
  return now < pendingUntil;
}

function isShown(el) {
  if (!el || el.hidden) return false;
  if (typeof el.getBoundingClientRect !== "function") return false;
  const r = el.getBoundingClientRect();
  return r.height > 0 && r.width > 0;
}

// Первый видимый блок рейтинга.
export function findRatingTarget(root = document) {
  const list = root.querySelectorAll(`[${RATING_ANCHOR_ATTR}]`);
  for (const el of list) if (isShown(el)) return el;
  return null;
}

// Высота закреплённой шапки: измеряем реальную, а не берём из токена.
export function stickyOffset(doc = document, win = window) {
  const bar = doc.querySelector(".topbar");
  if (!bar) return GAP_PX;
  const pos = win.getComputedStyle(bar).position;
  if (pos !== "sticky" && pos !== "fixed") return GAP_PX;
  const rect = bar.getBoundingClientRect();
  return Math.max(0, rect.bottom) + GAP_PX;
}

// Чистая арифметика: куда прокрутить, чтобы верх блока оказался под шапкой.
export function targetScrollTop({ targetTop, scrollY, offset, maxScroll }) {
  const raw = targetTop + scrollY - offset;
  return Math.max(0, Math.min(Number.isFinite(maxScroll) ? maxScroll : raw, Math.round(raw)));
}

// Перейти к рейтингу. Возвращает false, если блока нет (рейтинг пуст).
export function jumpToRating({ behavior = "smooth", doc = document, win = window } = {}) {
  const target = findRatingTarget(doc);
  if (!target) return false;
  const reduced = typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = doc.documentElement;
  const top = targetScrollTop({
    targetTop: target.getBoundingClientRect().top,
    scrollY: win.scrollY ?? win.pageYOffset ?? 0,
    offset: stickyOffset(doc, win),
    maxScroll: root ? Math.max(0, root.scrollHeight - win.innerHeight) : Infinity
  });
  pendingUntil = Date.now() + PENDING_MS;
  win.scrollTo({ top, behavior: reduced ? "auto" : behavior });
  return true;
}
