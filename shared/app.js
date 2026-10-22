import { State } from "../core/auth.js";
import { applyTheme } from "../core/auth.js";

const routes = {
  "": {
    file: "ui/pages/home.js",
    title: "Главная"
  },
  "login": {
    file: "ui/pages/login.js",
    title: "Вход"
  },
  "register": {
    file: "ui/pages/register.js",
    title: "Регистрация"
  },
  "profile": {
    file: "ui/pages/profile.js",
    title: "Профиль"
  },
  "create-test": {
    file: "ui/pages/create-test.js",
    title: "Создать тест"
  },
  "quiz": {
    file: "ui/pages/quiz.js",
    title: "Тест"
  },
  "results": {
    file: "ui/pages/results.js",
    title: "Результаты"
  },
  "assignments": {
    file: "ui/pages/assignments.js",
    title: "Задания"
  },
  "student": {
    file: "ui/pages/student-dashboard.js",
    title: "Панель студента"
  },
  "teacher": {
    file: "ui/pages/teacher-dashboard.js",
    title: "Панель преподавателя"
  }
};

export async function router() {
  const hash = (window.location.hash.slice(1) || "").replace(/^\//, "");
  const route = routes[hash] || routes[""];

  if (hash === "profile" && !State.user) {
    window.location.hash = "#login";
    return;
  }

  document.title = `${route.title} — Skillbase`;

  const appContainer = document.getElementById("app");
  if (!appContainer) return;

  try {
    appContainer.innerHTML = `<div class="card" style="text-align:center;">Загрузка...</div>`;
    const module = await import(`../${route.file}`);
    const renderFn = module.default;
    appContainer.innerHTML = "";
    appContainer.appendChild(renderFn());
  } catch (err) {
    console.error("Router error:", err);
    appContainer.innerHTML = `<div class="card"><p class="error-msg">Ошибка загрузки страницы</p></div>`;
  }

  updateHeaderNav();
}

function updateHeaderNav() {
  const nav = document.getElementById("nav");
  if (!nav) return;

  nav.innerHTML = "";
  if (State.user) {
    nav.innerHTML = `
      <a href="#profile" class="${window.location.hash === '#profile' ? 'active' : ''}">Профиль</a>
    `;
  } else {
    nav.innerHTML = `
      <a href="#login" class="${window.location.hash === '#login' ? 'active' : ''}">Вход</a>
      <a href="#register" class="${window.location.hash === '#register' ? 'active' : ''}">Регистрация</a>
    `;
  }
}

export function initRouter() {
  window.addEventListener("hashchange", router);

  if (State.profile && State.profile.ui) {
    applyTheme(State.profile.ui);
  }

  router();
}