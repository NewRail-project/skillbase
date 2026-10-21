import { register } from "../../core/auth.js";

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
        <label for="role">Роль</label>
        <select id="role" class="form-control">
          <option value="student">Студент</option>
          <option value="teacher">Преподаватель</option>
          <option value="admin">Администратор</option>
        </select>
      </div>
      <div class="form-group">
        <label for="orgId">Организация (orgId)</label>
        <input type="text" id="orgId" class="form-control" placeholder="default-org" value="default-org" required />
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
    <a href="#login"><button class="secondary" type="button">Вернуться ко входу</button></a>
  `;

  const form = div.querySelector("#register-form");
  const errorDiv = div.querySelector("#error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorDiv.textContent = "";
    const email = div.querySelector("#email").value;
    const password = div.querySelector("#password").value;
    const role = div.querySelector("#role").value;
    const orgId = div.querySelector("#orgId").value;
    const ui = div.querySelector("#ui").value;

    try {
      await register(email, password, role, orgId, ui);
      window.location.hash = "#profile";
    } catch (err) {
      errorDiv.textContent = err.message;
    }
  });

  return div;
}
