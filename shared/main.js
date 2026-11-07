import { initAuth, subscribe, State } from '../core/auth.js';
import { initRouter, router } from './app.js';
import { renderSidebar, initSidebar, setSidebarOpen } from '../ui/components/sidebar.js';
import { initTheme, toggleTheme, getTheme, subscribeTheme } from './theme.js';
import { icons } from './icons.js';
import { skinSwitch } from '../ui/components/skin-switch.js';

function mountSidebar() {
  const box = document.getElementById("sidebar-container");
  if (!box) return;
  box.textContent = "";
  const loggedIn = !!State.user;
  document.body.classList.toggle("has-sidebar", loggedIn);
  if (loggedIn) box.appendChild(renderSidebar(mountSidebar));
}

// Кнопка темы в шапке: иконка и подпись отражают фактическое состояние.
function paintThemeButton() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  const theme = getTheme();
  const next = theme === "dark" ? "светлую" : "тёмную";
  btn.innerHTML = theme === "dark" ? icons.sun : icons.moon;
  btn.setAttribute("aria-label", `Включить ${next} тему`);
  btn.setAttribute("title", `Включить ${next} тему`);
  btn.dataset.theme = theme;
}

function initThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  // Переключатель скина слева от кнопки темы: доступен и гостю.
  if (!document.getElementById("skin-switch-top")) {
    const sw = skinSwitch({ className: "skin-switch-top" });
    sw.id = "skin-switch-top";
    btn.before(sw);
  }
  btn.addEventListener("click", () => toggleTheme());
  paintThemeButton();
  subscribeTheme(() => {
    paintThemeButton();
    // Боковая панель показывает название текущей темы — перерисовываем её.
    mountSidebar();
  });
}

// Перерисовываем страницу только при смене пользователя или статуса профиля.
// Промежуточный "loading" схлопнут с "idle": скелет уже на экране, лишний
// проход роутера между ними только мигает. Обычные поля профиля (ФИО,
// должность, отдел) в ключе не участвуют: их сохранение не должно
// перерисовывать всю страницу — имя и аватар в боковой панели обновляет
// mountSidebar() при каждом notify, а форма профиля уже содержит введённое.
// Смена темы и скина применяется к уже отрисованной странице через CSS.
function renderKey() {
  const status = State.profileStatus === "loading" ? "idle" : State.profileStatus;
  return [State.user?.uid || "guest", status].join("|");
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initThemeToggle();
  initSidebar();

  // Роутер стартует немедленно, не дожидаясь Firebase: пока сессия не
  // восстановлена, он показывает скелет (idle-проверка в app.js), поэтому
  // ни гостевой интерфейс, ни защищённые страницы не мелькают, а публичные
  // страницы не ждут Firestore. Восстановление сессии идёт в фоне.
  initAuth();

  let key = renderKey();
  initRouter(); // вешает обработчик hashchange и рисует первую страницу

  subscribe(() => {
    mountSidebar();
    const next = renderKey();
    if (next !== key) {
      key = next;
      router();
    }
  });

  window.addEventListener("hashchange", () => {
    setSidebarOpen(false);
    mountSidebar();
  });

  // Service Worker и согласованное обновление.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").then((reg) => {
        // Проверка наличия новой версии при загрузке.
        if (reg.waiting) {
          notifyUpdate(reg.waiting);
        }

        // Следим за появлением обновлений в процессе работы.
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              notifyUpdate(worker);
            }
          });
        });
      }).catch((err) => {
        console.warn("Service Worker не зарегистрирован:", err);
      });

      // Перезагружаем страницу, когда новый SW берёт управление.
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    });
  }

  document.body.classList.add("ready");
});

/**
 * Уведомление об обновлении. Не показываем во время теста или Live-комнаты,
 * чтобы не отвлекать и не прерывать процесс.
 */
function notifyUpdate(worker) {
  const hash = window.location.hash;
  const critical = hash.startsWith("#room/") || hash.startsWith("#quiz/") || hash.startsWith("#trial/");
  if (critical) {
    // Ждём смены хеша на безопасный и пробуем снова.
    const once = () => {
      const nextHash = window.location.hash;
      const stillCritical = nextHash.startsWith("#room/") || nextHash.startsWith("#quiz/") || nextHash.startsWith("#trial/");
      if (!stillCritical) {
        window.removeEventListener("hashchange", once);
        notifyUpdate(worker);
      }
    };
    window.addEventListener("hashchange", once);
    return;
  }

  // Используем confirmAction (модалка) или toast с кнопкой.
  // Пользователь просил «Понятное уведомление» и «Кнопка Перезагрузить».
  // Импортируем динамически, чтобы не раздувать main.js.
  import("../ui/components/confirm.js").then(({ confirmAction }) => {
    confirmAction({
      title: "Доступно обновление",
      text: "Skillbase обновился. Перезагрузить страницу, чтобы применить изменения?",
      confirmLabel: "Перезагрузить",
      cancelLabel: "Позже"
    }).then((ok) => {
      if (ok) {
        worker.postMessage("SKIP_WAITING");
      }
    });
  });
}
