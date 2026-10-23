import { h } from "../../shared/dom.js";
import { State, isAdmin } from "../../core/auth.js";
import { displayName } from "../../core/profile.js";
import { icons } from "../../shared/icons.js";
import { toast } from "../../ui/components/toast.js";
import { db, collection, doc, getDocs, getDoc, query, where, updateDoc, serverTimestamp } from "../../shared/firebase.js";

const ROLE_LABEL = { student: "Студент", teacher: "Преподаватель", admin: "Администратор" };

// Правило users позволяет администратору менять роль и подразделение
// только сотрудникам своей организации.
export default async function UsersPage() {
  const page = h("div", { class: "page" });
  const admin = isAdmin();

  page.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Организация"),
      h("h1", {}, "Пользователи"),
      h("p", { class: "page-sub" }, admin
        ? "Роли и подразделения сотрудников вашей организации."
        : "Список сотрудников организации. Изменять роли может администратор.")
    )
  ));

  const search = h("input", { type: "search", placeholder: "Поиск по ФИО или почте", "aria-label": "Поиск сотрудников" });
  const roleFilter = h("select", { "aria-label": "Фильтр по роли" },
    h("option", { value: "all" }, "Все роли"),
    h("option", { value: "student" }, "Студенты"),
    h("option", { value: "teacher" }, "Преподаватели"),
    h("option", { value: "admin" }, "Администраторы")
  );
  page.appendChild(h("div", { class: "filter-bar" }, search, roleFilter));

  const panel = h("section", { class: "panel panel-flush" });
  const body = h("div", {});
  panel.appendChild(body);
  page.appendChild(panel);

  let users = [];

  function draw() {
    const text = search.value.trim().toLowerCase();
    const role = roleFilter.value;
    const visible = users.filter(u => {
      const name = displayName(u, { viewerIsStaff: true, uid: u.id }).toLowerCase();
      const email = (u.email || "").toLowerCase();
      const matchesText = !text || name.includes(text) || email.includes(text);
      const matchesRole = role === "all" || u.role === role;
      return matchesText && matchesRole;
    });

    body.textContent = "";
    if (!visible.length) {
      body.appendChild(h("div", { class: "empty-state" },
        h("div", { class: "empty-state-icon", innerHTML: icons.users }),
        h("h2", {}, users.length ? "Ничего не найдено" : "Сотрудников пока нет"),
        h("p", { class: "muted" }, users.length
          ? "Измените запрос или фильтр по роли."
          : "Пользователи появятся после регистрации.")
      ));
      return;
    }

    const wrap = h("div", { class: "table-wrap" });
    const table = h("table", { class: "table" },
      h("thead", {}, h("tr", {},
        h("th", {}, "Сотрудник"),
        h("th", {}, "Почта"),
        h("th", {}, "Подразделение"),
        h("th", {}, "Роль")
      ))
    );
    const tbody = h("tbody");

    visible.forEach(user => {
      const name = displayName(user, { viewerIsStaff: true, uid: user.id });
      const roleCell = h("td", {});

      if (admin && user.id !== State.user.uid) {
        const select = h("select", {
          "aria-label": `Роль: ${name}`,
          onchange: async (e) => {
            const next = e.target.value;
            select.disabled = true;
            try {
              await updateDoc(doc(db, "users", user.id), {
                role: next,
                updatedAt: serverTimestamp()
              });
              user.role = next;
              toast("Роль обновлена", "success");
            } catch (err) {
              console.error("Смена роли:", err);
              toast("Не удалось изменить роль: нет прав или связи", "error");
              select.value = user.role || "student";
            } finally {
              select.disabled = false;
            }
          }
        },
          h("option", { value: "student" }, "Студент"),
          h("option", { value: "teacher" }, "Преподаватель"),
          h("option", { value: "admin" }, "Администратор")
        );
        // Для <select> значение задаётся свойством, а не атрибутом.
        select.value = user.role || "student";
        roleCell.appendChild(select);
      } else {
        roleCell.appendChild(h("span", { class: "badge badge-neutral" }, ROLE_LABEL[user.role] || "—"));
      }

      tbody.appendChild(h("tr", {},
        h("td", {},
          h("div", { class: "user-header" },
            h("div", { class: "avatar avatar-sm", "aria-hidden": "true" },
              (name[0] || "U").toUpperCase()),
            h("div", { class: "profile-info" },
              h("div", { class: "list-row-title" }, name),
              user.position ? h("div", { class: "list-row-sub" }, user.position) : null
            )
          )
        ),
        h("td", { class: "muted" }, user.email || "—"),
        h("td", { class: "muted" }, user.department || "—"),
        roleCell
      ));
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    body.appendChild(wrap);
  }

  search.addEventListener("input", draw);
  roleFilter.addEventListener("change", draw);

  body.appendChild(h("div", { class: "panel-body" }, h("div", { class: "spinner" })));

  try {
    // Правила Firestore разрешают сотруднику читать профили своей организации.
    const snapshot = await getDocs(query(collection(db, "users"), where("orgId", "==", State.profile.orgId)));
    users = snapshot.docs.map(d => ({ ...d.data(), id: d.id }));
    users.sort((a, b) => displayName(a, { viewerIsStaff: true, uid: a.id })
      .localeCompare(displayName(b, { viewerIsStaff: true, uid: b.id }), "ru"));
    draw();
  } catch (err) {
    console.error("Пользователи:", err);
    body.textContent = "";
    body.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "empty-state-icon", innerHTML: icons.users }),
      h("h2", {}, "Список недоступен"),
      h("p", { class: "muted" }, err?.code === "permission-denied"
        ? "Правила Firestore не разрешают чтение списка сотрудников организации."
        : "Не удалось загрузить сотрудников. Проверьте подключение к сети."),
      h("button", { type: "button", class: "btn secondary", onclick: () => window.location.reload() }, "Повторить")
    ));
  }

  return page;
}
