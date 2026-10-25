export function confirm({ text = "Вы уверены?", actionText = "Да", cancelText = "Нет", onConfirm, onCancel } = {}) {
  const dialog = document.createElement("dialog");
  dialog.className = "confirm-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "confirm-title");
  dialog.setAttribute("aria-describedby", "confirm-description");
  
  const content = document.createElement("div");
  content.className = "confirm-content";
  content.style.cssText = "padding:24px;max-width:400px;margin:0 auto;";
  
  const title = document.createElement("h3");
  title.id = "confirm-title";
  title.textContent = text;
  
  const btnRow = document.createElement("div");
  btnRow.className = "btn-row";
  btnRow.style.marginTop = "24px";
  
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn secondary";
  cancelBtn.textContent = cancelText;
  cancelBtn.addEventListener("click", () => {
    dialog.close();
    if (typeof onCancel === "function") onCancel();
  });
  
  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "btn primary";
  confirmBtn.textContent = actionText;
  confirmBtn.addEventListener("click", () => {
    dialog.close();
    if (typeof onConfirm === "function") onConfirm();
  });
  
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(confirmBtn);
  
  content.appendChild(title);
  content.appendChild(btnRow);
  dialog.appendChild(content);
  
  // Focus trap
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      dialog.close();
      if (typeof onCancel === "function") onCancel();
    }
  });
  
  // Show dialog
  dialog.showModal();
  
  return dialog;
}
