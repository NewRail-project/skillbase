import { h } from "../../shared/dom.js";
import { icons } from "../../shared/icons.js";
import { State, logout } from "../../core/auth.js";
import { getThemeMode, setThemeMode } from "../../shared/theme.js";

const navItems = [
  { id: "home", label: "Главная", icon: icons.home, route: "#/" },
  { id: "assignments", label: "Задания", icon: icons.clipboard, route: "#assignments", auth: true },
  { id: "create-test", label: "Тесты", icon: icons.book, route: "#create-test", auth: true, roles: ["teacher", "admin"] },
  { id: "results", label: "Результаты", icon: icons.chart, route: "#results", auth: true, roles: ["teacher", "admin"] },
  { id: "profile", label: "Профиль", icon: icons.users, route: "#profile", auth: true }
];

export function renderSidebar() {
  const aside = h("div", { class: "sidebar", id: "sidebar", "aria-label": "Основная навигация" });

  const role = State.profile?.role;
  const filtered = navItems.filter(item => {
    if (item.auth && !State.user) return false;
    if (item.roles && !item.roles.includes(role)) return false;
    return true;
  });

  const header = h("div", { class: "sidebar-header" },
    h("button", {
      class: "sidebar-toggle",
      id: "sidebar-toggle",
      "aria-expanded": false,
      "aria-controls": "sidebar"
    },
      h("svg", { viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor", strokeWidth: "2" },
        h("path", { d: "M3 12h18M3 6h18M3 18h18" })
      )
    )
  );
  aside.appendChild(header);

  const nav = h("nav", { class: "sidebar-nav" });
  filtered.forEach(item => {
    const isCurrent = window.location.hash === item.route || (item.route === "#/" && window.location.hash === "");
    const a = h("a", {
      class: "sidebar-item" + (isCurrent ? " active" : ""),
      href: item.route,
      "aria-current": isCurrent ? "page" : null
    },
      h("span", { class: "icon", innerHTML: item.icon }),
      h("span", { class: "label" }, item.label)
    );
    nav.appendChild(a);
  });
  aside.appendChild(nav);

  if (State.user) {
    const profile = h("div", { class: "sidebar-profile" });
    const email = State.user.email || "";
    const name = State.profile?.fullName || email.split("@")[0] || "Участник";
    profile.appendChild(h("div", { class: "avatar avatar-sm" }, name[0].toUpperCase()));
    profile.appendChild(h("div", { class: "profile-info" },
      h("div", { class: "profile-name" }, name),
      h("span", { class: "badge badge-neutral" }, role || "student")
    ));
    aside.appendChild(profile);

    const footer = h("div", { class: "sidebar-footer" });
    const themeMode = getThemeMode();
    const themeBtn = h("button", {
      class: "btn secondary",
      onclick: () => {
        const next = themeMode === "light" ? "dark" : themeMode === "dark" ? "system" : "light";
        setThemeMode(next);
      }
    }, "Тема: " + themeMode);
    footer.appendChild(themeBtn);

    const logoutBtn = h("button", {
      class: "btn danger",
      onclick: async () => { await logout(); window.location.hash = "#login"; }
    }, "Выйти");
    footer.appendChild(logoutBtn);

    aside.appendChild(footer);
  }

  return aside;
}

export function initSidebar() {
  const toggle = document.getElementById("sidebar-toggle");
  const sidebar = document.getElementById("sidebar");
  const appContainer = document.getElementById("app-container");
  const app = document.getElementById("app");
  
  if (!toggle || !sidebar || !appContainer || !app) return;

  // Обработка мобильного меню
  toggle.addEventListener("click", () => {
    const isOpen = sidebar.classList.toggle("open");
    toggle.setAttribute("aria-expanded", isOpen);
    
    if (isOpen) {
      appContainer.style.display = "none";
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.top = "0";
      document.body.style.left = "0";
      document.body.style.width = "100%";
      document.body.style.height = "100vh";
      document.body.style.zIndex = "1001";
      document.body.style.backgroundColor = "var(--bg)";
    } else {
      appContainer.style.display = "flex";
      document.body.style.overflow = "auto";
      document.body.style.position = "relative";
      document.body.style.top = "0";
      document.body.style.left = "0";
      document.body.style.width = "auto";
      document.body.style.height = "auto";
      document.body.style.zIndex = "auto";
      document.body.style.backgroundColor = "transparent";
    }
  });

  // Переключение темы
  const themeMode = getThemeMode();
  const themeBtn = document.querySelector(".sidebar-footer .btn.secondary");
  if (themeBtn) {
    themeBtn.textContent = "Тема: " + themeMode;
  }
}

export function cleanup() {
  const toggle = document.getElementById("sidebar-toggle");
  const sidebar = document.getElementById("sidebar");
  if (toggle && sidebar) {
    toggle.removeEventListener("click", arguments[0]);
    sidebar.classList.remove("open");
  }
}