import { h } from "../../shared/dom.js";
import { register } from "../../core/auth.js";
import { validateFullName } from "../../core/profile.js";
import { icons } from "../../shared/icons.js";
import { toast } from "../../ui/components/toast.js";
import { authErrorMessage } from "../../shared/errors.js";

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

  function render() {
    div.textContent = "";
    div.append(
      h("h2", {}, "Регистрация"),
      h("p", { class: "muted" }, "Аккаунт для обучения и проверки знаний."),
      state.errors.general ? h("div", { class: "form-error", role: "alert" }, state.errors.general) : null,
      h("form", { id: "register-form" },
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
        )
      ),
      h("button", { type: "submit", class: "btn primary" }, "Зарегистрироваться")
    );
    // Для <select> значение задаётся свойством: атрибут value не выбирает option.
    const uiSelect = div.querySelector("#ui");
    if (uiSelect) uiSelect.value = state.ui;
  }

  div.addEventListener("submit", async (e) => {
    e.preventDefault();
    state.errors = {};
    const { ok, error, value } = validateFullName(state.fullName);
    if (!ok) {
      state.errors.fullName = error;
      render();
      return;
    }

    if (!state.email.trim()) {
      state.errors.email = "Укажите email";
      render();
      return;
    }

    if (state.password.length < 6) {
      state.errors.password = "Пароль должен быть не короче 6 символов";
      render();
      return;
    }

    if (state.password !== state.confirmPassword) {
      state.errors.confirmPassword = "Пароли не совпадают";
      render();
      return;
    }

    const submit = div.querySelector("button[type='submit']");
    if (submit) { submit.disabled = true; submit.textContent = "Создаём аккаунт..."; }

    try {
      // fullName передаётся в register: без него правило create для users/{uid}
      // отклоняет запись, и пользователь остаётся без профиля.
      await register(state.email.trim(), state.password, value, state.ui);
      toast("Аккаунт создан", "success");
      state = { ...initialState };
      window.location.hash = "#profile";
    } catch (err) {
      console.error("Register error:", err);
      state.errors.general = authErrorMessage(err);
      render();
    }
  });

  render();
  return div;
}