export function getThemeMode() {
  try {
    return localStorage.getItem("sb-theme") || "system";
  } catch (_) {
    return "system";
  }
}

export function setThemeMode(mode) {
  try {
    localStorage.setItem("sb-theme", mode);
  } catch (_) {}
  // TODO: Записать в профиль, когда этап 3 разрешит это в Rules
  applyThemeMode(mode);
}

function applyThemeMode(mode) {
  let resolved = mode;
  if (mode === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    resolved = prefersDark ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", resolved);
}

export function initTheme() {
  const mode = getThemeMode();
  applyThemeMode(mode);

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getThemeMode() === "system") {
      applyThemeMode("system");
    }
  });
}