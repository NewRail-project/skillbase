// ui/pages/assignments.js — задания студента: обучающие и проверочные.
// Бейджи «Обучение»/«Проверка», статусы (запланировано, выполнено,
// просрочено, срок сегодня), сортировка по срочности, перед стартом
// тест показывает название и материал задания.
import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { getStudentAssignments } from "../../core/assign.js";
import { listMyAttempts } from "../../core/attempts.js";
import {
  assignmentKindLabel, assignmentBadgeClass,
  assignmentState, STATE_LABEL, STATE_BADGE, STATE_DOT,
  sortAssignments, isAssignmentVisible, deadlineSubtitle
} from "../../core/assignment-logic.js";
import { icons } from "../../shared/icons.js";
import { generateQRDataUrl } from "../../shared/qr.js";

function formatDate(value) {
  if (!value) return null;
  const date = value.toDate ? value.toDate() : value.seconds ? new Date(value.seconds * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
}

function daysLeft(value) {
  if (!value) return null;
  const date = value.toDate ? value.toDate() : value.seconds ? new Date(value.seconds * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

function showQRCode(title, url) {
  const overlay = h("div", { class: "modal-overlay", role: "dialog", "aria-label": "QR-код" });
  const panel = h("div", { class: "modal-panel panel" },
    h("div", { class: "modal-head" },
      h("h2", {}, title || "QR-код"),
      h("button", { class: "btn secondary", onclick: () => overlay.remove() }, "Закрыть")
    ),
    h("div", { class: "modal-body" },
      h("p", { class: "muted" }, "Отсканируйте QR-код камерой или перейдите по ссылке ниже."),
      h("div", { class: "qr-box" }),
      h("p", { class: "muted", style: "margin-top: 8px; word-break: break-all;" }, url)
    )
  );
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const qrBox = panel.querySelector('.qr-box');
  generateQRDataUrl(url).then(dataUrl => {
    if (dataUrl) {
      const img = h("img", { src: dataUrl, alt: "QR-код", width: "220", height: "220", style: "display: block; margin: 0 auto;" });
      qrBox.appendChild(img);
    } else {
      qrBox.textContent = "Не удалось сгенерировать QR-код.";
    }
  });

  const close = (e) => { if (e.key === "Escape" || e.target === overlay) overlay.remove(); };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.addEventListener("keydown", close);
  overlay._cleanup = () => document.removeEventListener("keydown", close);
}

// Старт с показом названия и материала задания.
function startWithPreview(a) {
  const overlay = h("div", { class: "modal-overlay", role: "dialog", "aria-label": "О задании" });
  const deadline = formatDate(a.deadline);
  const body = h("div", { class: "modal-body" },
    deadline ? h("p", { class: "muted" }, `Срок: ${deadline} · ${deadlineSubtitle(a.deadline)}`) : null,
    a.note ? h("p", {}, a.note) : null,
    a.materialText ? h("div", { class: "assignment-material" }, a.materialText) : null,
    a.materialUrl
      ? h("p", {},
          h("a", { href: a.materialUrl, target: "_blank", rel: "noopener" },
            a.materialUrl.replace(/^https:\/\//, "")))
      : null,
    !(a.note || a.materialText || a.materialUrl)
      ? h("p", { class: "muted" }, "Материала нет: сразу к вопросам.")
      : null
  );
  overlay.appendChild(h("div", { class: "modal-panel panel" },
    h("div", { class: "modal-head" },
      h("h2", {}, a.title || a.testTitle || "Назначенный тест"),
      h("button", { class: "btn secondary", onclick: () => overlay.remove() }, "Закрыть")
    ),
    body,
    h("div", { class: "modal-body", style: "display:flex;gap:8px" },
      h("a", {
        class: "btn primary",
        href: `#quiz/${encodeURIComponent(a.testId)}/${encodeURIComponent(a.id)}`
      }, "Начать тест")
    )
  ));

  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  const close = (e) => { if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", close); } };
  document.addEventListener("keydown", close);
  document.body.appendChild(overlay);
}

export default async function Assignments() {
  const page = h("div", { class: "page" });
  const profile = State.profile || {};

  page.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Обучение"),
      h("h1", {}, "Мои задания"),
      h("p", { class: "page-sub" }, "Обучающие и проверочные задания вашей группы, сроки и материалы.")
    ),
    h("div", { class: "page-head-actions" },
      h("a", { class: "btn secondary", href: "#tests" }, "Каталог тестов"),
      h("a", { class: "btn secondary", href: "#join" }, "Войти по коду")
    )
  ));

  const panel = h("section", { class: "panel panel-flush" });
  page.appendChild(panel);

  if (!profile.groupId) {
    panel.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "empty-state-icon", innerHTML: icons.clipboard }),
      h("h2", {}, "Группа не назначена"),
      h("p", { class: "muted" }, "Задания выдаются на группу. Обратитесь к администратору, чтобы вас добавили в группу — после этого назначенные тесты появятся здесь."),
      h("a", { class: "btn secondary", href: "#tests" }, "Открыть каталог")
    ));
    return page;
  }

  const body = h("div", { class: "list" });
  panel.appendChild(h("div", { class: "panel-head" },
    h("h2", {}, "Активные назначения")
  ));
  panel.appendChild(body);
  body.appendChild(h("div", { class: "panel-body" }, h("div", { class: "spinner" })));

  try {
    const [items, myAttempts] = await Promise.all([
      getStudentAssignments(profile.groupId, profile.orgId),
      listMyAttempts(profile.uid)
    ]);

    // Запланированные задания студенту ещё не видно.
    const visible = items.filter(a => isAssignmentVisible(a));
    if (!visible.length) {
      body.textContent = "";
      body.appendChild(h("div", { class: "empty-state" },
        h("div", { class: "empty-state-icon", innerHTML: icons.clipboard }),
        h("h2", {}, items.length ? "Задания ещё не открыты" : "Активных заданий нет"),
        h("p", { class: "muted" }, items.length
          ? "Преподаватель запланировал открытия. Задания появятся здесь."
          : "Как только преподаватель назначит тест вашей группе, он появится здесь.")
      ));
      return page;
    }

    const ordered = sortAssignments(visible, myAttempts);
    body.textContent = "";
    ordered.forEach(a => {
      const state = assignmentState(a, myAttempts);
      const deadline = formatDate(a.deadline);
      const startAt = a.startAt?.toDate?.() || a.startAt?.seconds && new Date(a.startAt.seconds * 1000);
      const subParts = [
        deadline ? `Срок: ${deadline} · ${deadlineSubtitle(a.deadline)}` : "Срок не указан"
      ];
      if (startAt && startAt.getTime() > Date.now()) {
        subParts.push(`откроется ${formatDate(a.startAt)}`);
      }

      const row = h("div", { class: "list-row" },
        h("span", { class: "dot " + STATE_DOT[state] }),
        h("div", { class: "list-row-main" },
          h("div", { class: "list-row-title" }, a.title || a.testTitle || "Назначенный тест"),
          h("div", { class: "list-row-sub" }, subParts.join(" · "))
        ),
        h("div", { class: "list-row-end", style: "display:flex;gap:8px;align-items:center" },
          h("span", { class: "badge badge-neutral" }, assignmentKindLabel(a)),
          h("span", { class: STATE_BADGE[state] }, STATE_LABEL[state]),
          h("button", {
            class: "btn secondary icon-only",
            title: "Показать QR-код",
            onclick: () => {
              const url = window.location.origin + window.location.pathname
                + `#quiz/${encodeURIComponent(a.testId)}/${encodeURIComponent(a.id)}`;
              showQRCode(a.title || a.testTitle, url);
            }
          }, h("span", { innerHTML: icons.qr || "QR" })),
          state === "done"
            ? h("a", {
                class: "btn secondary",
                href: `#results`
              }, "Результат")
            : state === "scheduled"
              ? h("span", { class: "badge badge-neutral" }, STATE_LABEL[state])
              : h("button", {
                  class: "btn " + (state === "overdue" ? "secondary" : "primary"),
                  onclick: () => startWithPreview(a)
                }, state === "overdue" ? "Просрочено · открыть" : state === "dueToday" ? "Срок сегодня · открыть" : "Открыть")
        )
      );
      body.appendChild(row);
    });
  } catch (err) {
    console.error("Задания:", err);
    body.textContent = "";
    body.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "empty-state-icon", innerHTML: icons.clipboard }),
      h("h2", {}, "Не удалось загрузить задания"),
      h("p", { class: "muted" }, err?.code === "permission-denied"
        ? "Правила Firestore не разрешают чтение назначений."
        : "Проверьте подключение к сети и попробуйте снова."),
      h("button", { type: "button", class: "btn secondary", onclick: () => window.location.reload() }, "Повторить")
    ));
  }

  return page;
}
