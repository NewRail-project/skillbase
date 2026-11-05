// shared/load-css.js — точечная догрузка некритичных стилей.
//
// Тяжёлые CSS (live.css, reactions.css) нужны только отдельным маршрутам,
// поэтому они не подключены в index.html и не блокируют первую отрисовку.
// Страница вызывает loadCss() до построения DOM — стили гарантированно
// применятся к её разметке. Повторные вызовы и повторные переходы на страницу
// не создают дублирующих <link>: загрузка кэшируется, а уже подключённый
// файл распознаётся по href.
//
// Версия ресурса берётся из URL входного скрипта main.js (?v=...), который
// обновляется централизованно скриптом scripts/bump-version.mjs — ручные
// версии в каждом вызове не нужны.

const loaded = new Map();

function assetVersion() {
  const src = document.querySelector('script[src*="shared/main.js"]')?.src || "";
  const match = src.match(/[?&]v=([^&]+)/);
  return match ? `?v=${match[1]}` : "";
}

export function loadCss(path) {
  if (!loaded.has(path)) {
    loaded.set(path, new Promise((resolve) => {
      // Уже подключён (в прошлом переходе или вручную) — ничего не делаем.
      if (document.querySelector(`link[rel="stylesheet"][href*="${path}"]`)) {
        resolve();
        return;
      }
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = path + assetVersion();
      // Ошибка загрузки не должна ломать страницу: стили — улучшение,
      // а не условие работы.
      link.onload = () => resolve();
      link.onerror = () => resolve();
      document.head.appendChild(link);
    }));
  }
  return loaded.get(path);
}
