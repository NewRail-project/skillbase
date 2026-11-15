// ui/components/form-dialog.js — модальная форма с полями и проверкой.
//
// formDialog({ title, text, fields, submitLabel, onSubmit, idPrefix })
//   fields: [{ key, label, value, type: "text"|"textarea"|"select"|"date",
//              maxlength, hint, options: [{ value, label }] }]
//   onSubmit(values) → строка с ошибкой (диалог остаётся открытым) или null.
// Возвращает Promise<boolean>: true — сохранено, false — отменено.
import { h } from "../../shared/dom.js";
import { modal } from "./modal.js";

export function formDialog({ title, text, fields = [], submitLabel = "Сохранить", onSubmit, idPrefix = "form" } = {}) {
  return new Promise(resolve => {
    const dialog = modal();
    const previouslyFocused = document.activeElement;
    let settled = false;

    const finish = (saved) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown, true);
      dialog.close();
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        try { previouslyFocused.focus(); } catch { /* элемент мог исчезнуть */ }
      }
      resolve(saved);
    };

    function onKeydown(event) {
      if (event.key === "Escape") { event.preventDefault(); finish(false); }
    }

    const errorBox = h("div", { class: "form-error", role: "alert" });
    const controls = fields.map(field => {
      const id = `${idPrefix}-${field.key}`;
      let input;
      if (field.type === "select") {
        input = h("select", { id },
          (field.options || []).map(o => h("option", { value: o.value }, o.label)));
        input.value = field.value ?? (field.options?.[0]?.value ?? "");
      } else if (field.type === "textarea") {
        input = h("textarea", { id, rows: "3", maxlength: String(field.maxlength || 600) });
        input.value = field.value || "";
      } else {
        input = h("input", {
          id, type: field.type === "date" ? "date" : "text",
          maxlength: field.type === "date" ? null : String(field.maxlength || 120),
          autocomplete: "off"
        });
        input.value = field.value || "";
      }
      const hint = field.hint || (field.maxlength && field.type !== "select" && field.type !== "date"
        ? `До ${field.maxlength} символов` : "");
      return { field, input, node: h("div", { class: "field" },
        h("label", { for: id }, field.label), input,
        hint ? h("div", { class: "form-hint" }, hint) : null) };
    });

    const saveBtn = h("button", { type: "button", class: "btn primary" }, submitLabel);
    const cancelBtn = h("button", { type: "button", class: "btn secondary", onclick: () => finish(false) }, "Отмена");

    saveBtn.addEventListener("click", async () => {
      errorBox.textContent = "";
      const values = Object.fromEntries(controls.map(c => [c.field.key, c.input.value]));
      saveBtn.disabled = true;
      try {
        const error = await onSubmit?.(values);
        if (error) { errorBox.textContent = error; saveBtn.disabled = false; return; }
        finish(true);
      } catch (e) {
        errorBox.textContent = e?.message || "Не удалось сохранить. Попробуйте ещё раз.";
        saveBtn.disabled = false;
      }
    });

    const content = dialog.querySelector(".modal-content");
    content.setAttribute("role", "dialog");
    content.setAttribute("aria-modal", "true");
    content.setAttribute("aria-label", title || "Форма");
    content.append(
      h("h2", { style: "margin-top:0" }, title || ""),
      text ? h("p", { class: "muted" }, text) : null,
      ...controls.map(c => c.node),
      errorBox,
      h("div", { class: "btn-row" }, saveBtn, cancelBtn)
    );
    const closeBtn = dialog.querySelector(".modal-close");
    if (closeBtn) closeBtn.setAttribute("aria-label", "Закрыть");
    dialog.addEventListener("click", (event) => { if (event.target === dialog) finish(false); });
    document.addEventListener("keydown", onKeydown, true);
    dialog.show();
    controls[0]?.input.focus();
  });
}
