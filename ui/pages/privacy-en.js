// ui/pages/privacy-en.js — Privacy Policy (English).
import { h } from "../../shared/dom.js";
import { docPage, scrollToDocSection } from "../components/doc-page.js";
import { DOC_VERSIONS } from "../../core/consent-docs.js";
import { State } from "../../core/auth.js";

export default function PrivacyPageEn() {
  const page = docPage({
    eyebrow: "Documents",
    title: "Privacy Policy",
    subtitle: "How we process and protect your data in Skillbase.",
    updated: DOC_VERSIONS.privacy,
    version: DOC_VERSIONS.privacy,
    versionPrefix: "Revision dated",
    toc: true,
    extra: [
      h("a", { href: "#privacy" }, "Русская версия"),
      " · ",
      h("a", { href: "mailto:bujlenkovdaniil@gmail.com" }, "Report an issue")
    ],
    sections: [
      {
        id: "intro",
        title: "1. General Provisions",
        blocks: [
          h("p", {}, "This Privacy Policy describes how Skillbase educational platform (hereinafter — «Platform») collects, uses, and protects information."),
          h("p", {}, "The Platform is developed as an independent educational solution. The developer and data controller is Daniil Buylyenkov."),
          h("p", {}, "By using the Platform, you agree to the terms of this Policy.")
        ]
      },
      {
        id: "data",
        title: "2. Data Collection",
        blocks: [
          h("p", {}, "We collect only the data necessary for educational functions:"),
          h("ul", {},
            h("li", {}, h("strong", {}, "Authentication data:"), " email/password or Google account data."),
            h("li", {}, h("strong", {}, "Profile data:"), " Full name, organization, group, and role (student/teacher)."),
            h("li", {}, h("strong", {}, "Testing data:"), " answers, time spent, scores, and results."),
            h("li", {}, h("strong", {}, "Technical data:"), " IP address, browser type, and session IDs.")
          )
        ]
      },
      {
        id: "purpose",
        title: "3. Purpose of Processing",
        blocks: [
          h("p", {}, "Data is used for:"),
          h("ul", {},
            h("li", {}, "Providing access to learning and testing features."),
            h("li", {}, "Recording educational results and reports for teachers."),
            h("li", {}, "Technical support and interface improvement."),
            h("li", {}, "Security and prevention of cheating.")
          )
        ]
      },
      {
        id: "access",
        title: "4. Data Access",
        blocks: [
          h("p", {}, "Data access is restricted to:"),
          h("ul", {},
            h("li", {}, "The user (their own results and profile)."),
            h("li", {}, "Teachers and admins of the user's organization."),
            h("li", {}, "Platform developers for maintenance.")
          )
        ]
      },
      {
        id: "deletion",
        title: "5. Data Deletion",
        blocks: [
          h("p", {}, "You have the right to request deletion of your account and data."),
          h("p", {}, "Send a request to ", h("a", { href: "mailto:bujlenkovdaniil@gmail.com" }, "bujlenkovdaniil@gmail.com"), " or via Telegram ", h("a", { href: "https://t.me/Frozencode_f" }, "@Frozencode_f"), "."),
          h("p", {}, "Data will be deleted within 30 calendar days.")
        ]
      }
    ]
  });

  scrollToDocSection(page, State.routeParam);
  return page;
}
