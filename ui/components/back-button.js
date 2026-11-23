// ui/components/back-button.js — кнопка «Назад» в верхней панели.
// Возвращает на экран, с которого пользователь пришёл. Стек ведётся по
// смене хеша: возврат на предыдущий адрес — шаг назад по стеку, любой другой
// переход — новая запись. Если пришли не из приложения (прямая ссылка,
// обновление страницы) и вернуться некуда, кнопка ведёт на главную.
// Скрыта на главной и на полноэкранных режимах, у которых есть своя
// кнопка «Вернуться».

const HIDDEN_ROUTES = new Set(["", "/", "login", "register", "join"]);
let stack = [];

// Чистая логика стека (тестируется отдельно).
export function pushRoute(list, hash) {
  if (list[list.length - 1] === hash) return list;
  if (list.length >= 2 && list[list.length - 2] === hash) return list.slice(0, -1);
  return [...list, hash].slice(-50);
}

export function backVisible(hash) {
  const raw = String(hash || "").replace(/^#\/?/, "");
  const [name, , third] = raw.split("/");
  if (HIDDEN_ROUTES.has(name || "")) return false;
  if (name === "room" && third === "screen") return false;
  return true;
}

function ensureButton() {
  let btn = document.getElementById("back-button");
  if (btn) return btn;
  const bar = document.querySelector(".topbar");
  if (!bar) return null;
  btn = document.createElement("button");
  btn.id = "back-button";
  btn.type = "button";
  btn.className = "back-button";
  btn.setAttribute("aria-label", "Назад на предыдущую страницу");
  // «←» всегда виден; слово «Назад» прячется на узком экране (components.css).
  const arrow = document.createElement("span");
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "←";
  const word = document.createElement("span");
  word.className = "back-text";
  word.textContent = " Назад";
  btn.append(arrow, word);
  btn.hidden = true;
  btn.addEventListener("click", () => {
    if (stack.length > 1) window.history.back();
    else window.location.hash = "#/";
  });
  const brand = bar.querySelector(".brand");
  bar.insertBefore(btn, brand || bar.firstChild);
  return btn;
}

// Вызывается роутером при каждой смене маршрута.
export function trackRoute(hash = window.location.hash) {
  stack = pushRoute(stack, hash || "#/");
  const btn = ensureButton();
  if (btn) btn.hidden = !backVisible(hash);
}
