import { h } from "../../shared/dom.js";

export function toast(message, type) {
  const toastDiv = h("div", { class: `toast ${type}` },
    h("div", {}, message)
  );
  document.body.appendChild(toastDiv);
  
  setTimeout(() => {
    toastDiv.remove();
  }, 4000);
}