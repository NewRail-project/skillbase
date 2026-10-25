import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { listMyTests } from "../../core/editor.js";
import { listOrgAttempts } from "../../core/attempts.js";
import { icons } from "../../shared/icons.js";
import { brandLockup } from "../../ui/components/brand.js";

const ROLE_LABEL = { student: "Студент", teacher: "Преподаватель", admin: "Администратор" };

function tile({ icon, title, text, href, action }) {
  const card = h("a", { class: "quick-action", href });
  card.innerHTML = `<span class="icon">${icon}</span>`;
  card.append(
    h("b", {}, title),
    h("span", {}, text),
    h("span", { class: "badge badge-neutral", style: "margin-top:8px;align-self:flex-start" }, action)
  );
  return card;
}

export default async function AdminPanelPage() {
  const page = h("div", { class: "page" });
  const profile = State.profile || {};

  page.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Управление"),
      h("h1", {}, "Админ-панель"),
      h("p", { class: "page-sub" }, "Сводка по организации, доступ к управлению пользователями и тестами.")
    ),
    h("div", { class: "page-head-actions" },
      h("span", { class: "badge badge-info" }, ROLE_LABEL[profile.role] || "Сотрудник"),
      isStaff() ? h("a", { class: "btn primary", href: "#create-test" }, "Создать тест") : null
    )
  ));

  // Данные загружаются независимо: недоступность одного блока не ломает страницу.
  const state = { tests: [], attempts: [], testsError: null, attemptsError: null };
  await Promise.all([
    (async () => {
      try { state.tests = await listMyTests(State.user.uid); }
      catch (e) { state.testsError = e; }
    })(),
    (async () => {
      try { state.attempts = await listOrgAttempts(profile.orgId); }
      catch (e) { state.attemptsError = e; }
    })()
  ]);

  const published = state.tests.filter(t => t.status === "published").length;
  const pending = state.attempts.filter(a => a.status !== "graded").length;
  const participants = new Set(state.attempts.map(a => a.userId)).size;

  page.appendChild(h("section", { class: "stat-grid" },
    h("div", { class: "stat" },
      h("div", { class: "stat-value" }, state.testsError ? "—" : String(state.tests.length)),
      h("div", { class: "stat-label" }, "ваших тестов"),
      h("div", { class: "stat-hint" }, state.testsError ? "нет доступа к данным" : `опубликовано: ${published}`)
    ),
    h("div", { class: "stat" },
      h("div", { class: "stat-value" }, state.attemptsError ? "—" : String(state.attempts.length)),
      h("div", { class: "stat-label" }, "попыток в организации"),
      h("div", { class: "stat-hint" }, state.attemptsError ? "нет доступа к данным" : `ожидают проверки: ${pending}`)
    ),
    h("div", { class: "stat" },
      h("div", { class: "stat-value" }, state.attemptsError ? "—" : String(participants)),
      h("div", { class: "stat-label" }, "участников"),
      h("div", { class: "stat-hint" }, "уникальных авторов попыток")
    ),
    h("div", { class: "stat" },
      h("div", { class: "stat-value" }, profile.orgId || "—"),
      h("div", { class: "stat-label" }, "организация"),
      h("div", { class: "stat-hint" }, "идентификатор в Firestore")
    )
  ));

  if (state.testsError || state.attemptsError) {
    page.appendChild(h("div", { class: "notice", role: "status" },
      h("strong", {}, "Часть данных недоступна. "),
      "Правила Firestore не разрешают чтение выбранных коллекций. ",
      "Проверьте правила и составные индексы — интерфейс продолжит работать без этих цифр."
    ));
  }

  page.appendChild(h("section", { class: "panel" },
    h("div", { class: "section-title" }, h("h2", {}, "Разделы управления")),
    h("div", { class: "quick-actions", style: "margin-top:16px" },
      tile({
        icon: icons.users,
        title: "Пользователи",
        text: "Роли, подразделения и доступ сотрудников.",
        href: "#users",
        action: "Открыть"
      }),
      tile({
        icon: icons.book,
        title: "Тесты",
        text: "Создание, публикация и снятие с публикации.",
        href: "#tests",
        action: "Каталог"
      }),
      tile({
        icon: icons.chart,
        title: "Результаты",
        text: "Попытки организации и выгрузка в CSV.",
        href: "#results",
        action: "Открыть"
      }),
      profile.role === "admin" ? tile({
        icon: icons.check,
        title: "Администраторы",
        text: "Назначение и снятие административной роли в организации.",
        href: "#admins",
        action: "Управлять"
      }) : null,
      tile({
        icon: icons.settings,
        title: "Профиль",
        text: "Личные данные, скин интерфейса и тема.",
        href: "#profile",
        action: "Настроить"
      })
    )
  ));

  page.appendChild(h("section", { class: "panel" },
    h("div", { class: "section-title" },
      h("h2", {}, "Техническая сводка"),
      brandLockup({ size: 24, compact: true })
    ),
    h("div", { class: "field-grid", style: "margin-top:16px" },
      h("div", { class: "field" },
        h("span", { class: "muted" }, "UID администратора"),
        h("span", { class: "value", style: "font-family:var(--mono);font-size:.8125rem" }, State.user.uid)
      ),
      h("div", { class: "field" },
        h("span", { class: "muted" }, "Электронная почта"),
        h("span", { class: "value" }, State.user.email || "—")
      ),
      h("div", { class: "field" },
        h("span", { class: "muted" }, "Статус профиля"),
        h("span", { class: "value" }, State.profileStatus === "ready" ? "загружен" : State.profileStatus)
      ),
      h("div", { class: "field" },
        h("span", { class: "muted" }, "Тема и скин"),
        h("span", { class: "value" }, `${document.documentElement.getAttribute("data-theme")} · ${profile.ui || "education"}`)
      )
    )
  ));

  return page;
}
