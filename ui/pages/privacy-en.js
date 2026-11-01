// ui/pages/privacy-en.js — Privacy Policy for Skillbase.
import { h } from "../../shared/dom.js";
import { docPage } from "../components/doc-page.js";

export default function PrivacyPageEn() {
  const page = docPage({
    eyebrow: "Documents",
    title: "Privacy Policy",
    subtitle: "How we process your data in Skillbase.",
    extra: [
      "Effective date: November 2, 2026",
      " · ",
      h("a", { href: "#privacy" }, "Russian version"),
      "."
    ],
    sections: [
      {
        title: "1. General Information",
        blocks: [
          h("p", {},=" This document describes the personal data processing policy in the educational platform Skillbase (hereinafter referred to as the \"Platform\")."),
          h("p", {},=" The Platform is developed by the NewRail team. The developer and contact person is Daniil Buiylenkov."),
          h("p", {},=" The project is not a registered legal entity and represents an educational product provided free of charge."),
          h("p", {},=" The Platform is intended for educational purposes and is oriented towards users related to the railway industry.")
        ]
      },
      {
        title: "2. What data is collected",
        blocks: [
          h("p", {},=" In the process of using the Platform, the following categories of data may be collected:"),
          h("ul", {},
            h("li", {},=" Authentication data: email, password (for registration), Google account data (when using Google Authentication);"),
            h("li", {},=" Profile data: user's full name (when filling out the profile), organization name, study group, user role (student, teacher, administrator);"),
            h("li", {},=" Test data: answers to questions, test completion time, test result (scores, percentage of correct answers);"),
            h("li", {},=" Activity history: test history, attempt log, data about Live rooms;"),
            h("li", {},=" Technical data: IP address, browser type, access device, session data (to ensure security and functionality).")
          )
        ]
      },
      {
        title: "3. How data is used",
        blocks: [
          h("p", {},=" Collected data is used exclusively for educational purposes:"),
          h("ul", {},
            h("li", {},=" User authentication and access to personalized Platform features;"),
            h("li", {},=" Conducting tests and recording results for knowledge assessment;"),
            h("li", {},=" Academic performance analysis and identification of problematic topics;"),
            h("li", {},=" Organization of Live sessions and interactive learning;"),
            h("li", {},=" Technical maintenance and improvement of the Platform;"),
            h("li", {},=" Ensuring security and preventing unauthorized access.")
          )
        ]
      },
      {
        title: "4. Authorization and accounts",
        blocks: [
          h("p", {},=" The Platform uses Firebase Authentication for secure user authentication:"),
          h("ul", {},
            h("li", {},=" Email and password: users can create an account using email and password;"),
            h("li", {},=" Google Authentication: access via Google account for simplified registration;"),
            h("li", {},=" Guest sessions: users can take individual tests or participate in Live rooms without creating an account;"),
            h("li", {},=" Guest session data is not saved in the Platform's database after the session ends.")
          )
        ]
      },
      {
        title: "5. Test result processing",
        blocks: [
          h("p", {},=" Test results are processed as follows:"),
          h("ul", {},
            h("li", {},=" Planned tests: results are saved in the database for academic performance analysis and providing teachers with reports;"),
            h("li", {},=" Live rooms: results are used for real-time demonstration and are not processed as planned test results;"),
            h("li", {},=" Access to results: teachers, administrators, and test authors have access to users' results of their organization within the rights provided by the system;"),
            h("li", {},=" Correct answers: stored in a separate closed collection and not available to students during an active attempt.")
          )
        ]
      },
      {
        title: "6. Information access",
        blocks: [
          h("p", {},=" Access to personal data is strictly limited:"),
          h("ul", {},
            h("li", {},=" Users have access only to their own data (profile, test results);"),
            h("li", {},=" Teachers see only results of students from their organization;"),
            h("li", {},=" Administrators have access to organization settings and user groups;"),
            h("li", {},=" Data is not transferred to third parties, except for Google Firebase services used for technical Platform support.")
          )
        ]
      },
      {
        title: "7. Use of Firebase and Google services",
        blocks: [
          h("p", {},=" The Platform uses the following Google Firebase services:"),
          h("ul", {},
            h("li", {},=" Firebase Authentication: for user and session management;"),
            h("li", {},=" Firestore: for storing user data, tests, results, and settings;"),
            h("li", {},=" Google Cloud Platform: for infrastructure and data storage."),
            h("li", {},=" Data is processed in accordance with Google's privacy policies. For more details, see the Google Cloud Platform documentation.")
          )
        ]
      },
      {
        title: "8. Data deletion",
        blocks: [
          h("p", {},=" Users can request deletion of their data through project contacts:"),
          h("ul", {},
            h("li", {},=" Email: bujlenkovdaniil@gmail.com;"),
            h("li", {},=" Telegram: @Frozencode_f;"),
            h("li", {},=" After receiving the request, data will be deleted from the Platform's database within 30 days."),
            h("li", {},=" Note: technical data required for Platform operation (e.g., system logs) may be stored longer for technical requirements.")
          )
        ]
      },
      {
        title: "9. Developer contacts",
        blocks: [
          h("p", {},=" All questions related to data privacy should be directed to the developer:"),
          h("ul", {},
            h("li", {},=" Daniil Buiylenkov — main project developer;"),
            h("li", {},=" Email: bujlenkovdaniil@gmail.com;"),
            h("li", {},=" Telegram: @Frozencode_f;"),
            h("li", {},=" GitHub: https://github.com/NewRail-project/skillbase")
          )
        ]
      },
      {
        title: "10. Legislation",
        blocks: [
          h("p", {},=" Personal data processing in the Platform is carried out with consideration of the requirements of the legislation of the Republic of Kazakhstan on personal data."),
          h("p", {},=" For full compliance with legislation, additional legal information and confirmation of actual data processing procedures may be required. In such cases, the developer will provide the relevant information upon request.")
        ]
      }
    ]
  });

  return page;
}