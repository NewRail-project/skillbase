import { iconHTML } from "../icons.js";

export function empty({ icon: iconName = "empty", text = "Ничего не найдено", actionText, onAction } = {}) {
  const div = document.createElement("div");
  div.className = "empty-state";
  div.style.cssText = "text-align:center;padding:32px 16px;color:var(--text-2);";
  
  const iconWrapper = document.createElement("div");
  iconWrapper.style.cssText = "margin-bottom:12px;color:var(--text-2);";
  iconWrapper.innerHTML = iconHTML(iconName);
  
  const msg = document.createElement("p");
  msg.textContent = text;
  
  div.appendChild(iconWrapper);
  div.appendChild(msg);

  if (actionText && typeof onAction === "function") {
    const btnRow = document.createElement("div");
    btnRow.className = "btn-row";
    btnRow.style.marginTop = "16px";
    
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn secondary";
    btn.textContent = actionText;
    btn.addEventListener("click", onAction);
    
    btnRow.appendChild(btn);
    div.appendChild(btnRow);
  }

  return div;
}
