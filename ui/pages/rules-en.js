// ui/pages/rules-en.js — Usage Guidelines for Skillbase.
import { h } from "../../shared/dom.js";
import { docPage } from "../components/doc-page.js";

export default function RulesPageEn() {
  const page = docPage({
    eyebrow: "Documents",
    title: "Usage Guidelines",
    subtitle: "Brief rules for working with the Skillbase platform.",
    extra: [
      h("a", { href: "#rules" }, "Russian version"),
      "."
    ],
    sections: [
      {
        title: "1. Basic Principles",
        blocks: [
          h("p", {},=" The Skillbase platform is intended exclusively for educational purposes in the railway industry."),
          h("p", {},=" All users must follow the established rules to ensure effective and safe learning.")
        ]
      },
      {
        title: "2. Platform Usage Rules",
        blocks: [
          h("ul", {},
            h("li", {},=" Use the platform strictly for educational purposes;"),
            h("li", {},=" Not transfer access to your account to other persons;"),
            h("li", {},=" Not attempt to bypass test restrictions;"),
            h("li", {},=" Not interfere with the operation of Live rooms;"),
            h("li", {},=" Not attempt to access closed answers;"),
            h("li", {},=" Not modify other users' results.")
          )
        ]
      },
      {
        title: "3. Behavior in Group Sessions",
        blocks: [
          h("p", {},=" When participating in Live sessions, you must maintain proper conduct:"),
          h("ul", {},
            h("li", {},=" Follow the session leader's instructions;"),
            h("li", {},=" Not use profanity;"),
            h("li", {},=" Not interfere with other participants;"),
            h("li", {}=" Observe time limits when answering questions.")
          )
        ]
      },
      {
        title: "4. Data Protection",
        blocks: [
          h("p", {},=" The user is responsible for the security of their account:"),
          h("ul", {},
            h("li", {},=" Use strong passwords;"),
            h("li", {},=" Not share your data with third parties;"),
            h("li", {},=" Regularly check activity history in the account.")
          )
        ]
      },
      {
        title: "5. Material Usage",
        blocks: [
          h("p", {},=" Educational materials can be used for:"),
          h("ul", {},
            h("li", {},=" Personal learning;"),
            h("li", {},=" Educational presentations with source indication;"),
            h("li", {}=" Professional development.")
          )
        ]
      },
      {
        title: "6. Prohibited Actions",
        blocks: [
          h("p", {},=" The following are strictly prohibited:"),
          h("ul", {},
            h("li", {},=" Copying the platform without the author's permission;"),
            h("li", {},=" Distributing the platform for commercial purposes;"),
            h("li", {},=" Violating copyright on materials;"),
            h("li", {}=" Using the platform for illegal purposes.")
          )
        ]
      },
      {
        title: "7. Violation of Rules",
        blocks: [
          h("p", {},=" In case of rule violations, access to the platform may be restricted or blocked without warning."),
          h("p", {}=" The decision to block is made by the developer based on facts of violation.")
        ]
      },
      {
        title: "8. Technical Support",
        blocks: [
          h("p", {}=" For questions and technical support, contact us:"),
          h("ul", {},
            h("li", {}=" Email: bujlenkovdaniil@gmail.com;"),
            h("li", {}=" Telegram: @Frozencode_f")
          )
        ]
      }
    ]
  });

  return page;
}