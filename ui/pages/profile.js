import { State, logout, updateProfileData } from "../../core/auth.js";
import { escapeHtml } from "../../shared/utils.js";

export default function () {
  const profile = State.profile || {};
  const div = document.createElement("div");
  div.className = "card";
  const sel = (v) => (profile.ui === v ? "selected" : "");

  div.innerHTML = `
    <h2>Профиль</h2>
    <p><strong>Email:</strong> ${escapeHtml(State.user?.email || profile.email || "")}<br>
       <strong>Роль:</strong> ${escapeHtml(profile.role || "student")}<br>
       <strong>Организация:</strong> ${escapeHtml(profile.orgId || "")}</p>
    <form id="profile-form">
      <div class="form-group">
        <label for="ui">Интерфейс (тема)</label>
        <select id="ui" class="form-control">
          <option value="education" ${sel("education")}>Образование</option>
          <option value="operations" ${sel("operations")}>Операции</option>
          <option value="depot" ${sel("depot")}>Депо</option>
        </select>
      </div>
      <div id="msg" role="alert" hidden></div>
      <button type="submit" class="primary">Сохранить</button>
    </form>
    <button class="btn-secondary secondary" type="button" id="logout-btn" style="margin-top:12px;width:100%">Выйти</button>
  `;

  const msg = div.querySelector("#msg");
  div.querySelector("#profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await updateProfileData({ ui: div.querySelector("#ui").value });
      msg.className = "success-msg"; msg.textContent = "Сохранено";
    } catch (err) {
      msg.className = "error-msg"; msg.textContent = "Не удалось сохранить: " + (err.code || err.message);
    }
    msg.hidden = false;
    setTimeout(() => { msg.hidden = true; }, 3000);
  });

  div.querySelector("#logout-btn").addEventListener("click", async () => {
    await logout();
    window.location.hash = "#login";
  });

  return div;
}
