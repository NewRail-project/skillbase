import { State, logout, updateProfileData } from "../../core/auth.js";
import { authErrorMessage } from "../../shared/errors.js";

const ROLE_NAMES = { student: "Студент", teacher: "Преподаватель", admin: "Администратор" };

export default function () {
  const div = document.createElement("div");
  const profile = State.profile || {};
  const email = State.user ? State.user.email : profile.email || "—";
  const ui = profile.ui || "education";

  div.innerHTML = `
    <div class="card">
      <h2>Профиль</h2>
      <dl class="profile-info">
        <dt>Email</dt><dd id="p-email"></dd>
        <dt>Роль</dt><dd id="p-role"></dd>
        <dt>Организация</dt><dd id="p-org"></dd>
      </dl>
      <form id="profile-form">
        <div class="form-group">
          <label for="ui">Оформление</label>
          <select id="ui" class="form-control">
            <option value="education">Образование</option>
            <option value="operations">Эксплуатация</option>
            <option value="depot">Депо</option>
          </select>
        </div>
        <div id="msg" class="success-msg" role="status"></div>
        <button type="submit" class="primary">Сохранить</button>
      </form>
      <button class="secondary" type="button" id="logout-btn">Выйти</button>
    </div>
  `;

  div.querySelector("#p-email").textContent = email;
  div.querySelector("#p-role").textContent = ROLE_NAMES[profile.role] || "Студент";
  div.querySelector("#p-org").textContent = profile.orgId || "default-org";
  div.querySelector("#ui").value = ui;

  const msgDiv = div.querySelector("#msg");

  div.querySelector("#profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    msgDiv.className = "success-msg";
    msgDiv.textContent = "";
    try {
      await updateProfileData({ ui: div.querySelector("#ui").value });
      msgDiv.textContent = "Оформление сохранено";
    } catch (err) {
      msgDiv.className = "error-msg";
      msgDiv.textContent = authErrorMessage(err);
    }
  });

  div.querySelector("#logout-btn").addEventListener("click", async () => {
    await logout();
    window.location.hash = "#login";
  });

  return div;
}
