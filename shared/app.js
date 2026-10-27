// shared/app.js — роутер.
//
// Контракт страницы (R8):
//   export default function PageName() { ... }  // может быть async, возвращает HTMLElement
//   export function cleanup() { ... }         // (опционально) очистка: onSnapshot, таймеры, слушатели window
//
// Маршруты: хэш-роутинг. Параметры после слэша: #quiz/<assignmentId>, #test/<id>, #join/<code>, #results/<testId>.
// 404: ui/pages/404.js. Очистка страницы при уходе. Один вызов router() при старте.

import { State, applyTheme } from "../core/auth.js";
import { saveReturnTo, consumeReturnTo } from "./return-to.js";

// Хеш-страж: пока открыта читалка материала, hashchange откатывается,
// кроме разрешённых (страж следит и хранит последний легальный хеш).
let hashGuard = null;
let guardHash = "#/";

// Страница устанавливает страж: fn(nextHash) → boolean разрешить уход.
// بدون стража роутер работает как раньше. Страж снимается через setHashGuard(null).
export function setHashGuard(fn) {
  hashGuard = fn;
  if (fn) guardHash = window.location.hash;
}

// Разрешённый выход из-под стража (кнопка «К тесту» в читалке).
export function leaveWithHash(nextHash) {
  hashGuard = null;
  guardHash = nextHash;
  window.location.hash = nextHash;
}

const STAFF = ["teacher", "admin"];
const ADMIN = ["admin"];

const routes = {
  "":             { file: "ui/pages/home.js",              title: "Главная" },
  "login":        { file: "ui/pages/login.js",             title: "Вход",                 guestOnly: true },
  "register":     { file: "ui/pages/register.js",          title: "Регистрация",          guestOnly: true },
  "profile":      { file: "ui/pages/profile.js",           title: "Профиль",              auth: true },
  "tests":        { file: "ui/pages/tests.js",             title: "Каталог тестов",       auth: true },
  "create-test":  { file: "ui/pages/create-test.js",       title: "Создать тест",         auth: true, roles: STAFF },
  "quiz":         { file: "ui/pages/quiz.js",              title: "Тест",                 auth: true },
  "launch":       { file: "ui/pages/launch.js",            title: "Как провести тест",    auth: true, roles: STAFF },
  "join":         { file: "ui/pages/join.js",              title: "Вход по коду",         auth: true },
  "room":         { file: "ui/pages/room.js",              title: "Live-комната",         auth: true },
  "material":     { file: "ui/pages/material.js",          title: "Материал",             auth: true },
  "results":      { file: "ui/pages/results.js",           title: "Результаты",           auth: true, roles: STAFF },
  "analytics":    { file: "ui/pages/analytics.js",         title: "Аналитика по тесту",   auth: true, roles: STAFF },
  "review":       { file: "ui/pages/review.js",            title: "Проверка попытки",     auth: true, roles: STAFF },
  "assignments":  { file: "ui/pages/assignments.js",       title: "Задания",              auth: true },
  "student":      { file: "ui/pages/student-dashboard.js", title: "Панель студента",      auth: true },
  "teacher":      { file: "ui/pages/teacher-dashboard.js", title: "Панель преподавателя", auth: true, roles: STAFF },
  "users":        { file: "ui/pages/users.js",             title: "Пользователи",         auth: true, roles: STAFF },
  "admins":       { file: "ui/pages/admins.js",            title: "Администраторы",       auth: true, roles: ADMIN },
  "settings":     { file: "ui/pages/settings.js",          title: "Настройки",            auth: true },
  "admin":        { file: "ui/pages/admin-panel.js",       title: "Админ-панель",         auth: true, roles: STAFF }
};

let renderId = 0;
let currentCleanup = null;

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
  const route = routes[name];

  // Уходим со старой страницы сразу, ещё до редиректов и проверки ролей:
  // иначе таймеры и автосохранение прохождения остались бы работать.
  if (currentCleanup) {
    try { currentCleanup(); } catch (e) { console.error("cleanup error:", e); }
    currentCleanup = null;
  }

  // Хеш-страж: страница (например, читалка материала) может запретить
  // уход по hashchange, пока не завершит работу. Страж возвращает false,
  // если смену хеша нужно откатить; страницы-exit вызывают разрешённый
  // переход сами, снимая страж.
  if (hashGuard) {
    const allowed = hashGuard(window.location.hash);
    if (!allowed) {
      if (guardHash != null) window.location.hash = guardHash;
      return;
    }
    guardHash = window.location.hash;
  }

  if (route && route.auth && !State.user) {
    const next = window.location.hash || "#/";
    saveReturnTo(next);
    window.location.hash = "#login";
    return;
  }
  
  // Если пользователь авторизован, но профиль еще загружается,
  // не перенаправляем на логин - ждем загрузки профиля
  if (route && route.auth && State.user && !State.profile && !State.initialProfileLoad) {
    return;
  }

  // Уже вошедшего пользователя не держим на форме входа: если он пришёл по
  // ссылке на тест, возвращаем его туда.
  if (route && route.guestOnly && State.user) {
    window.location.hash = consumeReturnTo("#/");
    return;
  }

  // Если пользователь авторизован, но профиль еще загружается,
  // не показываем гостевые страницы - ждем загрузки профиля
  if (route && route.guestOnly && State.user && !State.profile && !State.initialProfileLoad) {
    return;
  }

  const target = route || { file: "ui/pages/404.js", title: "Не найдено" };
  document.title = `${target.title} — Skillbase`;

  const container = document.getElementById("app");
  if (!container) return;

  updateHeaderNav();

  if (target.roles && !target.roles.includes(State.profile?.role)) {
    const onlyAdmins = target.roles.length === 1 && target.roles[0] === "admin";
    message(container, onlyAdmins
      ? "Этот раздел доступен только администраторам."
      : "Этот раздел доступен преподавателям.", true);
    return;
  }

  try {
    message(container, "Загрузка...", false);
    const module = await import(`../${target.file}`);
    const node = await module.default();
    if (id !== renderId) return;
    if (typeof module.cleanup === "function") currentCleanup = module.cleanup;
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
    nav.append(link("#create-test", "Тесты"), link("#results", "Результаты"), link("#analytics", "Аналитика"));
  }
  if (State.profile?.role === "admin") {
    nav.append(link("#admins", "Администраторы"));
  }
  nav.append(link("#assignments", "Задания"), link("#profile", "Профиль"));
}

export function initRouter() {
  if (initRouter._started) return;
  initRouter._started = true;
  window.addEventListener("hashchange", router);
  if (State.profile?.ui) applyTheme(State.profile.ui);
  router();
}
