// ui/pages/terms-en.js — Terms of Use for Skillbase.
import { h } from "../../shared/dom.js";
import { docPage } from "../components/doc-page.js";

export default function TermsPageEn() {
  const page = docPage({
    eyebrow: "Documents",
    title: "Terms of Use",
    subtitle: "Rules for using the educational platform Skillbase.",
    extra: [
      "Effective date: November 2, 2026",
      " · ",
      h("a", { href: "#terms" }, "Russian version"),
      "."
    ],
    sections: [
      {
        title: "1. General Provisions",
        blocks: [
          h("p", {},=" This document defines the terms of use for the educational platform Skillbase (hereinafter referred to as the \"Platform\")."),
          h("p", {},=" The Platform is provided free of charge and does not contain paid subscriptions, donations, or paid access to features in the current version."),
          h("p", {},=" By using the Platform, the user agrees to the terms of this Agreement.")
        ]
      },
      {
        title: "2. Purpose of the Platform",
        blocks: [
          h("p", {},=" Skillbase is an educational platform intended for:"),
          h("ul", {},
            h("li", {},=" Teaching students of railway colleges and universities;"),
            h("li", {},=" Checking knowledge of teachers and depot employees;"),
            h("li", {},=" Professional development of railway industry specialists;"),
            h("li", {},=" Conducting Live sessions and interactive learning.")
          )
        ]
      },
      {
        title: "3. Platform Users",
        blocks: [
          h("p", {},=" The following categories of users are allowed to use the Platform:"),
          h("ul", {},
            h("li", {},=" Students — for learning and taking tests;"),
            h("li", {},=" Teachers — for creating educational materials and checking knowledge;"),
            h("li", {},=" Depot employees — for professional development and knowledge checking;"),
            h("li", {},=" Locomotive crews — for professional development;"),
            h("li", {},=" Other users related to educational and railway activities.")
          )
        ]
      },
      {
        title: "4. User Obligations",
        blocks: [
          h("p", {},=" The user undertakes to:"),
          h("ul", {},
            h("li", {},=" Provide accurate information when taking tests and filling out the profile;"),
            h("li", {},=" Use the Platform exclusively for educational purposes;"),
            h("li", {},=" Follow the rules of conduct during group sessions and in Live rooms;"),
            h("li", {},=" Not transfer access to their account to other persons;"),
            h("li", {},=" Not attempt to bypass test restrictions or interfere with the system operation.")
          )
        ]
      },
      {
        title: "5. Prohibited Actions",
        blocks: [
          h("p", {},=" The following are prohibited on the Platform:"),
          h("ul", {},
            h("li", {},=" Obtaining closed answers and unauthorized access to other people's data;"),
            h("li", {},=" Attempts to hack the system or bypass restrictions;"),
            h("li", {},=" Interfering with the operation of Live rooms and unauthorized modification of results;"),
            h("li", {},=" Posting materials that violate the rights of others;"),
            h("li", {},=" Using the Platform for illegal or purposes contrary to its intended purpose.")
          )
        ]
      },
      {
        title: "6. Use of Educational Materials",
        blocks: [
          h("p", {},=" Educational materials provided in the Platform can be used:"),
          h("ul", {},
            h("li", {},=" For personal learning and educational presentations with mandatory indication of the source (Skillbase);"),
            h("li", {},=" For demonstrating the project for educational purposes with indication of authorship;"),
            h("li", {},=" Full copying of the Platform, its source code, design, and materials without the author's permission is not allowed.")
          )
        ]
      },
      {
        title: "7. Copyright",
        blocks: [
          h("p", {},=" All materials placed in the Platform are the intellectual property of their authors or are used under the appropriate licenses."),
          h("p", {},=" The user does not acquire rights to intellectual property created or placed in the Platform.")
        ]
      },
      {
        title: "8. Liability",
        blocks: [
          h("p", {},=" The user is responsible for the accuracy of the data provided and compliance with this Agreement."),
          h("p", {},=" The Platform developer is not responsible for the use of the Platform in violation of the established rules.")
        ]
      },
      {
        title: "9. Changes to the Agreement",
        blocks: [
          h("p", {},=" The developer reserves the right to make changes to this Agreement. The updated version will be available in the Platform."),
          h("p", {},=" Continued use of the Platform after changes are made means the user's agreement with the new version of the Agreement.")
        ]
      },
      {
        title: "10. Contacts",
        blocks: [
          h("p", {},=" All questions related to the use of the Platform should be directed to the developer:"),
          h("ul", {},
            h("li", {},=" Email: bujlenkovdaniil@gmail.com;"),
            h("li", {},=" Telegram: @Frozencode_f;"),
            h("li", {},=" GitHub: https://github.com/NewRail-project/skillbase")
          )
        ]
      }
    ]
  });

  return page;
}