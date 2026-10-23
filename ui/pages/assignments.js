import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { getStudentAssignments } from "../../core/assign.js";
import { icons } from "../../shared/icons.js";

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

export default async function AssignmentsPage() {
  const page = h("div", { class: "page" });
  const profile = State.profile || {};

  page.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Обучение"),
      h("h1", {}, "Мои задания"),
      h("p", { class: "page-sub" }, "Тесты, назначенные вашей группе, и сроки их прохождения.")
    ),
    h("div", { class: "page-head-actions" },
      h("a", { class: "btn secondary", href: "#tests" }, "Каталог тестов")
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
    const items = await getStudentAssignments(profile.groupId, profile.orgId);

    if (!items.length) {
      body.textContent = "";
      body.appendChild(h("div", { class: "empty-state" },
        h("div", { class: "empty-state-icon", innerHTML: icons.clipboard }),
        h("h2", {}, "Активных заданий нет"),
        h("p", { class: "muted" }, "Как только преподаватель назначит тест вашей группе, он появится здесь.")
      ));
      return page;
    }

    body.textContent = "";
    items
      .sort((a, b) => (a.deadline?.seconds || Infinity) - (b.deadline?.seconds || Infinity))
      .forEach(a => {
        const left = daysLeft(a.deadline);
        const deadline = formatDate(a.deadline);
        const overdue = left !== null && left < 0;

        const row = h("div", { class: "list-row" },
          h("span", { class: "dot " + (overdue ? "warn" : "ok") }),
          h("div", { class: "list-row-main" },
            h("div", { class: "list-row-title" }, a.title || a.testTitle || "Назначенный тест"),
            h("div", { class: "list-row-sub" },
              deadline
                ? `Срок: ${deadline}${left === null ? "" : overdue ? " · просрочено" : ` · осталось ${left} дн.`}`
                : "Срок не указан"
            )
          ),
          h("div", { class: "list-row-end" },
            h("a", {
              class: "btn " + (overdue ? "secondary" : "primary"),
              href: `#quiz/${encodeURIComponent(a.testId)}/${encodeURIComponent(a.id)}`
            }, "Открыть")
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
