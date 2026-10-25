import { h } from "../../shared/dom.js";
import { login } from "../../core/auth.js";
import { authErrorMessage } from "../../shared/errors.js";
import { peekReturnTo, safeReturnTo, clearReturnTo } from "../../shared/return-to.js";
import { railScene, brandLockup } from "../../ui/components/brand.js";

export default function LoginPage() {
  const page = h("div", { class: "page auth-page" });

  const errorBox = h("div", { class: "form-error", role: "alert" });
  const email = h("input", {
    type: "email", id: "email", required: "required",
    autocomplete: "email", placeholder: "name@company.ru"
  });
  const password = h("input", {
    type: "password", id: "password", required: "required",
    autocomplete: "current-password", placeholder: "••••••••"
  });
  const submit = h("button", { type: "submit", class: "btn primary" }, "Войти");

  const form = h("form", { id: "login-form", class: "panel auth-form", novalidate: "novalidate" },
    brandLockup({ size: 32 }),
    h("div", {},
      h("div", { class: "eyebrow" }, "Вход"),
      h("h1", { style: "margin:4px 0 8px" }, "С возвращением"),
      h("p", { class: "muted", style: "margin:0" }, "Войдите, чтобы продолжить обучение.")
    ),
    errorBox,
    h("div", { class: "field" },
      h("label", { for: "email" }, "Электронная почта"),
      email
    ),
    h("div", { class: "field" },
      h("label", { for: "password" }, "Пароль"),
      password
    ),
    submit,
    h("p", { class: "muted", style: "margin:0;font-size:.875rem" },
      "Нет аккаунта? ", h("a", { href: "#register" }, "Зарегистрироваться"))
  );

  const scene = h("div", { class: "auth-aside" });
  scene.innerHTML = railScene();
  scene.appendChild(h("div", { class: "auth-aside-text" },
    h("div", { class: "eyebrow" }, "Skillbase"),
    h("h2", {}, "Знания, которые держат движение"),
    h("p", {}, "Курсы, проверка знаний и результаты — в одной среде для железнодорожных предприятий.")
  ));

  page.append(h("div", { class: "auth-split" }, form, scene));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.textContent = "";
    submit.disabled = true;
    submit.textContent = "Проверяем…";

    try {
      // Ссылку запоминаем до входа: пока грузится профиль, роутер может
      // успеть перенаправить с #login и забрать сохранённое значение.
      const pending = peekReturnTo();
      await login(email.value.trim(), password.value);
      clearReturnTo();
      window.location.hash = safeReturnTo(pending, "#/");
    } catch (err) {
      console.error("Login error:", err);
      errorBox.textContent = authErrorMessage(err);
      password.value = "";
      password.focus();
    } finally {
      submit.disabled = false;
      submit.textContent = "Войти";
    }
  });

  email.focus();
  return page;
}
