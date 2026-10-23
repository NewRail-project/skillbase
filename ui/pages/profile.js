import { State, logout, updateProfileData } from "../../core/auth.js";
import { escapeHtml } from "../../shared/utils.js";
import { empty } from "../../ui/components/empty.js";
import { error } from "../../ui/components/error.js";
import { confirm } from "../../ui/components/confirm.js";

const UI_OPTIONS = {
  education: "Образование",
  operations: "Операции",
  depot: "Депо"
};

function profileInfo() {
  const profile = State.profile || {};
  return `
    <div class="profile-info">
      <p><strong>Email:</strong> ${escapeHtml(State.user?.email || profile.email || "")}</p>
      <p><strong>Роль:</strong> ${escapeHtml(profile.role || "студент")}</p>
      <p><strong>Организация:</strong> ${escapeHtml(profile.orgId || "")}</p>
    </div>`;
}

export default function () {
  const profile = State.profile || {};
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
      <h2>Профиль</h2>
    </div>
    ${profileInfo()}
    <form id="profile-form" class="form-container">
      <div class="form-group">
        <label for="ui">Интерфейс (тема)</label>
        <select id="ui" class="form-control">
          ${Object.entries(UI_OPTIONS).map(([value, label]) =>
            `<option value="${value}" ${profile.ui === value ? "selected" : ""}>${label}</option>`
          ).join("")}
        </select>
      </div>
      <button type="submit" class="primary">Сохранить</button>
    </form>
    <button class="btn-secondary secondary" type="button" id="logout-btn" style="margin-top:12px;width:100%">Выйти</button>
  `;

  const form = div.querySelector("#profile-form");
  const msg = document.createElement("div");
  msg.id = "msg";
  msg.role = "alert";
  msg.hidden = true;
  form.appendChild(msg);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await updateProfileData({ ui: div.querySelector("#ui").value });
      msg.className = "success-msg";
      msg.textContent = "Сохранено";
      msg.hidden = false;
      setTimeout(() => { msg.hidden = true; }, 3000);
    } catch (err) {
      msg.className = "error-msg";
      msg.textContent = "Не удалось сохранить: " + (err.code || err.message);
      msg.hidden = false;
    }
  });

  div.querySelector("#logout-btn").addEventListener("click", () => {
    confirm({
      text: "Вы уверены, что хотите выйти?",
      actionText: "Выйти",
      cancelText: "Отмена",
      onConfirm: async () => {
        await logout();
        window.location.hash = "#login";
      }
    });
  });

  return div;
}