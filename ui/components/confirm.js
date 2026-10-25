import { h } from "../../shared/dom.js";
import { modal } from "./modal.js";

// Модальное подтверждение действия. Возвращает Promise<boolean>:
// true — пользователь подтвердил, false — отменил или закрыл окно.
//
// details — дополнительные элементы (например, выбор новой роли).
export function confirmAction({
  title,
  text,
  details = [],
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  tone = "primary"
} = {}) {
  return new Promise(resolve => {
    const dialog = modal();
    const previouslyFocused = document.activeElement;
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown, true);
      dialog.close();
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        try { previouslyFocused.focus(); } catch { /* элемент мог исчезнуть */ }
      }
      resolve(value);
    };

    function onKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    }

    const confirmBtn = h("button", {
      type: "button",
      class: `btn ${tone}`,
      onclick: () => finish(true)
    }, confirmLabel);

    const cancelBtn = h("button", {
      type: "button",
      class: "btn secondary",
      onclick: () => finish(false)
    }, cancelLabel);

    const content = dialog.querySelector(".modal-content");
    content.setAttribute("role", "dialog");
    content.setAttribute("aria-modal", "true");
    content.setAttribute("aria-label", title);
    content.append(
      h("h2", { style: "margin-top:0" }, title),
      text ? h("p", { class: "muted" }, text) : null,
      ...details,
      h("div", { class: "btn-row" }, confirmBtn, cancelBtn)
    );

    // Крестик и клик по фону тоже означают отмену.
    const closeBtn = dialog.querySelector(".modal-close");
    if (closeBtn) {
      closeBtn.setAttribute("aria-label", "Закрыть");
      closeBtn.onclick = () => finish(false);
    }
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) finish(false);
    });

    document.addEventListener("keydown", onKeydown, true);
    dialog.show();
    confirmBtn.focus();
  });
}

// Совместимость с прежним API: confirm({ text, actionText, cancelText,
// onConfirm, onCancel }). Новые вызовы используют confirmAction().
export function confirm({
  text = "Вы уверены?",
  actionText = "Да",
  cancelText = "Нет",
  onConfirm,
  onCancel
} = {}) {
  confirmAction({
    title: text,
    confirmLabel: actionText,
    cancelLabel: cancelText
  }).then((ok) => {
    if (ok) {
      if (typeof onConfirm === "function") onConfirm();
    } else if (typeof onCancel === "function") {
      onCancel();
    }
  });
}
