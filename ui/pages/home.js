import { State } from "../../core/auth.js";

export default function() {
  const div = document.createElement("div");
  div.className = "card";

  if (State.user) {
    div.innerHTML = `
      <div class="welcome-section">
        <h2>Добро пожаловать в Skillbase</h2>
        <p>Роль: <span class="highlight">${State.profile?.role || "student"}</span> · Организация: <span class="highlight">${State.profile?.orgId || "default-org"}</span></p>
        <a href="#profile"><button type="button" class="primary">Открыть профиль</button></a>
      </div>
    `;
  } else {
    div.innerHTML = `
      <div class="welcome-section">
        <h2>Добро пожаловать в Skillbase</h2>
        <p>Войдите или зарегистрируйтесь, чтобы начать.</p>
        <div class="button-group">
          <a href="#login"><button type="button" class="primary">Вход</button></a>
          <a href="#register"><button class="secondary" type="button">Регистрация</button></a>
        </div>
      </div>
    `;
  }

  return div;
}