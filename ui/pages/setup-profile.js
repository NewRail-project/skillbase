// ui/pages/setup-profile.js — первоначальная настройка профиля после
// первого входа через Google (#setup).
//
// Что здесь происходит:
//   • ФИО: предзаполняется именем из Google (user.displayName) — Google-имя
//     НЕ считается достоверным ФИО без подтверждения пользователем.
//   • Стиль интерфейса: карточки с мини-предпросмотром (education /
//     depot / operations). Выбор можно увидеть сразу — applyTheme меняет
//     страницу на живую, в профиль записывает только «Завершить настройку».
//   • «Завершить настройку» → createOwnProfile (users/{uid} по правилам
//     Firestore: role=student, организация строго default-org).
//   • Черновик ФИО/стиля — в sessionStorage: закрыл страницу — при следующем
//     входе настройка откроется снова, уже введённое вернётся.
//
// Маршрут защищён в app.js: незавершённый профиль не пропускается на другие
// auth-страницы. Здесь дополнительно: гость → #join, готовый профиль → #/.
import { h } from "../../shared/dom.js";
import { State, createOwnProfile, applyTheme, DEFAULT_UI } from "../../core/auth.js";
import {
  SETUP_STYLES, profileSetupIncomplete, validateFullName
} from "../../core/registration.js";
import { consumeReturnTo } from "../../shared/return-to.js";
import { toast } from "../components/toast.js";

const DRAFT_KEY = "sb:profileDraft";

function readDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeDraft(patch) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...readDraft(), ...patch }));
  } catch (_) {
    // приватный режим — черновик просто не сохраняется
  }
}

function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch (_) { /* ignore */ }
}

export default function SetupProfilePage() {
  const page = h("div", { class: "page setup-page" });
  const guest = State.user?.isAnonymous === true;

  // Гостю настройка не нужна: он работает только в Live-комнате.
  if (guest) {
    window.location.hash = "#join";
    return page;
  }

  // Профиль уже настроен (например, повторный визит по закладке): не
  // показываем форму дважды — ведём в приложение.
  if (!profileSetupIncomplete(State.profileStatus, State.profile, guest)) {
    window.location.hash = consumeReturnTo("#/");
    return page;
  }

  const draft = readDraft();
  const googleName = String(State.user?.displayName || "").trim();

  page.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Первоначальная настройка"),
      h("h1", {}, "Добро пожаловать в Skillbase"),
      h("p", { class: "page-sub" }, "Осталось заполнить профиль — и можно работать.")
    )
  ));

  const errorBox = h("div", { class: "form-error", role: "alert" });

  const nameInput = h("input", {
    type: "text",
    id: "setup-fullName",
    class: "form-control",
    autocomplete: "name",
    maxlength: "120",
    value: draft.fullName || googleName || "",
    oninput: (e) => writeDraft({ fullName: e.target.value })
  });
  if (googleName) {
    nameInput.setAttribute("aria-describedby", "setup-name-hint");
  }

  const positionInput = h("input", {
    type: "text", id: "setup-position", maxlength: "120",
    value: draft.position || "",
    oninput: (e) => writeDraft({ position: e.target.value })
  });
  const departmentInput = h("input", {
    type: "text", id: "setup-department", maxlength: "120",
    value: draft.department || "",
    oninput: (e) => writeDraft({ department: e.target.value })
  });

  // ---------- Выбор стиля интерфейса ----------
  let selectedStyle = draft.ui && SETUP_STYLES.some(([value]) => value === draft.ui)
    ? draft.ui
    : (State.profile?.ui && SETUP_STYLES.some(([value]) => value === State.profile.ui)
      ? State.profile.ui
      : DEFAULT_UI);
  writeDraft({ ui: selectedStyle });
  const styleGrid = h("div", { class: "setup-styles", role: "radiogroup", "aria-label": "Стиль интерфейса" });
  const styleCards = [];

  function paintStyles() {
    styleGrid.textContent = "";
    styleCards.length = 0;
    for (const [value, title, hint] of SETUP_STYLES) {
      const card = h("button", {
        type: "button",
        class: "setup-style-card",
        role: "radio",
        "aria-checked": String(selectedStyle === value),
        dataset: { style: value }
      });
      // Мини-предпросмотр: радиусы и плотность поверхностей каждого скина.
      const radius = { education: "12px", operations: "6px", depot: "3px" }[value];
      const gap = { education: "10px", operations: "7px", depot: "5px" }[value];
      const bar = (extra) => {
        const el = document.createElement("span");
        el.className = "setup-style-bar";
        el.style.borderRadius = radius;
        el.style.marginBottom = `${gap}px`;
        if (extra) el.style.cssText += extra;
        return el;
      };
      const shot = document.createElement("span");
      shot.className = "setup-style-shot";
      shot.append(
        bar("width: 70%; height: 12px;"),
        bar("width: 88%; height: 8px; opacity: .7;"),
        bar("width: 52%; height: 18px; margin-top: 4px;")
      );
      const body = h("span", { class: "setup-style-body" },
        h("b", {}, title),
        h("span", { class: "muted" }, hint)
      );
      card.append(shot, body);
      card.addEventListener("click", () => {
        selectedStyle = value;
        writeDraft({ ui: value });
        // Живой предпросмотр: скин применяется к открытой странице,
        // но в профиль попадёт только после «Завершить настройку».
        applyTheme(value);
        styleCards.forEach(c => c.setAttribute("aria-checked", String(c === card)));
      });
      styleGrid.appendChild(card);
      styleCards.push(card);
    }
  }
  paintStyles();

  const submit = h("button", { type: "button", class: "btn primary btn-block" }, "Завершить настройку");
  submit.addEventListener("click", async () => {
    errorBox.textContent = "";
    const check = validateFullName(nameInput.value);
    if (!check.ok) {
      errorBox.textContent = check.error;
      nameInput.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = "Сохраняем…";
    try {
      await createOwnProfile({
        fullName: check.value,
        ui: selectedStyle,
        position: positionInput.value.trim(),
        department: departmentInput.value.trim()
      });
      clearDraft();
      toast("Профиль готов", "success");
      window.location.hash = consumeReturnTo("#/");
    } catch (err) {
      console.error("Завершение настройки:", err);
      errorBox.textContent = err?.code === "permission-denied"
        ? "Правила Firestore не разрешили сохранить профиль. Попробуйте ещё раз."
        : (err?.message || "Не удалось сохранить профиль. Проверьте соединение.");
      submit.disabled = false;
      submit.textContent = "Завершить настройку";
    }
  });

  page.appendChild(h("div", { class: "panel panel-narrow" },
    h("div", { class: "panel-body" },
      errorBox,
      h("div", { class: "field" },
        h("label", { for: "setup-fullName" }, "ФИО"),
        nameInput,
        googleName
          ? h("p", { id: "setup-name-hint", class: "form-hint" },
              `Имя из Google: «${googleName}». Проверьте и при необходимости исправьте.`)
          : null
      ),
      h("div", { class: "setup-styles-head" },
        h("b", {}, "Стиль интерфейса"),
        h("p", { class: "form-hint" }, "Предпросмотр сразу действует на эту страницу; закрепляется после сохранения. Позднее стиль можно поменять в настройках.")
      ),
      styleGrid,
      h("div", { class: "field" },
        h("label", { for: "setup-position" }, "Должность"),
        positionInput,
        h("div", { class: "form-hint" }, "Необязательно")
      ),
      h("div", { class: "field" },
        h("label", { for: "setup-department" }, "Подразделение"),
        departmentInput,
        h("div", { class: "form-hint" }, "Необязательно")
      ),
      submit
    )
  ));

  return page;
}
