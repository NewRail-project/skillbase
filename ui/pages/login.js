import { h } from "../../shared/dom.js";
import { login, linkGoogleAfterPasswordLogin } from "../../core/auth.js";
import { authErrorMessage } from "../../shared/errors.js";
import { peekReturnTo, safeReturnTo, clearReturnTo } from "../../shared/return-to.js";
import { createGoogleButton, handleIncomingGoogleRedirect, googleDivider } from "../components/google-button.js";
import { railScene, brandLockup } from "../../ui/components/brand.js";

export default function LoginPage() {
  const page = h("div", { class: "page auth-page" });

  const errorBox = h("div", { class: "form-error", role: "alert" });
  const linkHint = h("div", { class: "form-hint", style: "display:none" });
  const email = h("input", {
    type: "email", id: "email", required: "required",
    autocomplete: "email", placeholder: "name@company.ru"
  });
  const password = h("input", {
    type: "password", id: "password", required: "required",
    autocomplete: "current-password", placeholder: "••••••••"
  });
  const submit = h("button", { type: "submit", class: "btn primary btn-block" }, "Войти");
  // Гостевой проход: тест по прямой ссылке без регистрации и аккаунта.
  // Ссылка на тест, сохранённая роутером (#quiz/<id>), не теряется —
  // гостевая форма вернёт пользователя на тот же тест.
  const guestBtn = h("button", { type: "button", class: "btn secondary btn-block" }, "Продолжить как гость");
  guestBtn.addEventListener("click", () => {
    window.location.hash = "#guest";
  });

  // Пользователь выбрал Google, но email занят password-аккаунтом:
  // после входа по паролю провайдер привяжется к тому же uid без дубля.
  let pendingGoogle = null;

  // Переход после успешного входа: на сохранённый маршрут (тест,
  // приглашение в комнату, профиль) или на главную.
  async function afterSignIn() {
    const pending = peekReturnTo();
    clearReturnTo();
    window.location.hash = safeReturnTo(pending, "#/");
  }

  // Обе ветки Google (popup и redirect) сводятся на один обработчик.
  function onGoogleEvent(res) {
    if (res?.user) {
      void afterSignIn();
      return;
    }
    if (res?.needsLink) {
      pendingGoogle = { email: res.email || "", credential: res.credential || null };
      email.value = res.email || email.value;
      linkHint.textContent = res.email
        ? `Email занят аккаунтом типа email/пароль. Введите его пароль — Google привяжется, данные и результаты сохранятся.`
        : "Введите пароль существующего аккаунта — Google привяжется к нему.";
      linkHint.style.display = "";
      errorBox.textContent = "";
      email.focus();
      return;
    }
    if (res?.error) {
      errorBox.textContent = authErrorMessage(res.error);
    }
  }

  // Обычная форма.
  const form = h("form", { id: "login-form", class: "panel auth-form", novalidate: "novalidate" },
    brandLockup({ size: 32 }),
    h("div", {},
      h("div", { class: "eyebrow" }, "Вход"),
      h("h1", { style: "margin:4px 0 8px" }, "С возвращением"),
      h("p", { class: "muted", style: "margin:0" }, "Войдите, чтобы продолжить обучение.")
    ),
    errorBox,
    createGoogleButton({ onSuccess: onGoogleEvent, onError: onGoogleEvent }),
    googleDivider(),
    h("div", { class: "field" },
      h("label", { for: "email" }, "Электронная почта"),
      email
    ),
    h("div", { class: "field" },
      h("label", { for: "password" }, "Пароль"),
      password
    ),
    linkHint,
    submit,
    guestBtn,
    h("p", { class: "muted", style: "margin:0;font-size:.8125rem" },
      "Гость проходит тест по ссылке от преподавателя — регистрация не требуется."),
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
      // Связывание Google — после входа и best-effort: если связь не
      // удалась, пользователь всё равно проходит со своим профилем.
      if (pendingGoogle) {
        try {
          await linkGoogleAfterPasswordLogin(
            email.value.trim(), password.value, pendingGoogle.credential);
        } catch (linkErr) {
          console.warn("Связывание с Google не выполнено:", linkErr);
        }
        pendingGoogle = null;
      }
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

  // Возврат с redirect-экрана Google (fallback popup-blocked).
  void handleIncomingGoogleRedirect({ onSuccess: onGoogleEvent, onError: onGoogleEvent });

  email.focus();
  return page;
}
