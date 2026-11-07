import { h } from "../../shared/dom.js";
import { State, isAdmin } from "../../core/auth.js";
import { displayName } from "../../core/profile.js";
import { icons } from "../../shared/icons.js";
import { toast } from "../../ui/components/toast.js";
import { confirmAction } from "../../ui/components/confirm.js";
import { db, collection, doc, getDocs, query, where, updateDoc, serverTimestamp } from "../../shared/firebase.js";
import { t as tr, lt, roleLabel } from "../../core/i18n.js";


// Правило users позволяет администратору менять роль и подразделение
// только сотрудникам своей организации.
export default async function UsersPage() {
  const page = h("div", { class: "page" });
  const admin = isAdmin();

  page.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Организация"),
      h("h1", {}, lt("usr.title")),
      h("p", { class: "page-sub" }, admin
        ? lt("usr.sub")
        : lt("usr.subStaff"))
    ),
    admin
      ? h("div", { class: "page-head-actions" },
        h("a", { class: "btn secondary", href: "#admins" }, "Управление администраторами"))
      : null
  ));

  const search = h("input", { type: "search", placeholder: "Поиск по ФИО или почте", "aria-label": "Поиск сотрудников" });
  const roleFilter = h("select", { "aria-label": "Фильтр по роли" },
    h("option", { value: "all" }, "Все роли"),
    h("option", { value: "student" }, lt("role.students")),
    h("option", { value: "teacher" }, lt("role.teachers")),
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
        h("h2", {}, users.length ? "Ничего не найдено" : lt("usr.emptyTitle")),
        h("p", { class: "muted" }, users.length
          ? "Измените запрос или фильтр по роли."
          : "Пользователи появятся после регистрации.")
      ));
      return;
    }

    const wrap = h("div", { class: "table-wrap" });
    const table = h("table", { class: "table" },
      h("thead", {}, h("tr", {},
        h("th", {}, lt("usr.colUser")),
        h("th", {}, "Почта"),
        h("th", {}, "Подразделение"),
        h("th", {}, lt("usr.colGroup")),
        h("th", {}, "Роль")
      ))
    );
    const tbody = h("tbody");

    visible.forEach(user => {
      const name = displayName(user, { viewerIsStaff: true, uid: user.id });
      const roleCell = h("td", {});
      const groupCell = h("td", {});

      if (admin && user.id !== State.user.uid) {
        const select = h("select", {
          "aria-label": `Роль: ${name}`,
          onchange: async (e) => {
            const next = e.target.value;
            if (next === user.role) return;
            // Назначение администратора подтверждаем отдельно: это расширение
            // прав, а не рядовая правка роли.
            if (next === "admin") {
              const confirmed = await confirmAction({
                title: "Назначить администратором?",
                text: `${name} (${user.email || "без email"}) получит права администратора организации ${user.orgId || "—"}.`,
                confirmLabel: "Назначить",
                tone: "primary"
              });
              if (!confirmed) {
                select.value = user.role || "student";
                return;
              }
            }
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
          h("option", { value: "student" }, lt("role.student")),
          h("option", { value: "teacher" }, lt("role.teacher")),
          h("option", { value: "admin" }, "Администратор")
        );
        // Для <select> значение задаётся свойством, а не атрибутом.
        select.value = user.role || "student";
        roleCell.appendChild(select);
      } else {
        roleCell.appendChild(h("span", { class: "badge badge-neutral" }, () => (user.role ? roleLabel(user.role) : "—")));
      }

      if (admin && user.id !== State.user.uid) {
        const isTeacher = user.role === "teacher" || user.role === "admin";
        const groupInput = h("input", {
          type: "text",
          value: isTeacher ? (Array.isArray(user.teacherGroups) ? user.teacherGroups.join(", ") : (user.groupId || "")) : (user.groupId || ""),
          maxlength: "200",
          placeholder: isTeacher ? lt("group.csvPlaceholder") : lt("usr.groupPlaceholder"),
          "aria-label": isTeacher ? `${tr("group.teacherGroups")}: ${name}` : `${tr("group")}: ${name}`,
          style: "max-width:180px"
        });
        groupInput.addEventListener("change", async () => {
          const raw = groupInput.value.trim();
          groupInput.disabled = true;
          try {
            if (isTeacher) {
              const groups = raw ? raw.split(",").map(g => g.trim()).filter(Boolean).slice(0, 10) : [];
              await updateDoc(doc(db, "users", user.id), {
                teacherGroups: groups.length ? groups : null,
                updatedAt: serverTimestamp()
              });
              user.teacherGroups = groups.length ? groups : null;
              toast(tr("usr.groupsUpdated"), "success");
            } else {
              const next = raw;
              await updateDoc(doc(db, "users", user.id), {
                groupId: next || null,
                updatedAt: serverTimestamp()
              });
              user.groupId = next || null;
              toast(tr("usr.groupUpdated"), "success");
            }
          } catch (err) {
            console.error("Смена групп:", err);
            toast(tr("usr.groupFail"), "error");
            groupInput.value = isTeacher
              ? (Array.isArray(user.teacherGroups) ? user.teacherGroups.join(", ") : (user.groupId || ""))
              : (user.groupId || "");
          } finally {
            groupInput.disabled = false;
          }
        });
        groupCell.appendChild(groupInput);
      } else {
        const isTeacher = user.role === "teacher" || user.role === "admin";
        const groupsText = isTeacher && Array.isArray(user.teacherGroups) && user.teacherGroups.length
          ? user.teacherGroups.join(", ")
          : (user.groupId || "—");
        groupCell.appendChild(h("span", { class: groupsText !== "—" ? "badge badge-info" : "muted" },
          groupsText));
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
        groupCell,
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
        ? lt("usr.denied")
        : lt("usr.loadFail")),
      h("button", { type: "button", class: "btn secondary", onclick: () => window.location.reload() }, "Повторить")
    ));
  }

  return page;
}
