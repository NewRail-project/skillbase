import { State, logout, updateProfileData } from "../../core/auth.js";

export default function() {
  const div = document.createElement("div");
  const profile = State.profile || {};

  div.innerHTML = `
    <div class="card">
      <h2>Профиль</h2>
      <p><strong>Email:</strong> ${State.user ? State.user.email : profile.email || 'N/A'}</p>

      <form id="profile-form">
        <div class="form-group">
          <label for="role">Роль</label>
          <select id="role" class="form-control">
            <option value="student" ${profile.role === 'student' ? 'selected' : ''}>Студент</option>
            <option value="teacher" ${profile.role === 'teacher' ? 'selected' : ''}>Преподаватель</option>
            <option value="admin" ${profile.role === 'admin' ? 'selected' : ''}>Администратор</option>
          </select>
        </div>
        <div class="form-group">
          <label for="orgId">Организация (orgId)</label>
          <input type="text" id="orgId" value="${profile.orgId || ''}" required class="form-control" />
        </div>
        <div class="form-group">
          <label for="ui">Интерфейс (тема)</label>
          <select id="ui" class="form-control">
            <option value="education" ${profile.ui === 'education' ? 'selected' : ''}>Образование (education)</option>
            <option value="operations" ${profile.ui === 'operations' ? 'selected' : ''}>Операции (operations)</option>
            <option value="depot" ${profile.ui === 'depot' ? 'selected' : ''}>Депо (depot)</option>
          </select>
        </div>
        <div id="msg" class="success-msg" role="alert"></div>
        <button type="submit" class="primary">Сохранить</button>
      </form>
      <a href="#logout"><button class="secondary" type="button" id="logout-btn">Выйти</button></a>
    </div>
  `;

  const form = div.querySelector("#profile-form");
  const msgDiv = div.querySelector("#msg");
  const logoutBtn = div.querySelector("#logout-btn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msgDiv.className = "success-msg";
    msgDiv.textContent = "";
    const role = div.querySelector("#role").value;
    const orgId = div.querySelector("#orgId").value;
    const ui = div.querySelector("#ui").value;

    try {
      await updateProfileData({ role, orgId, ui });
      msgDiv.textContent = "Профиль обновлён";
      setTimeout(() => { msgDiv.textContent = ""; }, 3000);
    } catch (err) {
      msgDiv.className = "error-msg";
      msgDiv.textContent = err.message;
    }
  });

  logoutBtn.addEventListener("click", async () => {
    await logout();
    window.location.hash = "#login";
  });

  return div;
}