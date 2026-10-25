import { State } from "../../core/auth.js";

const ROLE_NAMES = { student: "студент", teacher: "преподаватель", admin: "администратор" };

export default function () {
  const div = document.createElement("div");
  div.className = "card";

  if (State.user) {
    const role = ROLE_NAMES[State.profile?.role] || "студент";
    div.innerHTML = `
      <h2>Добро пожаловать в Skillbase</h2>
      <p>Вы вошли как <strong id="h-role"></strong>.</p>
      <div class="button-group">
        <a class="btn primary" id="h-main" href="#assignments">Мои задания</a>
        <a class="btn secondary" href="#profile">Профиль</a>
      </div>`;
    div.querySelector("#h-role").textContent = role;
    if (["teacher", "admin"].includes(State.profile?.role)) {
      const main = div.querySelector("#h-main");
      main.href = "#create-test";
      main.textContent = "Создать тест";
    }
  } else {
    div.innerHTML = `
      <h2>Добро пожаловать в Skillbase</h2>
      <p>Обучение и проверка знаний для железнодорожной отрасли. Войдите или зарегистрируйтесь, чтобы начать.</p>
      <div class="button-group">
        <a class="btn primary" href="#login">Войти</a>
        <a class="btn secondary" href="#register">Зарегистрироваться</a>
      </div>`;
  }
  return div;
}
