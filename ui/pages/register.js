import { register } from "../../core/auth.js";
import { authErrorMessage } from "../../shared/errors.js";

export default function() {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `
    <h2>Регистрация</h2>
    <form id="register-form">
      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" class="form-control" required autocomplete="email" />
      </div>
      <div class="form-group">
        <label for="password">Пароль (мин. 6 символов)</label>
        <input type="password" id="password" class="form-control" required minlength="6" autocomplete="new-password" />
      </div>
      <div class="form-group">
        <label for="ui">Интерфейс (тема)</label>
        <select id="ui" class="form-control">
          <option value="education">Образование (education)</option>
          <option value="operations">Операции (operations)</option>
          <option value="depot">Депо (depot)</option>
        </select>
      </div>
      <div id="error" class="error-msg" role="alert"></div>
      <button type="submit" class="primary">Зарегистрироваться</button>
    </form>
    <a class="btn secondary" href="#login">Вернуться ко входу</a>
  `;

  const form = div.querySelector("#register-form");
  const errorDiv = div.querySelector("#error");
  const submitBtn = div.querySelector("button[type='submit']");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorDiv.textContent = "";
    submitBtn.disabled = true;
    submitBtn.textContent = "Подождите...";

    const email = div.querySelector("#email").value;
    const password = div.querySelector("#password").value;
    const ui = div.querySelector("#ui").value;

    try {
      await register(email, password, "student", "default-org", ui);
      window.location.hash = "#profile";
    } catch (err) {
      errorDiv.textContent = authErrorMessage(err);
      console.error("Registration error:", err);
      submitBtn.disabled = false;
      submitBtn.textContent = "Зарегистрироваться";
    }
  });

  return div;
}