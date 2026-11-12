// ui/components/google-button.js — кнопка «Продолжить с Google».
// Одна реализация для страниц входа и регистрации:
//   createGoogleButton({ onSuccess, onError }) — обычная кнопка;
//   handleIncomingGoogleRedirect({ onSuccess, onError }) — после возврата
//   с redirect-экрана Google (fallback popup-blocked на мобильных).
// Ошибка связывания (email уже занят password-аккаунтом) отдаётся странице
// через onError: там пользователь входит по паролю, Google привязывается
// к тому же uid — дубликат аккаунта не создаётся.
import { h } from "../../shared/dom.js";
import { loginWithGoogle, finishGoogleRedirect } from "../../core/auth.js";
import { authErrorMessage } from "../../shared/errors.js";

// Фирменный знак Google (стандартная 4-цветная «G»).
const G_LOGO = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">'
  + '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>'
  + '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>'
  + '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>'
  + '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>'
  + '</svg>';

// h() не умеет innerHTML — вставляем логотип напрямую.
function paintButton(btn) {
  btn.textContent = "";
  const icon = document.createElement("span");
  icon.className = "google-icon";
  icon.innerHTML = G_LOGO;
  const label = document.createElement("span");
  label.textContent = "Продолжить с Google";
  btn.append(icon, label);
}

export function createGoogleButton({ onSuccess, onError }) {
  const btn = h("button", { type: "button", class: "btn google-btn btn-block" });
  paintButton(btn);

  btn.addEventListener("click", async () => {
    if (btn.dataset.busy === "1") return;
    btn.dataset.busy = "1";
    btn.disabled = true;
    btn.textContent = "Открываем Google…";
    try {
      const res = await loginWithGoogle();
      if (res?.redirected) {
        // Уходим на экран Google: страница перезагрузится и результат
        // подберёт handleIncomingGoogleRedirect.
        btn.textContent = "Переходим на экран Google…";
        return;
      }
      btn.disabled = false;
      paintButton(btn);
      if (res?.user) {
        onSuccess?.(res.user);
      } else {
        onError?.(res || {}); // needsLink: email занят password-аккаунтом
      }
    } catch (err) {
      console.error("Google вход:", err);
      btn.disabled = false;
      paintButton(btn);
      onError?.({ error: err });
    } finally {
      btn.dataset.busy = "0";
    }
  });

  return btn;
}

// Возврат с redirect-экрана Google. Вызывается при загрузке страницы входа;
// null — обычный визит без redirect. Как и при popup, ошибка связывания
// уходит в onError, критичные — в error message.
export async function handleIncomingGoogleRedirect({ onSuccess, onError }) {
  try {
    const res = await finishGoogleRedirect();
    if (!res) return;
    if (res.user) {
      onSuccess?.(res.user);
    } else {
      onError?.(res);
    }
  } catch (err) {
    console.error("Google redirect:", err);
    onError?.({ error: err });
  }
}

// Разделитель «или» между Google-кнопкой и формой email/пароль.
export function googleDivider() {
  const wrap = h("div", { class: "google-divider", role: "separator", "aria-label": "или" });
  const text = document.createElement("span");
  text.className = "google-divider-text";
  text.textContent = "или";
  wrap.append(document.createElement("span"), text, document.createElement("span"));
  return wrap;
}
