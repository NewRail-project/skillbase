import { State, applyTheme } from "../core/auth.js";

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

  if (!route) { app.replaceChildren(message("Страница не найдена")); return; }
  if (route.auth && !State.user) { window.location.hash = "#login"; return; }
  if (route.guest && State.user) { window.location.hash = ""; return; }
  if (route.roles && !route.roles.includes(State.profile?.role)) {
    app.replaceChildren(message("Нет доступа к этой странице"));
    return;
  }

  document.title = `${route.title} — Skillbase`;
  app.innerHTML = `<div class="card"><div class="spinner"></div></div>`;

  try {
    const module = await import(`../ui/pages/${route.file}`);
    const el = await module.default({ params });
    if (token !== renderToken) return; // пользователь уже ушёл на другую страницу
    cleanup = el._cleanup || null;
    app.replaceChildren(el);
  } catch (err) {
    console.error("Router error:", err);
    if (token === renderToken) app.replaceChildren(message("Ошибка загрузки страницы: " + (err.message || err)));
  }
}

export function updateNav() {
  const nav = document.getElementById("nav");
  if (!nav) return;
  const hash = (window.location.hash.slice(1) || "").split("/")[0];
  const role = State.profile?.role;
  const links = State.user
    ? [["", "Главная"], ["tests", "Тесты"], ["results", "Результаты"],
       ...(STAFF.includes(role) ? [["create-test", "Создать"]] : []),
       ...(role === "admin" ? [["users", "Люди"]] : []),
       ["profile", "Профиль"]]
    : [["login", "Вход"], ["register", "Регистрация"]];
  nav.innerHTML = links.map(([h, t]) => `<a href="#${h}" class="${hash === h ? "active" : ""}">${t}</a>`).join("");
}

export function initRouter() {
  window.addEventListener("hashchange", router);
  applyTheme(State.profile?.ui);
  router();
}
