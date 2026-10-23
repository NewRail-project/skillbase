import { State, isStaff } from "../../core/auth.js";
import { escapeHtml } from "../../shared/utils.js";
import { empty } from "../../ui/components/empty.js";
import { error } from "../../ui/components/error.js";
import { listMyTests } from "../../core/editor.js";
import { listMyAttempts, listOrgAttempts } from "../../core/attempts.js";

const ROLE = { student: "студент", teacher: "преподаватель", admin: "администратор" };

function tile(title, count, href, isMain) {
  return `
    <a class="tile ${isMain ? "tile-main" : ""}" href="${href}">
      <div class="tile-value">${count}</div>
      <div class="tile-label">${title}</div>
    </a>`;
}

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
  const orgId = State.profile?.orgId || "";
  const uid = State.user.uid;

  // Загружаем данные асинхронно
  Promise.all([
    isStaff() ? listMyTests(uid) : listMyAttempts(uid),
    isStaff() ? listOrgAttempts(orgId) : null
  ]).then(([testsOrAttempts, orgAttempts]) => {
    if (isStaff()) {
      const tests = testsOrAttempts || [];
      const awaiting = (orgAttempts || []).filter(a => a.status === "submitted" || a.status === "pending");
      div.innerHTML = `
        <h2>Добро пожаловать</h2>
        <p>${escapeHtml(State.user.email)}<br><span class="muted">Роль: ${ROLE[role] || escapeHtml(role)} · Организация: ${escapeHtml(orgId)}</span></p>
        <div class="stack">
          <div class="tiles">
            ${tile("Мои тесты", tests.length, "#tests", true)}
            ${tile("Ожидают проверки", awaiting.length, "#results")}
          </div>
          <a class="btn" href="#create-test">Создать тест</a>
          ${role === "admin" ? `<a class="btn btn-secondary" href="#users">Пользователи и роли</a>` : ""}
        </div>`;
    } else {
      const attempts = testsOrAttempts || [];
      const passed = attempts.filter(a => a.status === "graded" || a.status === "passed").length;
      const pending = attempts.filter(a => a.status === "submitted" || a.status === "pending").length;
      div.innerHTML = `
        <h2>Добро пожаловать</h2>
        <p>${escapeHtml(State.user.email)}<br><span class="muted">Роль: ${ROLE[role] || escapeHtml(role)} · Организация: ${escapeHtml(orgId)}</span></p>
        <div class="stack">
          <div class="tiles">
            ${tile("Мои результаты", passed, "#results", true)}
            ${tile("Ждут проверки", pending, "#results")}
          </div>
          <a class="btn" href="#tests">Пройти тест</a>
        </div>`;
    }
  }).catch((err) => {
    console.error("Home data error:", err);
    div.replaceChildren(error({ text: "Ошибка загрузки данных: " + (err.message || err) }));
  });

  // Показываем загрузку до получения данных
  div.innerHTML = `
    <h2>Добро пожаловать</h2>
    <p>${escapeHtml(State.user.email)}<br><span class="muted">Роль: ${ROLE[role] || escapeHtml(role)} · Организация: ${escapeHtml(orgId)}</span></p>
    <div class="stack">
      <div class="tiles">
        <div class="tile"><div class="tile-value">...</div><div class="tile-label">Загрузка...</div></div>
        <div class="tile"><div class="tile-value">...</div><div class="tile-label">Загрузка...</div></div>
      </div>
      <a class="btn" href="#tests">${isStaff() ? "Мои тесты" : "Пройти тест"}</a>
      ${isStaff() ? `<a class="btn" href="#create-test">Создать тест</a>` : ""}
      ${role === "admin" ? `<a class="btn btn-secondary" href="#users">Пользователи и роли</a>` : ""}
    </div>`;

  return div;
}