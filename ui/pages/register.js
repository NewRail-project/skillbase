import { register } from "../../core/auth.js";
import { authErrorMessage } from "../../shared/errors.js";

export default function () {
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
          <option value="education">Образование</option>
          <option value="operations">Операции</option>
          <option value="depot">Депо</option>
        </select>
      </div>
      <div id="error" class="error-msg" role="alert" hidden></div>
      <button type="submit" class="primary">Зарегистрироваться</button>
    </form>
    <p style="margin-top:16px" class="muted">Новые аккаунты создаются с ролью «студент». Роль преподавателя выдаёт администратор.</p>
    <a class="btn btn-secondary" href="#login">Вернуться ко входу</a>
  `;

  const form = div.querySelector("#register-form");
  const errorDiv = div.querySelector("#error");
  const submitBtn = div.querySelector("button[type='submit']");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorDiv.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Подождите...";
    try {
      await register(div.querySelector("#email").value.trim(), div.querySelector("#password").value, div.querySelector("#ui").value);
      window.location.hash = "";
    } catch (err) {
      console.error("Registration error:", err);
      errorDiv.textContent = authErrorMessage(err);
      errorDiv.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Зарегистрироваться";
    }
  });

  return div;
}
