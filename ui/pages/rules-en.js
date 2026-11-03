// ui/pages/rules-en.js — Usage Guidelines (English).
import { h } from "../../shared/dom.js";
import { docPage, scrollToDocSection } from "../components/doc-page.js";
import { DOC_VERSIONS } from "../../core/consent-docs.js";
import { State } from "../../core/auth.js";

export default function RulesPageEn() {
  const page = docPage({
    eyebrow: "Documents",
    title: "Usage Guidelines",
    subtitle: "Practical advice and prohibitions for working with the platform.",
    updated: DOC_VERSIONS.rules,
    version: DOC_VERSIONS.rules,
    versionPrefix: "Revision dated",
    toc: true,
    extra: [
      h("a", { href: "#rules" }, "Русская версия"),
      " · ",
      h("a", { href: "#terms-en" }, "Terms of Use")
    ],
    sections: [
      {
        id: "account",
        title: "1. Account Security",
        blocks: [
          h("p", {}, "Your account is personal. Do not share your login credentials with others. Use Google authentication for enhanced security.")
        ]
      },
      {
        id: "integrity",
        title: "2. Academic Integrity",
        blocks: [
          h("p", {}, "Complete tests and assignments on your own. Using automated tools or seeking answers before completing a test undermines the learning process.")
        ]
      },
      {
        id: "live",
        title: "3. Live Sessions",
        blocks: [
          h("p", {}, "When participating in a Live room, use your real name or the name agreed upon with the instructor. Be respectful to other participants.")
        ]
      },
      {
        id: "content",
        title: "4. Responsible Use",
        blocks: [
          h("p", {}, "Use the platform solely for educational purposes. Any attempts to interfere with system operations or data integrity are strictly prohibited.")
        ]
      }
    ]
  });

  scrollToDocSection(page, State.routeParam);
  return page;
}
