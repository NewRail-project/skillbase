// ui/components/responsive-table.js — подписи колонок для таблиц-карточек.
// На телефоне таблицы (.analytics-table, .table-stack) показываются карточками
// (см. components.css, «Адаптивность»); подпись значения берётся из data-label.
// Подписи расставляются один раз по заголовку таблицы, поэтому страницам
// ничего менять не нужно: наблюдатель подхватывает любые таблицы в #app.
const SELECTOR = "table.analytics-table, table.table-stack";

// Расставляет data-label ячейкам по тексту заголовков. Возвращает число ячеек.
export function labelTable(table) {
  const section = (name) => Array.from(table.children).filter((c) => String(c.tagName || "").toLowerCase() === name);
  const headRow = section("thead").flatMap((t) => Array.from(t.children)).find((tr) => String(tr.tagName || "").toLowerCase() === "tr");
  if (!headRow) return 0;
  const heads = Array.from(headRow.children).map((th) => (th.textContent || "").trim());
  let n = 0;
  for (const body of section("tbody")) {
    for (const tr of Array.from(body.children)) {
      Array.from(tr.children).forEach((td, i) => {
        if (heads[i] && !td.getAttribute("data-label")) { td.setAttribute("data-label", heads[i]); n += 1; }
      });
    }
  }
  return n;
}

export function labelAll(root) {
  let n = 0;
  root.querySelectorAll(SELECTOR).forEach((t) => { n += labelTable(t); });
  return n;
}

let observer = null;
// Следит за #app: новые таблицы получают подписи сразу после построения.
export function observeTables(root = document.getElementById("app")) {
  if (!root || observer || typeof MutationObserver !== "function") return;
  let queued = false;
  observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    (typeof requestAnimationFrame === "function" ? requestAnimationFrame : setTimeout)(() => { queued = false; labelAll(root); });
  });
  observer.observe(root, { childList: true, subtree: true });
  labelAll(root);
}
