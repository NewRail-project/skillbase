// shared/app.js — роутер.
//
// Контракт страницы (R8):
//   export default function PageName() { ... }  // может быть async, возвращает HTMLElement
//   export function cleanup() { ... }         // (опционально) очистка: onSnapshot, таймеры, слушатели window
//
// Маршруты: хэш-роутинг. Параметры после слэша: #quiz/<assignmentId>, #test/<id>, #join/<code>, #results/<testId>.
// 404: ui/pages/404.js. Очистка страницы при уходе. Один вызов router() при старте.

import { State, applyTheme, logout } from "../core/auth.js";
import { initMode, subscribeMode } from "../core/mode.js";
import { t } from "../core/i18n.js";
import { liveText } from "./live.js";
import { profileSetupIncomplete } from "../core/registration.js";
import { saveReturnTo, consumeReturnTo } from "./return-to.js";
import { skeleton } from "../ui/components/skeleton.js";

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
  "":             { file: "ui/pages/home.js",              title: "Главная",              tkey: "title.home" },
  "login":        { file: "ui/pages/login.js",             title: "Вход",                 guestOnly: true },
  "register":     { file: "ui/pages/register.js",          title: "Регистрация",          guestOnly: true },
  // Гостевое прохождение теста по прямой ссылке: ФИО вместо регистрации.
  // Страница сама разбирается с вошедшими (аккаунт ≠ гость) пользователями.
  "guest":        { file: "ui/pages/guest-start.js",       title: "Гостевой тест",         tkey: "title.guest" },
  // Первоначальная настройка профиля после первого входа через Google.
  "setup":        { file: "ui/pages/setup-profile.js",     title: "Настройка профиля",    auth: true },
  "profile":      { file: "ui/pages/profile.js",           title: "Профиль",              auth: true },
  "tests":        { file: "ui/pages/tests.js",             title: "Каталог тестов",       tkey: "title.tests",       auth: true },
  "create-test":  { file: "ui/pages/create-test.js",       title: "Создать тест",         tkey: "title.create",      auth: true, roles: STAFF },
  "quiz":         { file: "ui/pages/quiz.js",              title: "Тест",                 tkey: "title.quiz",        auth: true, guest: true },
  // Пробное прохождение: преподаватель проходит собственный тест как
  // студент. Попытка живёт только в памяти клиента — в Firestore ничего
  // не пишется, в результаты и аналитику пробная попытка не попадает.
  "trial":        { file: "ui/pages/quiz.js",              title: "Пробное прохождение",  tkey: "title.trial",       auth: true, roles: STAFF },
  "launch":       { file: "ui/pages/launch.js",            title: "Как провести тест",    tkey: "title.launch",      auth: true, roles: STAFF },
  "join":         { file: "ui/pages/join.js",              title: "Вход по коду" },
  "about":        { file: "ui/pages/about.js",             title: "О проекте" },
  // guest: маршрут открыт анонимному гостю (участие в live-комнате —
  // единственная гостевая функция; остальное требует регистрации).
  "room":         { file: "ui/pages/room.js",              title: "Live-комната",         auth: true, guest: true },
  "material":     { file: "ui/pages/material.js",          title: "Материал",             tkey: "title.material",    auth: true },
  "results":      { file: "ui/pages/results.js",           title: "Результаты",           tkey: "title.results",     auth: true, roles: STAFF },
  "analytics":    { file: "ui/pages/analytics.js",         title: "Аналитика по тесту",   tkey: "title.analytics",   auth: true, roles: STAFF },
  "review":       { file: "ui/pages/review.js",            title: "Проверка попытки",     auth: true, roles: STAFF },
  "assignments":  { file: "ui/pages/assignments.js",       title: "Задания",              tkey: "title.assignments", auth: true },
  "student":      { file: "ui/pages/student-dashboard.js", title: "Панель студента",      tkey: "title.student",     auth: true },
  "teacher":      { file: "ui/pages/teacher-dashboard.js", title: "Панель преподавателя", tkey: "title.teacher",     auth: true, roles: STAFF },
  "users":        { file: "ui/pages/users.js",             title: "Пользователи",         tkey: "title.users",       auth: true, roles: STAFF },
  "admins":       { file: "ui/pages/admins.js",            title: "Администраторы",       auth: true, roles: ADMIN },
  "settings":     { file: "ui/pages/settings.js",          title: "Настройки",            auth: true },
  "admin":        { file: "ui/pages/admin-panel.js",       title: "Админ-панель",         auth: true, roles: STAFF }
};

let renderId = 0;

// Заголовок вкладки следует за режимом: «Каталог тестов» ↔ «Проверка знаний».
let currentTitle = null;
function paintDocumentTitle() {
  if (!currentTitle) return;
  const name = currentTitle.tkey ? t(currentTitle.tkey) : currentTitle.title;
  document.title = `${name} — Skillbase`;
}
let currentCleanup = null;

function message(container, text, isError) {
  container.textContent = "";
  const card = document.createElement("div");
  card.className = "card";
  const p = document.createElement("p");
  p.className = isError ? "error-msg" : "";
  // text — строка или функция (живой текст: следует за режимом Education/Workforce).
  if (typeof text === "function") p.appendChild(liveText(text));
  else p.textContent = text;
  card.appendChild(p);
  container.appendChild(card);
}

// Индикатор навигации: пока готовится новая страница, старая остаётся на
// экране (пустого промежутка нет). Глобальный спиннер из index.html
// включается, только если подготовка затянулась — модуль не в кэше или
// страница ждёт данные. Порог 250 мс ничего не задерживает: готовая
// страница заменяет старую сразу, как только она получена.
let navSpinnerTimer = null;

function hideNavSpinner() {
  if (navSpinnerTimer) { clearTimeout(navSpinnerTimer); navSpinnerTimer = null; }
  const spinner = document.getElementById("loading-spinner");
  if (spinner) spinner.style.display = "none";
  const app = document.getElementById("app");
  if (app) app.style.pointerEvents = "";
}

function armNavSpinner(id) {
  hideNavSpinner();
  navSpinnerTimer = setTimeout(() => {
    navSpinnerTimer = null;
    if (id !== renderId) return;
    const spinner = document.getElementById("loading-spinner");
    if (spinner) spinner.style.display = "flex";
  }, 250);
}

// Маршрут последней успешной отрисовки: повторный рендер того же адреса
// (переподключение Live-комнаты, «Повторить» после ошибки) входит без
// стартовой анимации — иначе элементы мигают из opacity:0.
let lastRenderedRoute = null;

// Загрузка модуля страницы с одним обходом устаревшего кэша.
// После публикации Service Worker может отдать прежнюю копию модуля, чьи
// внутренние импорты уже не совпадают с новым кодом, — такой import() падает.
// Повторная попытка с уникальным параметром гарантированно обходит и кэш SW,
// и HTTP-кэш (совпадение в кэше учитывает query). Цикла перезагрузок нет:
// в рамках одной навигации не более двух попыток, location.reload не вызывается.
async function importPageModule(file) {
  try {
    return await import(`../${file}`);
  } catch (firstError) {
    console.warn(`Импорт ${file} не удался, повторяю с обходом кэша:`, firstError);
    return import(`../${file}?retry=${Date.now()}`);
  }
}

export async function router() {
  const id = ++renderId;
  const raw = (window.location.hash.slice(1) || "").replace(/^\//, "");
  const [name, ...rest] = raw.split("/");
  State.routeParam = rest.join("/");
  // Имя маршрута доступно страницам: quiz.js различает #quiz/<id> и
  // #trial/<id> (один файл, два режима).
  State.route = name;
  const route = routes[name];

  // Уходим со старой страницы сразу, ещё до редиректов и проверки ролей:
  // иначе таймеры и автосохранение прохождения остались бы работать.
  if (currentCleanup) {
    try { currentCleanup(); } catch (e) { console.error("cleanup error:", e); }
    currentCleanup = null;
  }
  // Прошлая навигация могла оставить спиннер и блокировку ввода — снимаем
  // до любых проверок, чтобы ранние выходы (страж, редиректы, скелет)
  // не оставляли интерфейс заблокированным.
  hideNavSpinner();

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

  // Сессия ещё не восстановлена (idle) или профиль ещё читается (loading):
  // показываем скелет вместо страницы. Гостевой интерфейс не мелькает у
  // авторизованного пользователя, защищённые страницы не открываются до
  // подтверждения входа, а проверка ролей не видит null-профиль и не
  // мигает ошибкой доступа. Когда данные придут, подписка в main.js
  // перерисует страницу (renderKey изменится).
  if (State.profileStatus === "idle" || State.profileStatus === "loading") {
    const container = document.getElementById("app");
    if (container) {
      container.textContent = "";
      container.appendChild(skeleton());
    }
    return;
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

  // Незавершённый профиль (документа нет или ФИО пустое — типично для
  // первого входа через Google): сначала настройка, основному интерфейсу
  // проход закрыт. Гостям настройка не нужна; сам экран #setup не
  // перенаправляем — иначе цикл. После завершения setup вернёт на
  // сохранённый маршрут (consumeReturnTo), поэтому приглашение не теряется.
  if (route && route.auth && name !== "setup"
      && State.user?.isAnonymous !== true && State.profileStatus !== "error"
      && profileSetupIncomplete(
        State.profileStatus,
        State.profile,
        State.user?.isAnonymous === true)) {
    saveReturnTo(window.location.hash || "#/");
    window.location.hash = "#setup";
    return;
  }

  const target = route || { file: "ui/pages/404.js", title: "Не найдено" };
  currentTitle = target;
  paintDocumentTitle();

  const container = document.getElementById("app");
  if (!container) return;

  // Гостевой режим: анонимный пользователь допущен только к прохождению
  // теста по прямой ссылке (guest: true) и к входу в live-комнату по коду
  // (маршруты без auth). Задания, каталог, профиль и прочее требуют
  // полноценной регистрации. Скрытие интерфейса — удобство; защиту данных
  // по-прежнему несут правила Firestore.
  if (route && route.auth && State.user?.isAnonymous && !route.guest) {
    updateHeaderNav();
    message(container,
      "Гостевой режим: доступно прохождение теста по прямой ссылке и вход в Live-комнату по коду. "
      + "Задания, каталог, результаты и профиль доступны после полноценной регистрации.",
      false);
    return;
  }

  updateHeaderNav();

  if (target.roles && !target.roles.includes(State.profile?.role)) {
    const onlyAdmins = target.roles.length === 1 && target.roles[0] === "admin";
    message(container, onlyAdmins
      ? "Этот раздел доступен только администраторам."
      : () => t("sys.teachersOnly"), true);
    return;
  }

  try {
    // Старая страница остаётся видимой, пока готовится новая, но неактивной:
    // её cleanup уже выполнен, обработчики не должны срабатывать под ноги
    // навигации. Спиннер включается только при затянувшейся подготовке.
    container.setAttribute("aria-busy", "true");
    container.style.pointerEvents = "none";
    armNavSpinner(id);
    // Импорт отделён от выполнения страницы: у «модуль не загрузился» и
    // «страница упала» разные причины, и пользователю нужны разные подсказки.
    let module;
    try {
      module = await importPageModule(target.file);
    } catch (importError) {
      throw Object.assign(
        new Error(`Не удалось загрузить модуль страницы ${target.file}`),
        { code: "page-import-failed", cause: importError }
      );
    }
    if (typeof module.default !== "function") {
      throw Object.assign(
        new Error(`Модуль ${target.file} не экспортирует функцию по умолчанию`),
        { code: "page-no-default" }
      );
    }
    // Страница не должна висеть на «Загрузке» вечно: при зависшем запросе
    // к Firestore показываем причину и кнопку повтора.
    let timer;
    const node = await Promise.race([
      module.default(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "page-timeout" })), 20000);
      })
    ]).finally(() => clearTimeout(timer));
    if (id !== renderId) return;
    if (typeof module.cleanup === "function") currentCleanup = module.cleanup;
    hideNavSpinner();
    container.removeAttribute("aria-busy");
    // Атомарная замена: новое содержимое уже готово, старое убирается в
    // тот же момент — старая и новая страницы не сосуществуют.
    const routeChanged = raw !== lastRenderedRoute;
    container.classList.toggle("no-anim", !routeChanged);
    container.textContent = "";
    container.appendChild(node);
    lastRenderedRoute = raw;
    // Старая страница держала высоту документа до самой замены, поэтому
    // при смене маршрута прокрутку возвращаем наверх явно. Повторный рендер
    // той же страницы (переподключение Live-комнаты) позицию не сбрасывает.
    if (routeChanged) window.scrollTo(0, 0);
  } catch (err) {
    // Диагностика: маршрут и модуль — в сообщении, исходная ошибка — в cause.
    // Пароли, токены и содержимое документов сюда не попадают: логируются
    // только объект ошибки и имя файла модуля.
    console.error(`Ошибка роутера: маршрут #${raw || "(пусто)"}, модуль ${target.file}:`, err);
    if (err?.cause) console.error("Исходная причина:", err.cause);
    if (id === renderId) {
      hideNavSpinner();
      container.removeAttribute("aria-busy");
      const text = err?.code === "page-timeout"
        ? "Сервер не ответил за 20 секунд. Проверьте интернет и правила Firestore (консоль браузера, F12)."
        : err?.code === "page-import-failed"
          ? "Не удалось загрузить код страницы. Обновите страницу; если не поможет — обновите кэш сайта (настройки браузера)."
          : err?.code === "permission-denied"
            ? "Правила Firestore не разрешили это действие (permission-denied)."
            : "Не удалось открыть страницу. Обновите её и попробуйте снова.";
      message(container, text, true);
      const retry = document.createElement("button");
      retry.className = "btn";
      retry.textContent = "Повторить";
      retry.addEventListener("click", () => router());
      container.firstChild?.appendChild(retry);
    }
  }
}

function link(href, label) {
  const a = document.createElement("a");
  a.href = href;
  // label — строка или функция (живой текст для режима Education/Workforce).
  if (typeof label === "function") a.appendChild(liveText(label));
  else a.textContent = label;
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
  // Анонимный гость: только вход в комнату по коду и выход.
  if (State.user.isAnonymous) {
    nav.append(link("#join", "Войти в комнату"));
    const out = link("#login", "Выйти");
    out.addEventListener("click", (event) => {
      event.preventDefault();
      logout().then(() => { window.location.hash = "#login"; })
        .catch(err => console.error("Выход гостя:", err));
    });
    nav.append(out);
    return;
  }
  if (STAFF.includes(State.profile?.role)) {
    nav.append(link("#create-test", () => t("nav.testsStaff")), link("#results", () => t("nav.results")), link("#analytics", () => t("nav.analytics")));
  }
  if (State.profile?.role === "admin") {
    nav.append(link("#admins", "Администраторы"));
  }
  nav.append(link("#assignments", () => t("nav.assignments")), link("#profile", () => t("nav.profile")));
}

export function initRouter() {
  if (initRouter._started) return;
  initRouter._started = true;
  window.addEventListener("hashchange", router);
  initMode();
  // Смена режима: обновляем заголовок вкладки; страница не перерисовывается.
  subscribeMode(() => paintDocumentTitle());
  if (State.profile?.ui) applyTheme(State.profile.ui);
  router();
}
