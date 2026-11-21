// ui/components/top-board.js — полный ТОП участников для режима просмотра ТОПа
// (#room/КОД/screen). Все участники помещаются на одном экране без прокрутки:
// число колонок и высота строк считаются по количеству участников, размер
// шрифта выводится из высоты строки в CSS (ui/css/top-screen.css).
//
// Обновление точечное: строки сопоставляются по uid, меняются только
// изменившиеся тексты и порядок — список не пересобирается целиком.
import { h } from "../../shared/dom.js";

// Не больше столько строк в колонке при удобном чтении с проектора.
export const TOP_ROWS_PER_COLUMN = 12;
export const TOP_MAX_COLUMNS = 4;

// Раскладка по числу участников: { cols, rows } (rows — строк в колонке).
export function topLayout(count, perColumn = TOP_ROWS_PER_COLUMN) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n === 0) return { cols: 1, rows: 1 };
  const cols = Math.min(TOP_MAX_COLUMNS, Math.max(1, Math.ceil(n / perColumn)));
  return { cols, rows: Math.ceil(n / cols) };
}

// fake-DOM тестов не знает style.setProperty — подстраховка.
const setVar = (el, k, v) => { if (el.style?.setProperty) el.style.setProperty(k, v); else if (el.style) el.style[k] = v; };

const scoreText = (row) => `${Math.round((Number(row.score) || 0) * 100) / 100} б.`;
const nameText = (row) => row.name || row.displayName || "Участник";

// createTopBoard({ avatar }) → { el, update(rows), count() }
//   avatar(row) — функция, возвращающая узел аватара (как в рейтинге комнаты).
export function createTopBoard({ avatar = null } = {}) {
  const empty = h("p", { class: "top-empty", role: "status" }, "Участников пока нет — рейтинг появится после первых ответов.");
  const list = h("ol", { class: "top-list", "aria-label": "Рейтинг участников" });
  const el = h("div", { class: "top-board" }, list, empty);
  const nodes = new Map(); // uid → { li, place, name, score, avatarKey, avatarSlot }
  let shown = 0;

  function makeRow(row) {
    const place = h("span", { class: "top-place" }, "");
    const slot = h("span", { class: "top-avatar" });
    const name = h("span", { class: "top-name" }, "");
    const score = h("span", { class: "top-score" }, "");
    const li = h("li", { class: "top-row" }, place, slot, name, score);
    return { li, place, name, score, slot, avatarKey: null, p: null, n: null, s: null };
  }

  function paint(entry, row, index) {
    const place = Number.isFinite(row.place) ? row.place : index + 1;
    if (entry.p !== place) {
      entry.p = place;
      entry.place.textContent = String(place);
      entry.li.setAttribute("data-place", place <= 3 ? String(place) : "");
    }
    const n = nameText(row);
    if (entry.n !== n) { entry.n = n; entry.name.textContent = n; entry.li.title = n; }
    const s = scoreText(row);
    if (entry.s !== s) { entry.s = s; entry.score.textContent = s; }
    const key = String(row.avatar || "");
    if (avatar && entry.avatarKey !== key) {
      entry.avatarKey = key;
      entry.slot.replaceChildren(avatar(row));
    }
  }

  return {
    el,
    count: () => shown,
    update(rows = []) {
      const { cols, rows: perCol } = topLayout(rows.length);
      setVar(el, "--n", String(Math.max(1, rows.length)));
      setVar(el, "--cols-wide", String(cols));
      setVar(el, "--rows-wide", String(perCol));
      el.setAttribute("data-count", String(rows.length));
      empty.hidden = rows.length > 0;
      shown = rows.length;

      const seen = new Set();
      const ordered = [];
      rows.forEach((row, index) => {
        const uid = row.uid ?? `row-${index}`;
        seen.add(uid);
        let entry = nodes.get(uid);
        if (!entry) { entry = makeRow(row); nodes.set(uid, entry); }
        paint(entry, row, index);
        ordered.push(entry.li);
      });
      for (const [uid, entry] of nodes) {
        if (!seen.has(uid)) { entry.li.remove?.(); nodes.delete(uid); }
      }
      // Порядок: переставляем только узлы, оказавшиеся не на своём месте.
      const current = Array.from(list.children || []);
      const same = current.length === ordered.length && current.every((n, i) => n === ordered[i]);
      if (!same) list.replaceChildren(...ordered);
    }
  };
}
