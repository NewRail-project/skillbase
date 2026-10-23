export function error({ text = "Произошла ошибка", retryText = "Повторить", onRetry } = {}) {
  const div = document.createElement("div");
  div.className = "error-state";
  div.style.cssText = "text-align:center;padding:32px 16px;";
  
  const msg = document.createElement("p");
  msg.className = "error-msg";
  msg.textContent = text;
  
  div.appendChild(msg);

  // Повтор только там, где есть что повторять. Перезагрузка страницы —
  // не «исправление» ошибки, поэтому действием по умолчанию она не является.
  if (typeof onRetry === "function") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn secondary";
    btn.textContent = retryText;
    btn.addEventListener("click", onRetry);
    div.appendChild(btn);
  } else {
    const hint = document.createElement("p");
    hint.className = "muted";
    hint.textContent = "Обновите страницу, если ошибка повторяется.";
    div.appendChild(hint);
  }

  return div;
}
