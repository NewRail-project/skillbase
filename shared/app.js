import { State, applyTheme } from "../core/auth.js";

const STAFF = ["teacher", "admin"];

const routes = {
  "":             { file: "ui/pages/home.js",              title: "Главная" },
  "login":        { file: "ui/pages/login.js",             title: "Вход",                 guestOnly: true },
  "register":     { file: "ui/pages/register.js",          title: "Регистрация",          guestOnly: true },
  "profile":      { file: "ui/pages/profile.js",           title: "Профиль",              auth: true },
  "create-test":  { file: "ui/pages/create-test.js",       title: "Создать тест",         auth: true, roles: STAFF },
  "quiz":         { file: "ui/pages/quiz.js",              title: "Тест",                 auth: true },
  "results":      { file: "ui/pages/results.js",           title: "Результаты",           auth: true, roles: STAFF },
  "assignments":  { file: "ui/pages/assignments.js",       title: "Задания",              auth: true },
  "student":      { file: "ui/pages/student-dashboard.js", title: "Панель студента",      auth: true },
  "teacher":      { file: "ui/pages/teacher-dashboard.js", title: "Панель преподавателя", auth: true, roles: STAFF }
};

let renderId = 0;

function message(container, text, isError) {
  container.textContent = "";
  const card = document.createElement("div");
  card.className = "card";
  const p = document.createElement("p");
  p.className = isError ? "error-msg" : "";
  p.textContent = text;
  card.appendChild(p);
  container.appendChild(card);
}

export async function router() {
  const id = ++renderId;
  const raw = (window.location.hash.slice(1) || "").replace(/^\//, "");
  const [name, ...rest] = raw.split("/");
  State.routeParam = rest.join("/");
  const route = routes[name] || routes[""];

  if (route.auth && !State.user) { window.location.hash = "#login"; return; }
  if (route.guestOnly && State.user) { window.location.hash = "#profile"; return; }

  document.title = `${route.title} — Skillbase`;
  const container = document.getElementById("app");
  if (!container) return;

  updateHeaderNav();

  if (route.roles && !route.roles.includes(State.profile?.role)) {
    message(container, "Этот раздел доступен преподавателям.", true);
    return;
  }

  try {
    message(container, "Загрузка...", false);
    const module = await import(`../${route.file}`);
    const node = await module.default();
    if (id !== renderId) return;            // пользователь уже перешёл на другую страницу
    container.textContent = "";
    container.appendChild(node);
  } catch (err) {
    console.error("Router error:", err);
    if (id === renderId) message(container, "Не удалось открыть страницу. Обновите её и попробуйте снова.", true);
  }
}

function link(href, label) {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = label;
  if (window.location.hash === href) a.setAttribute("aria-current", "page");
  return a;
}

export function updateHeaderNav() {
  const nav = document.getElementById("nav");
  if (!nav) return;
  nav.textContent = "";
  if (!State.user) {
    nav.append(link("#login", "Вход"), link("#register", "Регистрация"));
    return;
  }
  if (STAFF.includes(State.profile?.role)) {
    nav.append(link("#create-test", "Тесты"), link("#results", "Результаты"));
  }
  nav.append(link("#assignments", "Задания"), link("#profile", "Профиль"));
}

export function initRouter() {
  window.addEventListener("hashchange", router);
  if (State.profile && State.profile.ui) applyTheme(State.profile.ui);
  router();
}
