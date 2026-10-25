import { State } from "../../core/auth.js";
import { db, collection, getDocs, doc, updateDoc } from "../../shared/firebase.js";
import { escapeHtml } from "../../shared/utils.js";

const ROLES = [["student", "Студент"], ["teacher", "Преподаватель"], ["admin", "Администратор"]];

export default async function () {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `<h2>Пользователи и роли</h2><div id="list" class="stack"><div class="spinner"></div></div>`;
  const list = div.querySelector("#list");

  try {
    const snap = await getDocs(collection(db, "users"));
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.email || "").localeCompare(b.email || ""));
    list.innerHTML = users.map(u => `
      <div class="item" data-id="${u.id}">
        <h3>${escapeHtml(u.email || u.id)}</h3>
        <select class="role">${ROLES.map(([v, t]) => `<option value="${v}" ${u.role === v ? "selected" : ""}>${t}</option>`).join("")}</select>
        <button type="button" class="save" ${u.id === State.user.uid ? "disabled title='Свою роль менять нельзя'" : ""}>Сохранить роль</button>
        <p class="muted msg"></p>
      </div>`).join("");
  } catch (e) {
    console.error(e);
    list.innerHTML = `<p class="error-msg">Не удалось загрузить: ${escapeHtml(e.code || e.message)}</p>`;
  }

  div.addEventListener("click", async (e) => {
    const btn = e.target.closest(".save");
    if (!btn) return;
    const item = btn.closest(".item");
    const msg = item.querySelector(".msg");
    btn.disabled = true;
    try {
      await updateDoc(doc(db, "users", item.dataset.id), { role: item.querySelector(".role").value });
      msg.textContent = "Сохранено";
    } catch (err) {
      msg.textContent = "Ошибка: " + (err.code || err.message);
    }
    btn.disabled = false;
  });

  return div;
}
