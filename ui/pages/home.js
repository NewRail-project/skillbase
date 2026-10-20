import { State } from "../../core/auth.js";

export default function() {
  const div = document.createElement("div");

  if (State.user) {
    div.innerHTML = `
      <h2>Добро пожаловать в Skillbase</h2>
      <p>Роль: ${State.profile?.role || "student"} · Организация: ${State.profile?.orgId || "default-org"}</p>
      <a href="#profile"><button type="button">Открыть профиль</button></a>
    `;
  } else {
    div.innerHTML = `
      <h2>Добро пожаловать в Skillbase</h2>
      <p>Войдите или зарегистрируйтесь, чтобы начать.</p>
      <a href="#login"><button type="button">Вход</button></a>
      <a href="#register"><button class="secondary" type="button">Регистрация</button></a>
    `;
  }

  return div;
}
