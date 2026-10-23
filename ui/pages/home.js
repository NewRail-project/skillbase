import { State, isStaff } from "../../core/auth.js";
import { escapeHtml } from "../../shared/utils.js";

const ROLE = { student: "студент", teacher: "преподаватель", admin: "администратор" };

export default function () {
  const div = document.createElement("div");
  div.className = "card";

  if (!State.user) {
    div.innerHTML = `
      <h2>Добро пожаловать в Skillbase</h2>
      <p>Войдите или зарегистрируйтесь, чтобы проходить тесты.</p>
      <div class="btn-row"><a class="btn" href="#login">Вход</a><a class="btn btn-secondary" href="#register">Регистрация</a></div>`;
    return div;
  }

  const role = State.profile?.role || "student";
  div.innerHTML = `
    <h2>Добро пожаловать</h2>
    <p>${escapeHtml(State.user.email)}<br><span class="muted">Роль: ${ROLE[role] || escapeHtml(role)} · Организация: ${escapeHtml(State.profile?.orgId || "")}</span></p>
    <div class="stack">
      <a class="btn" href="#tests">${isStaff() ? "Мои тесты" : "Пройти тест"}</a>
      ${isStaff() ? `<a class="btn" href="#create-test">Создать тест</a>` : ""}
      <a class="btn btn-secondary" href="#results">${isStaff() ? "Результаты учеников" : "Мои результаты"}</a>
      ${role === "admin" ? `<a class="btn btn-secondary" href="#users">Пользователи и роли</a>` : ""}
    </div>`;
  return div;
}
