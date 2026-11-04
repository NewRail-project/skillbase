// ui/components/footer.js — подвал для страниц с вынесенными мета-данными.
import { h } from "../../shared/dom.js";
import { ORGANIZATION_CONFIG } from "../../configs/organization.js";

export function footerLinks() {
  return [
    h("a", { href: "#privacy", class: "link" }, "Политика конфиденциальности"),
    " · ",
    h("a", { href: "#terms", class: "link" }, "Пользовательское соглашение"),
    " · ",
    h("a", { href: "#rules", class: "link" }, "Правила использования"),
    " · ",
    h("span", { class: "muted" }, `Редакция от ${ORGANIZATION_CONFIG.docVersion}`)
  ];
}

export function footer() {
  return h("footer", { class: "footer" },
    h("div", { class: "footer-content" },
      h("div", { class: "footer-links" }, ...footerLinks()),
      h("div", { class: "footer-meta" },
        h("span", {}, `© ${ORGANIZATION_CONFIG.year} ${ORGANIZATION_CONFIG.name}`),
        h("span", { class: "muted" }, `Версия: ${ORGANIZATION_CONFIG.version}`)
      )
    )
  );
}
