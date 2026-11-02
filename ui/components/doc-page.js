// ui/components/doc-page.js — конструктор корпоративных страниц документов
// (политика, соглашение, правила, контакты). Одинаковая раскладка:
// page-head + панели секций. По маршрутам вида #privacy / #terms доступны
// напрямую и после обновления (hash-роутер).
//
// sections: [{ id?v, title, blocks [элементы h()] }]
// param   — модель State.routeParam (для #about/features-ссылок);
//           если совпал с id секции, страница прокручивается к ней.
import { h } from "../../shared/dom.js";

export function docPage({ eyebrow, title, subtitle, sections, updated, extra = [], toc = false }) {
  const page = h("div", { class: "page docs-page" });

  page.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, eyebrow),
      h("h1", {}, title),
      h("p", { class: "page-sub" }, subtitle)
    )
  ));

  if (toc && sections.length > 1) {
    const tocItems = sections.map(sec => {
      if (!sec.id) sec.id = "sec-" + Math.random().toString(36).slice(2, 9);
      return h("li", {}, h("a", { href: `#${window.location.hash.split("/")[0].slice(1)}/${sec.id}` }, sec.title));
    });
    page.appendChild(h("nav", { class: "docs-toc", "aria-label": "Содержание" },
      h("div", { class: "docs-toc-title" }, "Содержание"),
      h("ul", {}, ...tocItems)
    ));
  }

  sections.forEach(sec => {
    page.appendChild(h("section", {
      class: "panel docs-panel",
      id: sec.id || null
    },
      h("div", { class: "section-title" },
        h("h2", {}, sec.title)),
      h("div", { class: "panel-body docs-section" }, ...sec.blocks)
    ));
  });

  const bottom = h("div", { class: "muted docs-updated" },
    h("p", {}, updated ? `Обновлено: ${updated}. ` : null, ...extra),
    h("a", { href: "#/", class: "docs-back" },
      h("svg", { viewBox: "0 0 24 24", width: "18", height: "18", fill: "none", stroke: "currentColor", "stroke-width": "2" },
        h("path", { d: "M19 12H5M12 19l-7-7 7-7" })),
      "Вернуться на главную")
  );
  page.appendChild(bottom);
  return page;
}

// Прокрутка к секции по параметру маршрута (#page/<section>). Вызов делается
// после построения страницы; rAF гарантирует, что узел уже в DOM.
export function scrollToDocSection(root, param) {
  if (!param) return;
  try {
    const target = root.querySelector(
      `.docs-panel#${CSS.escape(param)}`);
    if (target) {
      requestAnimationFrame(() =>
        target.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  } catch (_) { /* необычный параметр — просто игнорируем */ }
}
