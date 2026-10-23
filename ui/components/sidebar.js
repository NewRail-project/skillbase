import { h } from "../../shared/dom.js";
import { icons } from "../../shared/icons.js";
import { State, logout } from "../../core/auth.js";
import { getThemeMode, setThemeMode, getTheme } from "../../shared/theme.js";
import { brandLockup } from "./brand.js";

// Пункты меню сгруппированы по назначению и фильтруются по роли:
// студент не видит преподавательских и административных разделов.
const GROUPS = [
  {
    label: "Обучение",
    items: [
      { id: "home", label: "Главная", icon: icons.home, route: "#/" },
      { id: "assignments", label: "Задания", icon: icons.clipboard, route: "#assignments", auth: true },
      { id: "tests", label: "Каталог тестов", icon: icons.book, route: "#tests", auth: true },
      { id: "create-test", label: "Создать тест", icon: icons.plus, route: "#create-test", auth: true, roles: ["teacher", "admin"] },
      { id: "results", label: "Результаты", icon: icons.chart, route: "#results", auth: true, roles: ["teacher", "admin"] }
    ]
  },
  {
    label: "Аккаунт",
    items: [
      { id: "profile", label: "Профиль", icon: icons.users, route: "#profile", auth: true },
      { id: "settings", label: "Настройки", icon: icons.settings, route: "#settings", auth: true },
      { id: "users", label: "Пользователи", icon: icons.users, route: "#users", auth: true, roles: ["teacher", "admin"] },
      { id: "admin", label: "Админ-панель", icon: icons.settings, route: "#admin", auth: true, roles: ["admin"] }
    ]
  }
];

let isOpen = false;

export function setSidebarOpen(value) {
  isOpen = !!value;
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  const toggle = document.getElementById("sidebar-toggle");
  if (sidebar) sidebar.classList.toggle("open", isOpen);
  if (backdrop) backdrop.classList.toggle("show", isOpen);
  if (toggle) toggle.setAttribute("aria-expanded", String(isOpen));
  document.body.classList.toggle("sidebar-open", isOpen);
}

function isCurrentRoute(route) {
  const name = window.location.hash.replace(/^#\/?/, "").split("/")[0].split("?")[0];
  const target = route.replace(/^#\/?/, "").split("/")[0];
  return name === target;
}

function visibleItems(items) {
  const role = State.profile?.role;
  return items.filter(item => {
    if (item.auth && !State.user) return false;
    if (item.roles && !item.roles.includes(role)) return false;
    return true;
  });
}

export function renderSidebar(onChange) {
  const aside = h("aside", {
    class: "sidebar" + (isOpen ? " open" : ""),
    id: "sidebar",
    "aria-label": "Основная навигация"
  });

  aside.appendChild(h("div", { class: "sidebar-header" }, brandLockup({ size: 30 })));

  const nav = h("nav", { class: "sidebar-nav" });
  GROUPS.forEach(group => {
    const items = visibleItems(group.items);
    if (!items.length) return;
    nav.appendChild(h("div", { class: "sidebar-section-label" }, group.label));
    items.forEach(item => {
      const current = isCurrentRoute(item.route);
      const a = h("a", {
        class: "sidebar-item" + (current ? " active" : ""),
        href: item.route,
        onclick: () => setSidebarOpen(false)
      });
      if (current) a.setAttribute("aria-current", "page");
      const icon = h("span", { class: "icon", "aria-hidden": "true" });
      icon.innerHTML = item.icon;
      a.append(icon, h("span", { class: "label" }, item.label));
      nav.appendChild(a);
    });
  });
  aside.appendChild(nav);

  if (State.user) {
    const email = State.user.email || "";
    const name = State.profile?.fullName || email.split("@")[0] || "Участник";
    const roleLabel = { student: "студент", teacher: "преподаватель", admin: "администратор" }[State.profile?.role] || "студент";

    aside.appendChild(h("div", { class: "sidebar-profile" },
      h("div", { class: "user-header" },
        h("div", { class: "avatar avatar-sm", "aria-hidden": "true" }, name[0].toUpperCase()),
        h("div", { class: "profile-info" },
          h("div", { class: "profile-name" }, name),
          h("span", { class: "badge badge-neutral" }, roleLabel)
        )
      )
    ));

    const mode = getThemeMode();
    const themeLabel = { light: "Светлая тема", dark: "Тёмная тема", system: "Как в системе" }[mode] || "Тема";
    const themeIcon = getTheme() === "dark" ? icons.sun : icons.moon;

    const themeBtn = h("button", {
      type: "button",
      class: "btn secondary",
      "aria-label": `Тема: ${themeLabel}. Переключить`,
      onclick: () => {
        // Цикл: светлая -> тёмная -> как в системе -> светлая
        const next = mode === "light" ? "dark" : mode === "dark" ? "system" : "light";
        setThemeMode(next);
        if (onChange) onChange();
      }
    });
    themeBtn.innerHTML = `<span class="icon" style="display:inline-flex;width:18px;height:18px">${themeIcon}</span><span>${themeLabel}</span>`;

    aside.appendChild(h("div", { class: "sidebar-footer" },
      themeBtn,
      h("button", {
        type: "button",
        class: "btn danger",
        onclick: async () => {
          await logout();
          window.location.hash = "#login";
        }
      }, "Выйти")
    ));
  } else {
    aside.appendChild(h("div", { class: "sidebar-footer" },
      h("a", { class: "btn primary", href: "#login" }, "Войти"),
      h("a", { class: "btn secondary", href: "#register" }, "Регистрация")
    ));
  }

  return aside;
}

let wired = false;
export function initSidebar() {
  if (wired) return;
  wired = true;
  const toggle = document.getElementById("sidebar-toggle");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (toggle) toggle.addEventListener("click", () => setSidebarOpen(!isOpen));
  if (backdrop) backdrop.addEventListener("click", () => setSidebarOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) {
      setSidebarOpen(false);
      const t = document.getElementById("sidebar-toggle");
      if (t) t.focus();
    }
  });
}
