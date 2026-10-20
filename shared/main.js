import { initAuth, subscribe } from "../core/auth.js";
import { initRouter, router } from "./app.js";

document.addEventListener("DOMContentLoaded", async () => {
  await initAuth();
  initRouter();

  subscribe((user, profile) => {
    router();
  });
});
