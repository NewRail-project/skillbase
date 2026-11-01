// ui/pages/about-en.js — About Skillbase: purpose, audience, features.
import { h } from "../../shared/dom.js";
import { docPage, scrollToDocSection } from "../components/doc-page.js";
import { State } from "../../core/auth.js";
import { generateQRSvg } from "../../shared/qr.js";

export default function AboutPageEn() {
  const siteUrl = "https://newrail-project.github.io/skillbase/";

  // QR code settings: Skillbase brand colors
  const qrOptions = {
    width: 280,
    height: 280,
    ecc: "H",
    rounded: true,
    dark: "#172817",        // dark green modules
    light: "#F5F7ED",       // light QR background
    finderDark: "#101810"   // even darker markers
  };

  const qrWrapper = h("div", {
    class: "qr-wrapper",
    style: "display: inline-block; background: #F5F7ED; padding: 1.25rem; border-radius: 1.5rem; box-shadow: 0 8px 24px rgba(0,0,0,0.2); line-height: 0; border: 2px solid #C5E747;"
  });
  qrWrapper.innerHTML = generateQRSvg(siteUrl, qrOptions);

  const page = docPage({
    eyebrow: "Platform",
    title: "About the project",
    subtitle: "Learning, knowledge testing and live sessions in the railway industry.",
    extra: [
      "Documents: ",
      h("a", { href: "#privacy-en" }, "privacy policy"),
      " · ",
      h("a", { href: "#terms-en" }, "terms of use"),
      " · ",
      h("a", { href: "#rules-en" }, "usage guidelines"),
      "."
    ],
    sections: [
      {
        title: "Skillbase",
        blocks: [
          h("p", {},=" Skillbase is a unified educational platform for supplementary learning, knowledge testing and professional development of people related to the railway industry."),
          h("p", {},=" The platform covers the complete educational cycle: creating materials, conducting tests, checking knowledge and analyzing results.")
        ]
      },
      {
        title: "Problem",
        blocks: [
          h("p", {},=" Traditional learning and knowledge testing methods are often inefficient: it's difficult to track progress, results are lost, and teachers find it hard to analyze students' weak points. Live checks require a lot of time for organization and result processing.")
        ]
      },
      {
        title: "Goal and Purpose",
        blocks: [
          h("p", {},=" Skillbase provides digital infrastructure for the educational process, automating routine operations and providing tools for in-depth knowledge analysis. The platform helps railway industry organizations maintain a high level of professional competence of employees and students.")
        ]
      },
      {
        title: "Main User Categories",
        blocks: [
          h("ul", {},
            h("li", {},=" Students of railway colleges and universities — learn from materials and take tests;"),
            h("li", {},=" Teachers — create educational materials, develop tests and check results;"),
            h("li", {},=" Depot workers — undergo regular knowledge checks of their organization;"),
            h("li", {},=" Locomotive crews and locomotive operators — improve qualifications through testing;"),
            h("li", {},=" Other railway industry specialists — use the platform for professional development.")
          )
        ]
      },
      {
        title:=" Main Platform Directions",
        blocks: [
          h("ul", {},
            h("li", {},=" Creating and taking tests — automated testing with various question types;"),
            h("li", {},=" Self-learning — access to educational materials and presentations anytime;"),
            h("li", {}=" Group sessions and Live testing — interactive knowledge checking in real time;"),
            h("li", {},=" Knowledge checking and result analysis — recording and evaluating performance with detail;"),
            h("li", {},=" Educational analytics — identifying problematic topics and tracking progress.")
          )
        ]
      },
      {
        title:=" NewRail Team",
        blocks: [
          h("p", {},=" Skillbase is developed by the NewRail team consisting of three specialists:"),
          h("ul", {},
            h("li", {},
              h("b", {},=" Daniil Buiylenkov"),
              " — main developer and author of the project. Responsible for architecture, programming, technical organization of the project, development and implementation of main ideas, integration of services and infrastructure."
            ),
            h("li", {},
              h("b", {},=" Nikita Golubyatnikov"),
              " — design and product development. Deals with user interface development, design and visual concept, discussion of function implementation methods, analysis of technical capabilities and project placement options, participation in forming the overall concept."
            ),
            h("li", {},
              h("b", {},=" Bogdan Chyorny"),
              " — product development and presentation. Responsible for discussing and analyzing project ideas, suggestions for functional development, concept development, preparation and conduct of project presentations, presentation of the team's work results."
            )
          )
        ]
      },
      {
        title:=" Technologies",
        blocks: [
          h("p", {},=" Skillbase uses a modern technology stack:"),
          h("ul", {},
            h("li", {},=" Frontend: Vanilla JS — pure JavaScript without frameworks for maximum performance;"),
            h("li", {},=" Backend: Firebase Auth / Firestore — cloud database and authentication;"),
            h("li", {},=" Deployment: GitHub Pages — free hosting for static websites.")
          )
        ]
      },
      {
        title:=" Further Development",
        blocks: [
          h("p", {},=" Skillbase is considered as the educational direction of the broader NewRail ecosystem related to digitalization and auxiliary processes in the railway industry."),
          h("p", {},=" Development plans:"),
          h("ul", {},
            h("li", {},=" integration with educational process management systems;"),
            h("li", {},=" development of Live rooms with new modes and functions;"),
            h("li", {},=" expansion of analytics and reporting for administrators and teachers;"),
            h("li", {}=" mobile application for convenient access to the platform on phones and tablets.")
          )
        ]
      },
      {
        id: "features",
        title:=" Platform Features",
        blocks: [
          h("ul", {},
            h("li", {},=" Learning: material-books with reading progress saving; 'learning' assignments where material needs to be read before the test."),
            h("li", {},=" Testing: simulators and exams with timer, attempt limits and server-side answer recording."),
            h("li", {},=" Assignments: assigning tests to groups with deadlines — students see what and by what date they need to complete."),
            h("li", {},=" Checking: automatic evaluation and manual checking by teacher — with scores and comments."),
            h("li", {},=" Results and analytics: attempt log, CSV export and question statistics — which questions cause difficulties."),
            h("li", {}=" Live sessions: rooms with code and QR access, question timers, rating and leaderboard.")
          )
        ]
      },
      {
        id: "training",
        title:=" Learning and Testing",
        blocks: [
          h("p", {},=" The usual cycle on the platform: student reads material → teacher gives assignment with deadline → student takes attempt → teacher checks → result is recorded in the log, if necessary retake is opened."),
          h("p", {}=" The process is honest: during an active attempt, materials are closed on the server, and correct answers are stored in a separate closed collection and not shown to the student. Showing answers after recording is a teacher setting in the test.")
        ]
      },
      {
        id: "live",
        title:=" Live Sessions",
        blocks: [
          h("p", {}=" Live room is interactive knowledge checking in real time. The leader opens the room by code or QR code, participants answer on phones, and results appear on the screen instantly."),
          h("ul", {},
            h("li", {}=" questions with timer and instant answer checking;"),
            h("li", {},=" participant rating and leaderboard by game results;"),
            h("li", {}=" additional modes: express questions, duels, reactions;"),
            h("li", {},=" 'at your own pace' mode for self-study;"),
            h("li", {}=" projector screen — separate screen for demonstration in the classroom.")
          )
        ]
      }
    ]
  });

  // Corporate card with QR code: platform address and PNG download.
  const card = h("section", { class: "panel" },
    h("div", { class: "panel-body" },
      h("div", { class: "about-grid" },
        h("div", {},
          h("p", {},=" Platform address for employees and students. Scan the QR code to open Skillbase on your phone — access is available on both the device and the computer."),
          h("div", { class: "btn-row", style: "margin-top: var(--space-3);" },
            h("a", {
              class: "btn",
              href: siteUrl,
              target: "_blank",
              rel: "noopener"
            }, "Open website")
          )
        ),
        h("div", {
          class: "brand-qr-card",
          style: "text-align: center; margin-top: 1rem; padding: 2.5rem 1.5rem; background: linear-gradient(135deg, #101810 0%, #0a0f0a 100%); color: #fff; border-radius: 1.25rem; border: 1px solid #C5E747; box-shadow: var(--shadow-lg); position: relative; overflow: hidden;"
        },
          h("div", { style: "margin-bottom: 1.25rem; position: relative;" },
            h("div", { style: "font-family: var(--font-brand); font-weight: 800; font-size: 1.5rem; letter-spacing: 0.1em; color: #C5E747; text-shadow: 0 0 10px rgba(197, 231, 71, 0.3);" }, "SKILLBASE"),
            h("div", { style: "font-size: 0.8rem; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.25rem;" }, "Corporate Platform")
          ),
          qrWrapper,
          h("p", { style: "margin: 1.25rem 0; font-size: 0.95rem; opacity: 0.9; position: relative;" }, "Scan to open the platform"),
          h("div", { class: "btn-row", style: "justify-content: center; gap: 0.75rem; position: relative;" },
            h("button", {
              class: "btn",
              id: "download-qr-btn",
              style: "background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); backdrop-filter: blur(10px);"
            }, "Download PNG")
          )
        )
      )
    )
  );
  page.appendChild(card);

  // Function to download QR code as real PNG via Canvas
  const downloadBtn = page.querySelector("#download-qr-btn");
  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      const svg = qrWrapper.querySelector("svg");
      if (!svg) return;

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const img = new Image();
      const svgData = new XMLSerializer().serializeToString(svg);
      const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);

      img.onload = () => {
        // Increase size for quality printing (e.g., 1024x1024)
        const exportSize = 1024;
        canvas.width = exportSize;
        canvas.height = exportSize;
        // Card background: light QR color to preserve design when downloading
        ctx.fillStyle = "#F5F7ED";
        ctx.fillRect(0, 0, exportSize, exportSize);
        ctx.drawImage(img, 0, 0, exportSize, exportSize);

        try {
          const pngUrl = canvas.toDataURL("image/png");
          const link = document.createElement("a");
          link.href = pngUrl;
          link.download = "skillbase-qr.png";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } catch (err) {
          console.error("PNG export failed:", err);
          alert("Failed to save PNG. Try taking a screenshot.");
        }
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        alert("Error preparing image.");
      };
      img.src = url;
    });
  }

  scrollToDocSection(page, State.routeParam);
  return page;
}