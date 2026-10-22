import { login } from "../../core/auth.js";
import { authErrorMessage } from "../../shared/errors.js";

export default function() {
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
      <div id="error" class="error-msg" role="alert"></div>
      <button type="submit" class="primary" disabled>Войти</button>
    </form>
    <a href="#register"><button class="secondary" type="button">Регистрация</button></a>
  `;

  const form = div.querySelector("#login-form");
  const errorDiv = div.querySelector("#error");
  const submitBtn = div.querySelector("button[type='submit']");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorDiv.textContent = "";
    submitBtn.disabled = true;
    submitBtn.textContent = "Подождите...";

    const email = div.querySelector("#email").value;
    const password = div.querySelector("#password").value;

    try {
      await login(email, password);
      window.location.hash = "#profile";
    } catch (err) {
      errorDiv.textContent = authErrorMessage(err);
      console.error("Login error:", err);
      submitBtn.disabled = false;
      submitBtn.textContent = "Войти";
    }
  });

  return div;
}