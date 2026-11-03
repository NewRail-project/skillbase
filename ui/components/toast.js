// ui/components/toast.js — уведомления об успехе и ошибках.
//
// Единые правила для всех страниц: тип success | error | info (неизвестный
// тип показывается нейтральным), ошибки важнее — живут дольше и объявляются
// громче (role=alert), успех — politely (role=status).
import { h } from "../../shared/dom.js";

const TYPES = ["success", "error", "info"];

export function toast(message, type) {
  const kind = TYPES.includes(type) ? type : "";
  const toastDiv = h("div", {
    class: `toast ${kind}`,
    // Ошибка — тревожное объявление; успех и инфо — спокойное.
    role: type === "error" ? "alert" : "status",
    "aria-live": type === "error" ? "assertive" : "polite"
  },
    h("div", {}, message)
  );
  document.body.appendChild(toastDiv);

  setTimeout(() => {
    toastDiv.remove();
  }, type === "error" ? 6000 : 3500);
}
