import { login } from "../../core/auth.js";

export default function() {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `
    <h2>Вход</h2>
    <form id="login-form">
      <input type="email" id="email" placeholder="Email" required autocomplete="email" />
      <input type="password" id="password" placeholder="Пароль" required autocomplete="current-password" />
      <div id="error" class="error-msg"></div>
      <button type="submit">Войти</button>
    </form>
    <a href="#register"><button class="secondary" type="button">Регистрация</button></a>
  `;

  const form = div.querySelector("#login-form");
  const errorDiv = div.querySelector("#error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorDiv.textContent = "";
    const email = div.querySelector("#email").value;
    const password = div.querySelector("#password").value;
    try {
      await login(email, password);
      window.location.hash = "#profile";
    } catch (err) {
      errorDiv.textContent = err.message;
    }
  });

  return div;
}
