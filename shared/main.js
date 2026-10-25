import { initAuth, subscribe, State } from "../core/auth.js";
import { initRouter, router, updateNav } from "./app.js";

async function boot() {
  try {
    await initAuth();
  } catch (e) {
    console.error("initAuth:", e);
  }
  initRouter();
  window.__booted = true;

  // Перерисовываем страницу только при смене пользователя/роли,
  // иначе сохранение профиля затирало бы форму.
  let lastKey = `${State.user?.uid}|${State.profile?.role}`;
  subscribe(() => {
    updateNav();
    const key = `${State.user?.uid}|${State.profile?.role}`;
    if (key !== lastKey) { lastKey = key; router(); }
  });
}

boot();
