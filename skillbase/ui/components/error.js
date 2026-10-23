export function error({ text = "Произошла ошибка", retryText = "Повторить", onRetry } = {}) {
  const div = document.createElement("div");
  div.className = "error-state";
  div.style.cssText = "text-align:center;padding:32px 16px;";
  
  const msg = document.createElement("p");
  msg.className = "error-msg";
  msg.textContent = text;
  
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn primary";
  btn.textContent = retryText;
  btn.addEventListener("click", onRetry || (() => window.location.reload()));
  
  div.appendChild(msg);
  div.appendChild(btn);
  
  return div;
}
