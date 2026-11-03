import { appearanceTools } from "../components/theme-toggle.js";
import { h } from "../../shared/dom.js";
import { register, State } from "../../core/auth.js";
import { validateRegistration } from "../../core/registration.js";
import { saveConsent } from "../../core/consents.js";
import { toast } from "../../ui/components/toast.js";
import { consentCheckbox } from "../../ui/components/consent.js";
import { authErrorMessage } from "../../shared/errors.js";
import { peekReturnTo, safeReturnTo, clearReturnTo, isReturnableHash } from "../../shared/return-to.js";
import { createGoogleButton, handleIncomingGoogleRedirect, googleDivider } from "../components/google-button.js";
import { railScene, brandLockup } from "../../ui/components/brand.js";

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
  const page = h("div", { class: "page auth-page" });
  // Тема и палитра хранятся на устройстве (localStorage), поэтому доступны и гостю.
  page.appendChild(h("div", { class: "auth-corner" }, appearanceTools({ withLabel: true })));

  // Согласие с документами (ui/components/consent.js): чекбокс выключен,
  // без него кнопка регистрации остаётся неактивной.
  const consent = consentCheckbox({ idPrefix: "register" });
  state.errors.consent = "";

  const buttonHint = h("p", { class: "form-hint", role: "status" },
    "Чтобы зарегистрироваться, отметьте согласие с документами.");
  buttonHint.hidden = true;

  // Чекбокс управляет кнопкой напрямую (без полной перерисовки формы):
  // другие поля ввода не теряют введённое во время переключения.
  consent.input.addEventListener("change", () => {
    const submit = div.querySelector("button[type=submit]");
    if (submit) submit.disabled = !consent.checked();
    buttonHint.hidden = consent.checked();
  });

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
    const pending = peekReturnTo();

    // Кнопка неактивна, пока не принято согласие. Пересоздаётся при
    // перерисовке, поэтому её состояние держится от state.errors.consent.
    const disabled = !consent.checked();

    const form = h("form", { id: "register-form", class: "panel auth-form", novalidate: "novalidate" },
      brandLockup({ size: 32 }),
      h("div", {},
        h("div", { class: "eyebrow" }, "Регистрация"),
        h("h1", { style: "margin:4px 0 8px" }, "Создать аккаунт"),
        h("p", { class: "muted", style: "margin:0" }, "Аккаунт для обучения и проверки знаний.")
      ),
      isReturnableHash(pending)
        ? h("p", { class: "form-hint", role: "status" }, "После регистрации вернём вас к выбранному тесту.")
        : null,
      state.errors.general ? h("div", { class: "form-error", role: "alert" }, state.errors.general) : null,
      createGoogleButton({ onSuccess: onGoogleEvent, onError: onGoogleEvent }),
      googleDivider(),
      h("div", { class: "field" },
        h("label", { for: "fullName" }, "ФИО"),
        h("input", {
          type: "text",
          id: "fullName",
          value: state.fullName,
          autocomplete: "name",
          oninput: (e) => updateField("fullName", e.target.value),
          "aria-describedby": state.errors.fullName ? "fullName-error" : null
        }),
        state.errors.fullName ? h("div", { id: "fullName-error", class: "form-error" }, state.errors.fullName) : null
      ),
      h("div", { class: "field" },
        h("label", { for: "email" }, "Email"),
        h("input", {
          type: "email",
          id: "email",
          value: state.email,
          autocomplete: "email",
          oninput: (e) => updateField("email", e.target.value),
          "aria-describedby": state.errors.email ? "email-error" : null
        }),
        state.errors.email ? h("div", { id: "email-error", class: "form-error" }, state.errors.email) : null
      ),
      h("div", { class: "field" },
        h("label", { for: "password" }, "Пароль"),
        h("input", {
          type: "password",
          id: "password",
          value: "",
          autocomplete: "new-password",
          oninput: (e) => updateField("password", e.target.value),
          "aria-describedby": state.errors.password ? "password-error" : null
        }),
        state.errors.password ? h("div", { id: "password-error", class: "form-error" }, state.errors.password) : null
      ),
      h("div", { class: "field" },
        h("label", { for: "confirmPassword" }, "Подтверждение пароля"),
        h("input", {
          type: "password",
          id: "confirmPassword",
          value: "",
          autocomplete: "new-password",
          oninput: (e) => updateField("confirmPassword", e.target.value),
          "aria-describedby": state.errors.confirmPassword ? "confirmPassword-error" : null
        }),
        state.errors.confirmPassword ? h("div", { id: "confirmPassword-error", class: "form-error" }, state.errors.confirmPassword) : null
      ),
      h("div", { class: "field" },
        h("label", { for: "position" }, "Должность"),
        h("input", {
          type: "text",
          id: "position",
          value: state.position,
          oninput: (e) => updateField("position", e.target.value)
        }),
        h("div", { class: "form-hint" }, "Необязательно")
      ),
      h("div", { class: "field" },
        h("label", { for: "department" }, "Подразделение"),
        h("input", {
          type: "text",
          id: "department",
          value: state.department,
          oninput: (e) => updateField("department", e.target.value)
        }),
        h("div", { class: "form-hint" }, "Необязательно")
      ),
      h("div", { class: "field" },
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
      consent.el,
      // Кнопка отправки обязана быть ВНУТРИ form: кнопка снаружи не
      // отправляет форму, клик «молчит» (регрессия после revert b7e11b6).
      h("button", { type: "submit", class: "btn primary btn-block" }, "Создать аккаунт"),
      buttonHint,
      h("p", { class: "muted", style: "margin:0;font-size:.875rem" },
        "Есть аккаунт? ", h("a", { href: "#login" }, "Войти"))
    );

    // Для <select> значение задаётся свойством: атрибут value не выбирает option.
    const uiSelect = form.querySelector("#ui");
    if (uiSelect) uiSelect.value = state.ui;

    const submit = form.querySelector("button[type=submit]");
    submit.disabled = disabled;
    // Подсказка видна, пока согласие не принято; после принятия скрываем.
    buttonHint.hidden = consent.checked();

    div.textContent = "";
    div.append(
      h("div", { class: "auth-split" }, form, railAside())
    );
  }

  const div = h("div");

  function updateField(field, value) {
    state[field] = value;
    if (state.errors[field]) {
      delete state.errors[field];
      render();
    }
  }

  // Записывает факт согласия в Firestore (consents). Аккаунт уже создан,
  // поэтому при сбое записи регистрацию не откатываем: повторяем один раз
  // и предупреждаем тостом — правила делают сбой маловероятным.
  async function saveSignupConsent(user) {
    try {
      await saveConsent({ uid: user.uid, type: "signup" });
      return true;
    } catch (firstErr) {
      console.warn("Согласие не сохранено (попытка 1):", firstErr);
      await new Promise(resolve => setTimeout(resolve, 1500));
      try {
        await saveConsent({ uid: user.uid, type: "signup" });
        return true;
      } catch (err) {
        console.error("Согласие не сохранено:", err);
        toast("Не удалось сохранить согласие с документами. Сообщите администратору.", "error");
        return false;
      }
    }
  }

  div.addEventListener("submit", async (e) => {
    e.preventDefault();
    state.errors = {};

    // Согласие обязательно: без галочки регистрация не выполняется.
    if (!consent.checked()) {
      state.errors.consent = "Чтобы зарегистрироваться, подтвердите согласие с Политикой конфиденциальности и Пользовательским соглашением.";
      consent.setError(state.errors.consent);
      consent.input.focus();
      return;
    }

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
    consent.input.disabled = true;

    try {
      // Ссылку запоминаем до регистрации: notify() после создания профиля
      // запускает роутер, и тот может забрать сохранённое значение.
      const pending = peekReturnTo();
      // ФИО сохраняется в users/{uid} и publicProfiles/{uid}: имя сразу
      // видно в профиле, списке участников и результатах.
      const user = await register({
        email: check.values.email,
        password: check.values.password,
        fullName: check.values.fullName,
        position: state.position,
        department: state.department,
        ui: state.ui
      });
      // Факт согласия с датой, временем и редакциями документов —
      // в Firestore (consents), не только на экране.
      await saveSignupConsent(user);
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
      consent.input.disabled = false;
      render();
    }
  });

  render();

  page.append(div);

  // Возврат с redirect-экрана Google (fallback popup-blocked на мобильных):
  // страница загрузилась уже авторизованной — ведём дальше по возвращённому
  // маршруту (роутер сам решит: настройка профиля или приложение).
  void handleIncomingGoogleRedirect({ onSuccess: onGoogleEvent, onError: onGoogleEvent });

  return page;
}

function railAside() {
  const scene = h("div", { class: "auth-aside" });
  scene.innerHTML = railScene();
  scene.appendChild(h("div", { class: "auth-aside-text" },
    h("div", { class: "eyebrow" }, "Skillbase"),
    h("h2", {}, "Аккаунт для обучения"),
    h("p", {}, "Задания, результаты и учебные материалы — под руководством наставника предприятия.")
  ));
  return scene;
}
