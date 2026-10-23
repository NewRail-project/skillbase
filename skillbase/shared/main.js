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
});
