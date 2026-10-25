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

let isOpen = false;

export function setSidebarOpen(value) {
  isOpen = !!value;
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  const toggle = document.getElementById("sidebar-toggle");
  if (sidebar) sidebar.classList.toggle("open", isOpen);
  if (backdrop) backdrop.classList.toggle("show", isOpen);
  if (toggle) toggle.setAttribute("aria-expanded", String(isOpen));
}

function isCurrentRoute(route) {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const target = route.replace(/^#\/?/, "");
  const name = hash.split("/")[0];
  return name === target;
}

export function renderSidebar(onChange) {
  const aside = h("aside", { class: "sidebar" + (isOpen ? " open" : ""), id: "sidebar", "aria-label": "Основная навигация" });

  const role = State.profile?.role;
  const filtered = navItems.filter(item => {
    if (item.auth && !State.user) return false;
    if (item.roles && !item.roles.includes(role)) return false;
    return true;
  });

  aside.appendChild(h("div", { class: "sidebar-header" }, "Skillbase"));

  const nav = h("nav", { class: "sidebar-nav" });
  filtered.forEach(item => {
    const current = isCurrentRoute(item.route);
    const a = h("a", { class: "sidebar-item" + (current ? " active" : ""), href: item.route });
    if (current) a.setAttribute("aria-current", "page");
    const icon = h("span", { class: "icon", "aria-hidden": "true" });
    icon.innerHTML = item.icon;
    a.append(icon, h("span", { class: "label" }, item.label));
    nav.appendChild(a);
  });
  aside.appendChild(nav);

  if (State.user) {
    const email = State.user.email || "";
    const name = State.profile?.fullName || email.split("@")[0] || "Участник";
    aside.appendChild(h("div", { class: "sidebar-profile" },
      h("div", { class: "avatar avatar-sm" }, name[0].toUpperCase()),
      h("div", { class: "profile-info" },
        h("div", { class: "profile-name" }, name),
        h("span", { class: "badge badge-neutral" }, role || "student")
      )
    ));

    const themeMode = getThemeMode();
    const themeLabel = { light: "светлая", dark: "тёмная", system: "как в системе" }[themeMode] || themeMode;
    aside.appendChild(h("div", { class: "sidebar-footer" },
      h("button", {
        type: "button", class: "btn secondary",
        onclick: () => {
          setThemeMode(themeMode === "light" ? "dark" : themeMode === "dark" ? "system" : "light");
          if (onChange) onChange();
        }
      }, "Тема: " + themeLabel),
      h("button", {
        type: "button", class: "btn danger",
        onclick: async () => { await logout(); window.location.hash = "#login"; }
      }, "Выйти")
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
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setSidebarOpen(false); });
}
