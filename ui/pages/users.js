import { State } from "../../core/auth.js";
import { db, collection, getDocs, doc, updateDoc } from "../../shared/firebase.js";
import { escapeHtml } from "../../shared/utils.js";
import { empty } from "../../ui/components/empty.js";
import { error } from "../../ui/components/error.js";
import { confirm } from "../../ui/components/confirm.js";

const ROLES = [
  ["student", "Студент"],
  ["teacher", "Преподаватель"],
  ["admin", "Администратор"]
];

function userCard(user) {
  return `
    <div class="user-card" data-id="${user.id}">
      <div class="user-info">
        <h3>${escapeHtml(user.email || user.id)}</h3>
        <p class="muted">Организация: ${escapeHtml(user.orgId || "")}</p>
      </div>
      <div class="role-selector">
        <select class="role">
          ${ROLES.map(([value, label]) =>
            `<option value="${value}" ${user.role === value ? "selected" : ""}>${label}</option>`
          ).join("")}
        </select>
        <button type="button" class="save" ${user.id === State.user.uid ? "disabled title='Свою роль менять нельзя'" : ""}>Сохранить</button>
      </div>
      <p class="status-msg"></p>
    </div>`;
}

export default async function () {
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
      <h2>Пользователи и роли</h2>
    </div>
    <div id="list" class="user-list"></div>
  `;
  const list = div.querySelector("#list");

  try {
    const snap = await getDocs(collection(db, "users"));
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.email || "").localeCompare(b.email || ""));
    
    if (!users.length) {
      list.replaceChildren(empty({
        text: "Нет пользователей для отображения.",
        icon: "users"
      }));
      return div;
    }
    
    list.innerHTML = users.map(user => userCard(user)).join("");
  } catch (e) {
    console.error(e);
    list.replaceChildren(error({
      text: "Не удалось загрузить: " + (e.code || e.message),
      retryText: "Повторить"
    }));
  }

  div.addEventListener("click", async (e) => {
    const btn = e.target.closest(".save");
    if (!btn) return;
    
    const card = btn.closest(".user-card");
    const msg = card.querySelector(".status-msg");
    const roleSelect = card.querySelector(".role");
    const newRole = roleSelect.value;
    
    confirm({
      text: `Изменить роль пользователя на ${ROLES.find(([v]) => v === newRole)[1]}?`,
      actionText: "Да",
      cancelText: "Отмена",
      onConfirm: async () => {
        btn.disabled = true;
        try {
          await updateDoc(doc(db, "users", card.dataset.id), { role: newRole });
          msg.className = "success-msg";
          msg.textContent = "Роль сохранена";
        } catch (err) {
          msg.className = "error-msg";
          msg.textContent = "Ошибка: " + (err.code || err.message);
        }
        btn.disabled = false;
      }
    });
  });

  return div;
}