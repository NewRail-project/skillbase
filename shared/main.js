import { initAuth, subscribe, State } from '../core/auth.js';
import { initRouter, router } from './app.js';
import { renderSidebar, initSidebar, setSidebarOpen } from '../ui/components/sidebar.js';
import { getThemeMode, setThemeMode, getThemeVariables } from './theme.js';

function mountSidebar() {
  const box = document.getElementById("sidebar-container");
  if (!box) return;
  box.textContent = "";
  const loggedIn = !!State.user;
  document.body.classList.toggle("has-sidebar", loggedIn);
  if (loggedIn) box.appendChild(renderSidebar(mountSidebar));
}

document.addEventListener('DOMContentLoaded', async () => {
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

  // Обработка изменения темы
  window.addEventListener('themeChanged', () => {
    const theme = document.documentElement.getAttribute('data-theme');
    const themeVariables = getThemeVariables(theme);
    const allComponents = document.querySelectorAll('[data-theme]');
    allComponents.forEach(component => {
      Object.entries(themeVariables).forEach(([key, value]) => {
        component.style.setProperty(key, value);
      });
    });
  });
});
