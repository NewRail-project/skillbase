import { h } from "../../shared/dom.js";

export function modal() {
  const modalDiv = h("div", { class: "modal-overlay" });
  const modalContent = h("div", { class: "modal-content" });
  const modalClose = h("button", { class: "modal-close", onclick: () => modalDiv.close() }, "×");
  
  modalDiv.appendChild(modalContent);
  modalContent.appendChild(modalClose);
  
  function show() {
    document.body.appendChild(modalDiv);
    modalDiv.style.display = "flex";
    modalDiv.style.zIndex = "2000";
  }
  
  function close() {
    modalDiv.style.display = "none";
    document.body.removeChild(modalDiv);
  }
  
  modalDiv.show = show;
  modalDiv.close = close;
  return modalDiv;
}