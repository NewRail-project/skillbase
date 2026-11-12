// Возврат к исходной ссылке после входа или регистрации.
//
// Ссылку на тест (#quiz/<id>) или задание сохраняет роутер, когда отправляет
// неавторизованного пользователя на #login. После успешного входа или
// регистрации страница забирает сохранённое значение и возвращает туда же.
//
// sessionStorage может быть недоступен (приватный режим, Node-тесты) —
// тогда функции просто не сохраняют ссылку, а приложение работает как обычно.

const KEY = "sb:returnTo";

// Приводит значение к виду "#route/param". Пустая строка — не ссылка.
export function normalizeHash(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

// Служебные страницы входа не должны становиться точкой возврата:
// иначе после входа пользователь попадёт обратно на форму.
export function isReturnableHash(value) {
  const hash = normalizeHash(value);
  if (!hash) return false;
  const raw = hash.slice(1).replace(/^\//, "");
  const name = raw.split(/[/?]/)[0];
  if (!name) return false;
  return name !== "login" && name !== "register";
}

export function safeReturnTo(value, fallback = "#/") {
  return isReturnableHash(value) ? normalizeHash(value) : fallback;
}

export function saveReturnTo(value) {
  const hash = normalizeHash(value);
  if (!isReturnableHash(hash)) return false;
  try {
    sessionStorage.setItem(KEY, hash);
    return true;
  } catch {
    return false;
  }
}

export function peekReturnTo() {
  try {
    return sessionStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
}

export function clearReturnTo() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // sessionStorage недоступен — очищать нечего.
  }
}

// Забирает сохранённую ссылку и удаляет её, чтобы возврат не повторился
// при следующем входе.
export function consumeReturnTo(fallback = "#/") {
  const saved = peekReturnTo();
  clearReturnTo();
  return safeReturnTo(saved, fallback);
}
