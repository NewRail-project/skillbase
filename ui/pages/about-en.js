// ui/pages/about-en.js — About Skillbase (English version).
import { h } from "../../shared/dom.js";
import { docPage, scrollToDocSection } from "../components/doc-page.js";
import { State } from "../../core/auth.js";
import { generateQRSvg } from "../../shared/qr.js";

export default function AboutPageEn() {
  const siteUrl = "https://newrail-project.github.io/skillbase/";

  const qrOptions = {
    width: 280, height: 280, ecc: "H", rounded: true,
    dark: "#172817", light: "#F5F7ED", finderDark: "#101810"
  };

  const qrWrapper = h("div", {
    class: "qr-wrapper",
    style: "display: inline-block; background: #F5F7ED; padding: 1.25rem; border-radius: 1.5rem; box-shadow: 0 8px 24px rgba(0,0,0,0.2); line-height: 0; border: 2px solid #C5E747;"
  });
  qrWrapper.innerHTML = generateQRSvg(siteUrl, qrOptions);

  const page = docPage({
    eyebrow: "Platform",
    title: "About Skillbase",
    subtitle: "Education, knowledge assessment, and live testing for the railway industry.",
    extra: [
      h("a", { href: "#about" }, "Русская версия"),
      " · ",
      h("a", { href: "#privacy-en" }, "Privacy Policy"),
      " · ",
      h("a", { href: "#terms-en" }, "Terms of Use"),
      "."
    ],
    sections: [
      {
        title: "Skillbase",
        blocks: [
          h("p", {}, "Skillbase is a unified educational platform for auxiliary learning, knowledge assessment, and professional development."), 
          h("p", {}, "The platform covers the entire learning cycle: material creation, testing, assessment, and results analysis. Our main goal is to improve the quality of education and professional training in the railway sector through modern digital tools.")
        ]
      },
      {
        title: "Target Audience",
        blocks: [
          h("ul", {},
            h("li", {}, "Students of railway colleges and universities;"),
            h("li", {}, "Teachers and instructors;"),
            h("li", {}, "Locomotive depot workers;"),
            h("li", {}, "Locomotive crews and drivers;"),
            h("li", {}, "Other railway industry specialists.")
          )
        ]
      },
      {
        title: "Key Features",
        blocks: [
          h("ul", {},
            h("li", {}, "Test creation and assessment — automated testing with various question types;"),
            h("li", {}, "Self-paced learning — access to educational materials and presentations;"),
            h("li", {}, "Group sessions and Live testing — interactive real-time knowledge checks;"),
            h("li", {}, "Educational analytics — identifying challenging topics and tracking progress.")
          )
        ]
      },
      {
        title: "Development Team",
        blocks: [
          h("p", {}, "Skillbase is developed by a team of professionals based in the Republic of Kazakhstan:"),
          h("ul", {},
            h("li", {},
              h("b", {}, "Daniil Buylyenkov"), h("br"),
              h("span", { class: "muted" }, "Lead Developer: Architecture, programming, technical organization, and core concepts.")
            ),
            h("li", {},
              h("b", {}, "Nikita Golubyatnikov"), h("br"),
              h("span", { class: "muted" }, "Product & Design: User interface, visual concept, technical analysis.")
            ),
            h("li", {},
              h("b", {}, "Bogdan Cherny"), h("br"),
              h("span", { class: "muted" }, "Product & Presentation: Functional development, concepts, and project presentations.")
            )
          )
        ]
      },
      {
        title: "Technology Stack",
        blocks: [
          h("p", {}, "Skillbase is built using a modern stack:"),
          h("ul", {},
            h("li", {}, "Frontend: Vanilla JS — clean JavaScript for maximum performance;"),
            h("li", {}, "Backend: Firebase Auth / Firestore — cloud database and authentication;"),
            h("li", {}, "Deployment: GitHub Pages.")
          ),
          h("p", { class: "muted" }, "Version: 1.0.0 · Year: 2026 · Kazakhstan")
        ]
      }
    ]
  });

  const card = h("section", { class: "panel" },
    h("div", { class: "panel-body" },
      h("div", { class: "about-grid" },
        h("div", {},
          h("p", {}, "Platform address for employees and students. Scan the QR code to open Skillbase on your phone."),
          h("div", { class: "btn-row", style: "margin-top: var(--space-3);" },
            h("a", { class: "btn", href: siteUrl, target: "_blank", rel: "noopener" }, "Open Website")
          )
        ),
        h("div", {
          class: "brand-qr-card",
          style: "text-align: center; margin-top: 1rem; padding: 2.5rem 1.5rem; background: linear-gradient(135deg, #101810 0%, #0a0f0a 100%); color: #fff; border-radius: 1.25rem; border: 1px solid #C5E747; box-shadow: var(--shadow-lg); position: relative; overflow: hidden;"
        },
          h("div", { style: "margin-bottom: 1.25rem;" },
            h("div", { style: "font-family: var(--font-brand); font-weight: 800; font-size: 1.5rem; color: #C5E747;" }, "SKILLBASE"),
            h("div", { style: "font-size: 0.8rem; opacity: 0.7; text-transform: uppercase;" }, "Corporate Platform")
          ),
          qrWrapper,
          h("p", { style: "margin: 1.25rem 0; font-size: 0.95rem; opacity: 0.9;" }, "Scan to open the platform")
        )
      )
    )
  );
  page.appendChild(card);

  scrollToDocSection(page, State.routeParam);
  return page;
}
