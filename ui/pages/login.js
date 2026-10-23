import { login } from "../../core/auth.js";
import { authErrorMessage } from "../../shared/errors.js";
import { empty } from "../../ui/components/empty.js";
import { error } from "../../ui/components/error.js";
import { iconHTML } from "../../ui/icons.js";
import { applyTheme } from "../../core/auth.js";

export default function () {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `
    <div class="header-section">
      <div class="logo-bar">
        <svg width="24" height="24" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M16 48L240 48" stroke-linecap="round"/>
          <path d="M16 96L240 96" stroke-linecap="round"/>
          <path d="M16 64L20 80" stroke-linecap="round"/>
          <path d="M48 64L52 80" stroke-linecap="round"/>
          <path d="M80 64L84 80" stroke-linecap="round"/>
          <path d="M112 64L116 80" stroke-linecap="round"/>
          <path d="M144 64L148 80" stroke-linecap="round"/>
          <path d="M176 64L180 80" stroke-linecap="round"/>
          <path d="M208 64L212 80" stroke-linecap="round"/>
        </svg>
      </div>
      <h2>Вход</h2>
    </div>
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