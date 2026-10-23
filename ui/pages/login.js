import { login } from "../../core/auth.js";
import { authErrorMessage } from "../../shared/errors.js";

export default function () {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `
    <h2>Вход</h2>
    <form id="login-form">
      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" class="form-control" required autocomplete="email" />
      </div>
      <div class="form-group">
        <label for="password">Пароль</label>
        <input type="password" id="password" class="form-control" required autocomplete="current-password" />
      </div>
      <div id="error" class="error-msg" role="alert" hidden></div>
      <button type="submit" class="primary">Войти</button>
    </form>
    <p style="margin-top:16px">Нет аккаунта?</p>
    <a class="btn btn-secondary" href="#register">Регистрация</a>
  `;

  const form = div.querySelector("#login-form");
  const errorDiv = div.querySelector("#error");
  const submitBtn = div.querySelector("button[type='submit']");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorDiv.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Подождите...";
    try {
      await login(div.querySelector("#email").value.trim(), div.querySelector("#password").value);
      window.location.hash = "";
    } catch (err) {
      console.error("Login error:", err);
      errorDiv.textContent = authErrorMessage(err);
      errorDiv.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Войти";
    }
  });

  return div;
}
