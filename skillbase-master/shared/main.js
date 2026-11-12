import { initAuth, subscribe, State } from '../core/auth.js';
import { initRouter, router } from './app.js';
import { renderSidebar, initSidebar, setSidebarOpen } from '../ui/components/sidebar.js';
import { initTheme, toggleTheme, getTheme, subscribeTheme } from './theme.js';
import { icons } from './icons.js';

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
  btn.addEventListener("click", () => toggleTheme());
  paintThemeButton();
  subscribeTheme(() => {
    paintThemeButton();
    // Боковая панель показывает название текущей темы — перерисовываем её.
    mountSidebar();
  });
}

// Перерисовываем страницу только при смене пользователя или данных профиля.
// Смена темы и скина применяется к уже отрисованной странице через CSS.
function renderKey() {
  const p = State.profile || {};
  return [State.user?.uid || "guest", State.profileStatus, p.fullName || "", p.position || "", p.department || ""].join("|");
}

document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  initThemeToggle();
  initSidebar();
  // Если Firestore не отвечает, не оставляем пустой экран: через 8 с
  // запускаем роутер, а профиль дозагрузится сам.
  await Promise.race([
    initAuth(),
    new Promise(resolve => setTimeout(resolve, 8000))
  ]);

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

  document.body.classList.add("ready");
});
