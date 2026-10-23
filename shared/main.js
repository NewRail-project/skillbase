import { initAuth, subscribe, State } from "../core/auth.js";
import { initRouter, router } from "./app.js";
import { renderSidebar, initSidebar, setSidebarOpen } from "../ui/components/sidebar.js";

function mountSidebar() {
  const box = document.getElementById("sidebar-container");
  if (!box) return;
  box.textContent = "";
  const loggedIn = !!State.user;
  document.body.classList.toggle("has-sidebar", loggedIn);
  if (loggedIn) box.appendChild(renderSidebar(mountSidebar));
}

document.addEventListener("DOMContentLoaded", async () => {
  initSidebar();
  await initAuth();
  initRouter();

  subscribe(() => {
    mountSidebar();
    router();
  });

  window.addEventListener("hashchange", () => {
    setSidebarOpen(false);
    mountSidebar();
  });

  // Обработчик для кнопки переключения тем
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('sb-theme', newTheme);
      window.dispatchEvent(new Event('themeChanged'));
    });
  }

  // Обработчик изменения темы
  window.addEventListener('themeChanged', () => {
    // Перезагрузить компоненты, чтобы применить новую тему
    const theme = document.documentElement.getAttribute('data-theme');
    console.log('Тема изменена на:', theme);
  });
});
