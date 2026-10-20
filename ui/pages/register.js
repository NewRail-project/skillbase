import { register } from "../../core/auth.js";

export default function() {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `
    <h2>Регистрация</h2>
    <form id="register-form">
      <input type="email" id="email" placeholder="Email" required autocomplete="email" />
      <input type="password" id="password" placeholder="Пароль (мин. 6 символов)" required minlength="6" autocomplete="new-password" />
      <label>Роль:</label>
      <select id="role">
        <option value="student">Студент</option>
        <option value="teacher">Преподаватель</option>
        <option value="admin">Администратор</option>
      </select>
      <label>Организация (orgId):</label>
      <input type="text" id="orgId" placeholder="default-org" value="default-org" required />
      <label>Интерфейс (тема):</label>
      <select id="ui">
        <option value="education">Образование (education)</option>
        <option value="operations">Операции (operations)</option>
        <option value="depot">Депо (depot)</option>
      </select>
      <div id="error" class="error-msg"></div>
      <button type="submit">Зарегистрироваться</button>
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
