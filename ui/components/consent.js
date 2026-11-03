// ui/components/consent.js — обязательный чекбокс согласия с документами
// (регистрация, гостевой вход, Live-комнаты). Один и тот же компонент на
// всех трёх экранах: ссылки открывают документы в новой вкладке той же
// страницы (hash-маршруты), клик по ссылке не переключает чекбокс.
//
// Элемент возврат: consentBox.el, методы checked() и setError(текст|null).
import { h } from "../../shared/dom.js";
import { CONSENT_DOCUMENTS } from "../../core/consent-docs.js";

export function consentCheckbox({ idPrefix } = {}) {
  const boxId = `${idPrefix || "consent"}-agree`;
  const errorId = `${boxId}-error`;

  const input = h("input", {
    type: "checkbox",
    id: boxId,
    "aria-describedby": errorId
  });

  const links = [];
  for (const key of ["privacy", "terms"]) {
    const doc = CONSENT_DOCUMENTS[key];
    const link = h("a", {
      href: doc.route,
      target: "_blank",
      rel: "noopener"
    }, doc.title);
    // Ссылка внутри label: без этого клика label активирует чекбокс
    // раньше перехода на страницу документа.
    link.addEventListener("click", (e) => e.stopPropagation());
    links.push(link);
  }

  const errorText = h("p", { id: errorId, class: "consent-error", role: "alert" });
  errorText.hidden = true;

  const el = h("div", { class: "consent-box" },
    h("label", { class: "consent-label", for: boxId },
      input,
      h("span", { class: "consent-text" },
        "Я ознакомился(ась) и принимаю ",
        links[0], " и ", links[1]
      )
    ),
    errorText
  );

  function setError(message) {
    if (message) {
      errorText.textContent = message;
      errorText.hidden = false;
    } else {
      errorText.textContent = "";
      errorText.hidden = true;
    }
    el.classList.toggle("has-error", Boolean(message));
  }

  // Ошибка снимается, как только пользователь поставил галочку.
  input.addEventListener("change", () => {
    if (input.checked) setError(null);
  });

  return {
    el,
    checked: () => Boolean(input.checked),
    setError,
    input
  };
}
