// ui/pages/terms-en.js — Terms of Use (English).
import { h } from "../../shared/dom.js";
import { docPage, scrollToDocSection } from "../components/doc-page.js";
import { DOC_VERSIONS } from "../../core/consent-docs.js";
import { State } from "../../core/auth.js";

export default function TermsPageEn() {
  const page = docPage({
    eyebrow: "Documents",
    title: "Terms of Use",
    subtitle: "Rules and conditions for using the Skillbase educational platform.",
    updated: DOC_VERSIONS.terms,
    version: DOC_VERSIONS.terms,
    versionPrefix: "Revision dated",
    toc: true,
    extra: [
      h("a", { href: "#terms" }, "Русская версия"),
      " · ",
      h("a", { href: "#contact" }, "Contact us")
    ],
    sections: [
      {
        id: "general",
        title: "1. General Provisions",
        blocks: [
          h("p", {}, "These Terms of Use govern the relationship between the Skillbase developers and its users."),
          h("p", {}, "The platform is provided free of charge for educational purposes. There are no paid subscriptions or donations in the current version.")
        ]
      },
      {
        id: "purpose",
        title: "2. Platform Purpose",
        blocks: [
          h("p", {}, "Skillbase is intended for auxiliary learning, testing, and educational analysis within the railway industry.")
        ]
      },
      {
        id: "prohibited",
        title: "3. Prohibited Actions",
        blocks: [
          h("p", {}, "Users are prohibited from:"),
          h("ul", {},
            h("li", {}, "Interfering with the platform's technical operations."),
            h("li", {}, "Attempting to gain unauthorized access to test answers."),
            h("li", {}, "Altering other users' results."),
            h("li", {}, "Circumventing testing time and attempt limits.")
          )
        ]
      },
      {
        id: "copyright",
        title: "4. Intellectual Property",
        blocks: [
          h("p", {}, "All rights to the platform architecture, code, design, and original content belong to the developers."),
          h("p", {}, "Educational materials may be used for personal study and presentations with proper attribution.")
        ]
      },
      {
        id: "liability",
        title: "5. Limitation of Liability",
        blocks: [
          h("p", {}, "The platform is provided «as is». Developers are not liable for technical interruptions or data loss caused by factors beyond their control.")
        ]
      }
    ]
  });

  scrollToDocSection(page, State.routeParam);
  return page;
}
