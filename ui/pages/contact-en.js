// ui/pages/contact-en.js — Contact Us (English version).
import { h } from "../../shared/dom.js";
import { docPage, scrollToDocSection } from "../components/doc-page.js";
import { State } from "../../core/auth.js";

export default function ContactPageEn() {
  const page = docPage({
    eyebrow: "Connection",
    title: "Contact Us",
    subtitle: "We are open to constructive feedback and collaboration.",
    updated: "02.11.2026",
    extra: [
      h("a", { href: "#contact" }, "Русская версия")
    ],
    sections: [
      {
        id: "intro",
        title: "Get in Touch",
        blocks: [
          h("p", {}, "Questions about Skillbase, development suggestions, or bug reports? Contact us via your preferred method. We value every user's feedback."),
          h("div", { class: "contact-main", style: "margin: var(--space-4) 0; padding: var(--space-4); background: var(--ok-bg); border: 1px solid var(--ok-border); border-radius: var(--radius-m);" },
            h("div", { style: "font-weight: 700; color: var(--ok); margin-bottom: var(--space-1);" }, "Main Communication Channel — Telegram"),
            h("a", {
              href: "https://t.me/Frozencode_f",
              target: "_blank",
              style: "font-size: 1.25rem; font-weight: 700; text-decoration: none; color: var(--ok);"
            }, "@Frozencode_f")
          )
        ]
      },
      {
        id: "channels",
        title: "Communication Channels",
        blocks: [
          h("div", { style: "display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--space-3);" },
            h("div", { class: "card", style: "margin: 0;" },
              h("b", { style: "display: block; margin-bottom: var(--space-1)" }, "Telegram (primary)"),
              h("a", { href: "https://t.me/Frozencode_f", target: "_blank" }, "@Frozencode_f"),
            h("div", { class: "card", style: "margin: 0;" },
              h("b", { style: "display: block; margin-bottom: var(--space-1)" }, "Telegram (secondary)"),
              h("a", { href: "https://t.me/YourAssistantWeb", target: "_blank" }, "@YourAssistantWeb")
            ),
            h("div", { class: "card", style: "margin: 0;" },
              h("b", { style: "display: block; margin-bottom: var(--space-1)" }, "Email"),
              h("a", { href: "mailto:bujlenkovdaniil@gmail.com" }, "bujlenkovdaniil@gmail.com")
            ),
            h("div", { class: "card", style: "margin: 0;" },
              h("b", { style: "display: block; margin-bottom: var(--space-1)" }, "Instagram"),
              h("a", { href: "https://www.instagram.com/core.singl?psln=MWkzcXg1YWoxNnVyZA==", target: "_blank" }, "@core.singl")
            ),
            h("div", { class: "card", style: "margin: 0;" },
              h("b", { style: "display: block; margin-bottom: var(--space-1)" }, "GitHub"),
              h("a", { href: "https://github.com/NewRail-project/skillbase", target: "_blank" }, "Skillbase GitHub")
            )
          )
        ]
      },
      {
        id: "team",
        title: "Project Team",
        blocks: [
          h("ul", { style: "list-style: none; padding: 0;" },
            h("li", { style: "margin-bottom: var(--space-3)" },
              h("b", {}, "Daniil Buylyenkov"), h("br"),
              h("span", { class: "muted" }, "Lead Developer: architecture, programming, and technical management.")
            ),
            h("li", { style: "margin-bottom: var(--space-3)" },
              h("b", {}, "Nikita Golubyatnikov"), h("br"),
              h("span", { class: "muted" }, "Product & Design: interface, visual concept, and technical analysis.")
            ),
            h("li", { style: "margin-bottom: var(--space-3)" },
              h("b", {}, "Bogdan Cherny"), h("br"),
              h("span", { class: "muted" }, "Product & Presentation: concepts, and project presentations.")
            )
          )
        ]
      },
      {
        id: "info",
        title: "Platform Info",
        blocks: [
          h("p", { class: "muted" },
            "Project: Skillbase", h("br"),
            "Team: Independent Developers", h("br"),
            "Version: 1.0.0", h("br"),
            "Year: 2026", h("br"),
            "Site: ", h("a", { href: "https://newrail-project.github.io/skillbase/#/" }, "newrail-project.github.io/skillbase")
          ),
          h("p", { style: "font-style: italic; margin-top: var(--space-4); font-weight: 500;" }, "«Skillbase — knowledge that moves the industry forward»")
        ]
      }
    ]
  });

  scrollToDocSection(page, State.routeParam);
  return page;
}
