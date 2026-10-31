import { h } from "../../shared/dom.js";
import { register, State } from "../../core/auth.js";
import { validateRegistration } from "../../core/registration.js";
import { toast } from "../../ui/components/toast.js";
import { authErrorMessage } from "../../shared/errors.js";
import { peekReturnTo, safeReturnTo, clearReturnTo, isReturnableHash } from "../../shared/return-to.js";
import { createGoogleButton, handleIncomingGoogleRedirect, googleDivider } from "../components/google-button.js";

const initialState = {
  fullName: "",
  email: "",
  password: "",
  confirmPassword: "",
  position: "",
  department: "",
  ui: "education",
  errors: {}
};

let state = { ...initialState };

export default function RegisterPage() {
  const div = h("div", { class: "card auth-card" });

  function updateField(field, value) {
    state[field] = value;
    if (state.errors[field]) {
      delete state.errors[field];
      render();
    }
  }

  // Google-вход покрывает и регистрацию, и существующие аккаунты. Профиль
  // создаётся на экране #setup (маршрутизатор сам закрыл к нему проход).
  function onGoogleEvent(res) {
    if (res?.user) {
      const pending = peekReturnTo();
      clearReturnTo();
      window.location.hash = safeReturnTo(pending, "#/");
      return;
    }
    if (res?.needsLink) {
      // Такой email занят password-аккаунтом: связывание выполняется
      // на странице входа (там есть пароль) — не на регистрации.
      state.errors.general = "Аккаунт с этим email уже есть. Войдите по паролю на #login — Google привяжется к нему автоматически.";
      render();
      return;
    }
    if (res?.error) {
      state.errors.general = authErrorMessage(res.error);
      render();
    }
  }

  function render() {
    div.textContent = "";
    const pending = peekReturnTo();
    div.append(
      h("h2", {}, "Регистрация"),
      h("p", { class: "muted" }, "Аккаунт для обучения и проверки знаний."),
      isReturnableHash(pending)
        ? h("p", { class: "form-hint", role: "status" }, "После регистрации вернём вас к выбранному тесту.")
        : null,
      state.errors.general ? h("div", { class: "form-error", role: "alert" }, state.errors.general) : null,
      createGoogleButton({ onSuccess: onGoogleEvent, onError: onGoogleEvent }),
      googleDivider(),
      h("form", { id: "register-form", novalidate: "novalidate" },
        h("div", { class: "form-field" },
          h("label", { for: "fullName" }, "ФИО"),
          h("input", {
            type: "text",
            id: "fullName",
            value: state.fullName,
            oninput: (e) => updateField("fullName", e.target.value),
            "aria-describedby": state.errors.fullName ? "fullName-error" : null
          }),
          state.errors.fullName ? h("div", { id: "fullName-error", class: "form-error" }, state.errors.fullName) : null
        ),
        h("div", { class: "form-field" },
          h("label", { for: "email" }, "Email"),
          h("input", {
            type: "email",
            id: "email",
            value: state.email,
            oninput: (e) => updateField("email", e.target.value),
            "aria-describedby": state.errors.email ? "email-error" : null
          }),
          state.errors.email ? h("div", { id: "email-error", class: "form-error" }, state.errors.email) : null
        ),
        h("div", { class: "form-field" },
          h("label", { for: "password" }, "Пароль"),
          h("input", {
            type: "password",
            id: "password",
            value: "",
            oninput: (e) => updateField("password", e.target.value),
            "aria-describedby": state.errors.password ? "password-error" : null
          }),
          state.errors.password ? h("div", { id: "password-error", class: "form-error" }, state.errors.password) : null
        ),
        h("div", { class: "form-field" },
          h("label", { for: "confirmPassword" }, "Подтверждение пароля"),
          h("input", {
            type: "password",
            id: "confirmPassword",
            value: "",
            oninput: (e) => updateField("confirmPassword", e.target.value),
            "aria-describedby": state.errors.confirmPassword ? "confirmPassword-error" : null
          }),
          state.errors.confirmPassword ? h("div", { id: "confirmPassword-error", class: "form-error" }, state.errors.confirmPassword) : null
        ),
        h("div", { class: "form-field" },
          h("label", { for: "position" }, "Должность"),
          h("input", {
            type: "text",
            id: "position",
            value: state.position,
            oninput: (e) => updateField("position", e.target.value)
          }),
          h("div", { class: "form-hint" }, "Необязательно")
        ),
        h("div", { class: "form-field" },
          h("label", { for: "department" }, "Подразделение"),
          h("input", {
            type: "text",
            id: "department",
            value: state.department,
            oninput: (e) => updateField("department", e.target.value)
          }),
          h("div", { class: "form-hint" }, "Необязательно")
        ),
        h("div", { class: "form-field" },
          h("label", { for: "ui" }, "Стиль интерфейса"),
          h("select", {
            id: "ui",
            value: state.ui,
            onchange: (e) => updateField("ui", e.target.value)
          },
            h("option", { value: "education" }, "Образовательный"),
            h("option", { value: "operations" }, "Операционный"),
            h("option", { value: "depot" }, "Депо")
          ),
          h("div", { class: "form-hint" }, "Необязательно")
        ),
        // Кнопка отправки обязана быть ВНУТРИ form: кнопка снаружи не
        // отправляет форму, клик «молчит» (регрессия после revert b7e11b6).
        h("button", { type: "submit", class: "btn primary" }, "Зарегистрироваться")
      )
    );
    // Для <select> значение задаётся свойством: атрибут value не выбирает option.
    const uiSelect = div.querySelector("#ui");
    if (uiSelect) uiSelect.value = state.ui;
  }

  div.addEventListener("submit", async (e) => {
    e.preventDefault();
    state.errors = {};

    const check = validateRegistration({
      fullName: state.fullName,
      email: state.email,
      password: state.password,
      confirmPassword: state.confirmPassword
    });
    if (!check.ok) {
      state.errors = check.errors;
      render();
      const first = ["fullName", "email", "password", "confirmPassword"]
        .find(field => state.errors[field]);
      const input = first ? div.querySelector(`#${first}`) : null;
      if (input) input.focus();
      return;
    }

    const submit = div.querySelector("button[type='submit']");
    if (submit) {
      submit.disabled = true;
      submit.setAttribute("aria-busy", "true");
      submit.textContent = "Создаём аккаунт…";
    }

    try {
      // Ссылку запоминаем до регистрации: notify() после создания профиля
      // запускает роутер, и тот может забрать сохранённое значение.
      const pending = peekReturnTo();
      // ФИО сохраняется в users/{uid} и publicProfiles/{uid}: имя сразу
      // видно в профиле, списке участников и результатах.
      await register({
        email: check.values.email,
        password: check.values.password,
        fullName: check.values.fullName,
        position: state.position,
        department: state.department,
        ui: state.ui
      });
      toast("Аккаунт создан", "success");
      clearReturnTo();
      const next = safeReturnTo(pending, "#profile");
      state = { ...initialState };
      window.location.hash = next;
    } catch (err) {
      console.error("Register error:", err);
      // Если аккаунт создан, но профиль записать не удалось, показываем
      // сохранённое состояние: оно понятнее кода permission-denied.
      state.errors.general = (State.profileStatus === "error" && State.profileError)
        ? State.profileError
        : err && err.name === "Error" && !err.code
          ? err.message
          : authErrorMessage(err);
      render();
    }
  });

  render();

  // Возврат с redirect-экрана Google (fallback popup-blocked на мобильных):
  // страница загрузилась уже авторизованной — ведём дальше по возвращённому
  // маршруту (роутер сам решит: настройка профиля или приложение).
  void handleIncomingGoogleRedirect({ onSuccess: onGoogleEvent, onError: onGoogleEvent });

  return div;
}