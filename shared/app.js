import { State, applyTheme } from "../core/auth.js";
import { loading } from "../ui/components/loading.js";
import { empty } from "../ui/components/empty.js";
import { error } from "../ui/components/error.js";

const STAFF = ["teacher", "admin"];

// auth: нужен вход, guest: только для гостей, roles: допустимые роли
const routes = {
  "":            { file: "home.js",         title: "Главная" },
  "login":       { file: "login.js",        title: "Вход", guest: true },
  "register":    { file: "register.js",     title: "Регистрация", guest: true },
  "profile":     { file: "profile.js",      title: "Профиль", auth: true },
  "tests":       { file: "tests.js",        title: "Тесты", auth: true },
  "create-test": { file: "create-test.js",  title: "Создать тест", auth: true, roles: STAFF },
  "quiz":        { file: "quiz.js",         title: "Тест", auth: true },
  "results":     { file: "results.js",      title: "Результаты", auth: true },
  "users":       { file: "users.js",        title: "Пользователи", auth: true, roles: ["admin"] }
};

let renderToken = 0;
let cleanup = null;

function parseHash() {
  const [name, ...params] = (window.location.hash.slice(1) || "").replace(/^\//, "").split("/");
  return { name, params: params.map(decodeURIComponent) };
}

function message(text) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<p class="error-msg"></p><a class="btn" href="#">На главную</a>`;
  card.querySelector("p").textContent = text;
  return card;
}

export async function router() {
  const { name, params } = parseHash();
  const route = routes[name];
  const app = document.getElementById("app");
  if (!app) return;

  if (typeof cleanup === "function") { try { cleanup(); } catch (e) { /* ignore */ } }
  cleanup = null;
  const token = ++renderToken;

  updateNav();

  if (!route) { app.replaceChildren(error({ text: "Страница не найдена" })); return; }
  if (route.auth && !State.user) { window.location.hash = "#login"; return; }
  if (route.guest && State.user) { window.location.hash = ""; return; }
  if (route.roles && !route.roles.includes(State.profile?.role)) {
    app.replaceChildren(error({ text: "Нет доступа к этой странице" }));
    return;
  }

  document.title = `${route.title} — Skillbase`;
  app.replaceChildren(loading());

  try {
    const module = await import(`../ui/pages/${route.file}`);
    const el = await module.default({ params });
    if (token !== renderToken) return; // пользователь уже ушёл на другую страницу
    cleanup = el._cleanup || null;
    app.replaceChildren(el);
  } catch (err) {
    console.error("Router error:", err);
    if (token === renderToken) app.replaceChildren(error({ text: "Ошибка загрузки страницы: " + (err.message || err) }));
  }
}

export function updateNav() {
  const nav = document.getElementById("nav");
  const bottomNav = document.getElementById("bottom-nav");
  const hash = (window.location.hash.slice(1) || "").split("/")[0];
  const role = State.profile?.role;

  const links = State.user
    ? [
        ["", "Главная", "home"],
        ["tests", "Тесты", "tests"],
        ["results", "Результаты", "results"],
        ...(STAFF.includes(role) ? [["create-test", "Создать", "create"]] : []),
        ...(role === "admin" ? [["users", "Люди", "users"]] : []),
        ["profile", "Профиль", "profile"]
      ]
    : [
        ["login", "Вход", "login"],
        ["register", "Регистрация", "register"]
      ];

  const render = (container, className) => {
    if (!container) return;
    container.innerHTML = links.map(([h, t, iconName]) => {
      const icon = iconHTML(iconName);
      return `<a href="#${h}" class="${hash === h ? "active" : ""} ${className}" aria-current="${h === hash ? "page" : "false"}">
        ${icon}
        <span>${t}</span>
      </a>`;
    }).join("");
  };

  render(nav, "navigation-item");
  render(bottomNav, "bottom-nav-item");
}

export function initRouter() {
  window.addEventListener("hashchange", router);
  applyTheme(State.profile?.ui);
  router();
}
