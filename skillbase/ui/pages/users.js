import { h } from "../../shared/dom.js";
import { displayName } from "../../core/profile.js";
import { icons } from "../../shared/icons.js";
import { toast } from "../../ui/components/toast.js";
import { State } from "../../core/auth.js";
import { updateDoc, doc, serverTimestamp } from "../../shared/firebase.js";

const users = [];

async function loadUsers() {
  try {
    const orgId = State.profile.orgId;
    const q = query(collection(db, "users"), where("orgId", "==", orgId));
    const snapshot = await getDocs(q);
    users.length = 0;
    snapshot.docs.forEach(doc => {
      users.push({ id: doc.id, ...doc.data() });
    });
    return users;
  } catch (e) {
    console.error("Ошибка загрузки пользователей:", e);
    return [];
  }
}

export default async function UsersPage() {
  const div = h("div", { class: "card card-2" });
  const usersList = h("div", { class: "users-list" });
  const searchInput = h("input", { type: "text", placeholder: "Поиск по ФИО..." });
  const roleFilter = h("select", { id: "role-filter" },
    h("option", { value: "all" }, "Все"),
    h("option", { value: "student" }, "Студенты"),
    h("option", { value: "teacher" }, "Преподаватели"),
    h("option", { value: "admin" }, "Администраторы")
  );
  const groupFilter = h("select", { id: "group-filter" },
    h("option", { value: "all" }, "Все")
  );

  div.append(
    h("h2", {}, "Управление пользователями"),
    h("div", { class: "filter-controls" },
      searchInput,
      roleFilter,
      groupFilter
    ),
    usersList
  );

  async function renderUsers() {
    const filteredUsers = users.filter(user => {
      const nameMatch = user.fullName.toLowerCase().includes(searchInput.value.toLowerCase());
      const roleMatch = roleFilter.value === "all" || user.role === roleFilter.value;
      return nameMatch && roleMatch;
    });
    
    usersList.textContent = "";
    filteredUsers.forEach(user => {
      const userCard = h("div", { class: "user-card" },
        h("div", { class: "user-header" },
          h("div", { class: "avatar avatar-sm" }, user.fullName[0] || "U"),
          h("div", { class: "user-info" },
            h("span", {}, displayName(user, { viewerIsStaff: true, uid: user.id }))
          )
        ),
        h("div", { class: "user-actions" },
          h("select", {
            id: `role-${user.id}`,
            value: user.role,
            onchange: async (e) => {
              await updateUserRole(user.id, e.target.value);
              toast("Роль обновлена", "success");
            }
          },
            h("option", { value: "student" }, "Студент"),
            h("option", { value: "teacher" }, "Преподаватель"),
            h("option", { value: "admin" }, "Администратор")
          )
        )
      );
      usersList.appendChild(userCard);
    });
  }

  async function updateUserRole(uid, role) {
    try {
      await updateDoc(doc(db, "users", uid), {
        role,
        updatedAt: serverTimestamp()
      });
    } catch (e) {
      toast("Ошибка изменения роли", "error");
    }
  }

  loadUsers().then(renderUsers);
  return div;
}