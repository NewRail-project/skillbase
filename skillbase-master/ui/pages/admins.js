import { h } from "../../shared/dom.js";
import { State, isAdmin } from "../../core/auth.js";
import { listOrgUsers, setUserRole } from "../../core/admins.js";
import {
  ADMIN_ROLE,
  ROLE_LABELS,
  REVOKE_ROLES,
  canAssignAdmin,
  canRevokeAdmin,
  countAdmins,
  findUserByEmail,
  roleAfterRevoke
} from "../../core/admin-roles.js";
import { displayName } from "../../core/profile.js";
import { confirmAction } from "../../ui/components/confirm.js";
import { toast } from "../../ui/components/toast.js";
import { icons } from "../../shared/icons.js";

function roleBadge(role) {
  const tone = role === "admin" ? "badge-success" : role === "teacher" ? "badge-info" : "badge-neutral";
  return h("span", { class: `badge ${tone}` }, ROLE_LABELS[role] || "—");
}

function userDetails(user) {
  return h("div", { class: "field-grid" },
    h("div", { class: "field" },
      h("span", { class: "muted" }, "ФИО"),
      h("span", { class: "value" }, displayName(user, { viewerIsStaff: true, uid: user.uid }))
    ),
    h("div", { class: "field" },
      h("span", { class: "muted" }, "Email"),
      h("span", { class: "value" }, user.email || "—")
    ),
    h("div", { class: "field" },
      h("span", { class: "muted" }, "Текущая роль"),
      roleBadge(user.role)
    ),
    h("div", { class: "field" },
      h("span", { class: "muted" }, "Организация"),
      h("span", { class: "value" }, user.orgId || "—")
    )
  );
}

function errorText(err) {
  if (err?.code === "permission-denied") {
    return "Нет прав на изменение роли. Проверьте, что вы администратор этой организации.";
  }
  if (err?.code === "unavailable") {
    return "Нет связи с Firestore. Проверьте подключение к интернету.";
  }
  return err?.message || "Не удалось изменить роль. Попробуйте ещё раз.";
}

export default async function AdminsPage() {
  const page = h("div", { class: "page" });

  if (!isAdmin()) {
    page.append(h("div", { class: "panel" },
      h("div", { class: "empty-state" },
        h("div", { class: "empty-state-icon", innerHTML: icons.users }),
        h("h2", {}, "Раздел доступен администраторам"),
        h("p", { class: "muted" }, "Управлять администраторами может только действующий администратор организации."),
        h("a", { class: "btn secondary", href: "#/" }, "На главную")
      )
    ));
    return page;
  }

  const actor = {
    ...(State.profile || {}),
    uid: State.user.uid,
    email: State.user.email || State.profile?.email || ""
  };

  let users = [];
  let loading = true;
  let loadError = null;
  let searchedEmail = "";
  let found = null;

  const searchInput = h("input", {
    type: "search",
    id: "admin-search-email",
    placeholder: "user@example.com",
    autocomplete: "off",
    "aria-label": "Email пользователя"
  });
  const searchButton = h("button", { type: "submit", class: "btn primary" }, "Найти");
  const searchError = h("div", { class: "form-error", role: "alert" });

  const searchPanel = h("section", { class: "panel" },
    h("div", { class: "section-title" },
      h("h2", {}, "Найти пользователя"),
      h("span", { class: "muted" }, "Только ваша организация")
    ),
    h("p", { class: "muted" }, "Введите email, с которым пользователь зарегистрировался. Роль меняется только в пределах организации."),
    h("form", { class: "filter-bar", novalidate: "novalidate" },
      searchInput,
      searchButton
    ),
    searchError
  );

  const resultBox = h("div", { id: "admin-search-result", "aria-live": "polite" });
  const listBox = h("div", { id: "admin-list" });

  page.append(
    h("div", { class: "page-head" },
      h("div", {},
        h("div", { class: "eyebrow" }, "Управление"),
        h("h1", {}, "Администраторы"),
        h("p", { class: "page-sub" }, "Назначение и снятие административной роли в вашей организации.")
      ),
      h("div", { class: "page-head-actions" },
        h("span", { class: "badge badge-info" }, actor.orgId || "—")
      )
    ),
    searchPanel,
    resultBox,
    h("section", { class: "panel" },
      h("div", { class: "section-title" },
        h("h2", {}, "Администраторы организации"),
        h("span", { class: "muted", id: "admin-count" }, "")
      ),
      listBox
    ),
    h("p", { class: "muted", style: "font-size:.875rem" },
      "Первый администратор создаётся вручную в Firebase Console — см. docs/FIREBASE_SETUP.md. ",
      "Правила Firestore не разрешают менять роль самому себе, поэтому последний администратор не может снять права с себя."
    )
  );

  function adminCount() {
    return countAdmins(users, actor.orgId);
  }

  function drawResult() {
    resultBox.textContent = "";
    if (!searchedEmail) return;

    if (!found) {
      resultBox.append(h("section", { class: "panel" },
        h("div", { class: "empty-state" },
          h("h2", {}, "Пользователь не найден"),
          h("p", { class: "muted" }, `В организации ${actor.orgId || ""} нет пользователя с email «${searchedEmail}». Проверьте адрес или попросите пользователя зарегистрироваться.`)
        )
      ));
      return;
    }

    const actions = h("div", { class: "btn-row" });
    if (found.role === ADMIN_ROLE) {
      actions.append(h("span", { class: "badge badge-success" }, "Уже администратор"));
      if (found.uid !== actor.uid) {
        actions.append(h("button", {
          type: "button",
          class: "btn danger",
          onclick: () => revoke(found)
        }, "Снять роль администратора"));
      } else {
        actions.append(h("span", { class: "muted" }, "Это вы — снять роль с себя нельзя."));
      }
    } else {
      actions.append(h("button", {
        type: "button",
        class: "btn primary",
        onclick: () => promote(found)
      }, "Назначить администратором"));
    }

    resultBox.append(h("section", { class: "panel" },
      h("div", { class: "section-title" },
        h("h2", {}, "Найденный пользователь"),
        roleBadge(found.role)
      ),
      userDetails(found),
      actions
    ));
  }

  function drawList() {
    listBox.textContent = "";
    if (loading) {
      listBox.append(h("div", { class: "panel-body" }, h("div", { class: "spinner" })));
      return;
    }
    const count = adminCount();
    const countNode = page.querySelector("#admin-count");
    if (countNode) {
      countNode.textContent = count === 1 ? "1 администратор" : `${count} администраторов`;
    }

    const admins = users
      .filter(user => user.role === ADMIN_ROLE)
      .sort((a, b) => displayName(a, { viewerIsStaff: true, uid: a.uid })
        .localeCompare(displayName(b, { viewerIsStaff: true, uid: b.uid }), "ru"));

    if (!admins.length) {
      listBox.append(h("p", { class: "muted" }, "В организации пока нет администраторов."));
      return;
    }

    const list = h("div", { class: "list" });
    admins.forEach(user => {
      const name = displayName(user, { viewerIsStaff: true, uid: user.uid });
      const isSelf = user.uid === actor.uid;
      const end = h("div", { class: "list-row-end" },
        roleBadge(user.role),
        isSelf
          ? h("span", { class: "muted", style: "margin-left:8px" }, "это вы")
          : h("button", {
            type: "button",
            class: "btn secondary",
            style: "margin-left:8px",
            onclick: () => revoke(user)
          }, "Снять роль")
      );

      list.append(h("div", { class: "list-row" },
        h("div", { class: "avatar avatar-sm", "aria-hidden": "true" }, (name[0] || "U").toUpperCase()),
        h("div", { class: "list-row-main" },
          h("div", { class: "list-row-title" }, name),
          h("div", { class: "list-row-sub" }, user.email || "—")
        ),
        end
      ));
    });
    listBox.append(list);
  }

  function drawAll() {
    drawResult();
    drawList();
  }

  async function promote(target) {
    const check = canAssignAdmin({ actor, target, users });
    if (!check.ok) {
      toast(check.error, "error");
      return;
    }

    const confirmed = await confirmAction({
      title: "Назначить администратором?",
      text: "Пользователь получит права администратора только в вашей организации: управление ролями и доступ к результатам.",
      details: [userDetails(target)],
      confirmLabel: "Назначить",
      tone: "primary"
    });
    if (!confirmed) return;

    try {
      await setUserRole(target.uid, ADMIN_ROLE);
      target.role = ADMIN_ROLE;
      toast(`${displayName(target, { viewerIsStaff: true, uid: target.uid })} — администратор`, "success");
      drawAll();
    } catch (err) {
      console.error("Назначение администратора:", err);
      toast(errorText(err), "error");
    }
  }

  async function revoke(target) {
    const check = canRevokeAdmin({ actor, target, users });
    if (!check.ok) {
      toast(check.error, "error");
      return;
    }

    const roleSelect = h("select", { id: "revoke-role", "aria-label": "Роль после снятия" },
      ...REVOKE_ROLES.map(role => h("option", { value: role }, ROLE_LABELS[role]))
    );
    roleSelect.value = "teacher";

    const confirmed = await confirmAction({
      title: "Снять роль администратора?",
      text: "Пользователь потеряет доступ к управлению ролями, но останется в организации. Выберите, какая роль останется.",
      details: [
        userDetails(target),
        h("div", { class: "field" },
          h("label", { for: "revoke-role" }, "Оставить роль"),
          roleSelect
        )
      ],
      confirmLabel: "Снять роль",
      tone: "danger"
    });
    if (!confirmed) return;

    try {
      const nextRole = roleAfterRevoke(roleSelect.value);
      await setUserRole(target.uid, nextRole);
      target.role = nextRole;
      toast(`Роль администратора снята. Осталась роль: ${ROLE_LABELS[nextRole].toLowerCase()}`, "success");
      drawAll();
    } catch (err) {
      console.error("Снятие роли администратора:", err);
      toast(errorText(err), "error");
    }
  }

  searchPanel.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    searchError.textContent = "";
    if (loading) return;
    if (loadError) {
      searchError.textContent = "Список пользователей ещё не загружен.";
      return;
    }

    const email = searchInput.value.trim();
    if (!email) {
      searchError.textContent = "Введите email пользователя.";
      searchInput.focus();
      return;
    }

    searchedEmail = email;
    found = findUserByEmail(users, email);
    drawResult();
    if (!found) searchInput.focus();
  });

  listBox.append(h("div", { class: "panel-body" }, h("div", { class: "spinner" })));

  try {
    users = await listOrgUsers(actor.orgId);
    loading = false;
    drawAll();
  } catch (err) {
    console.error("Список пользователей:", err);
    loading = false;
    loadError = err;
    listBox.textContent = "";
    listBox.append(h("div", { class: "empty-state" },
      h("div", { class: "empty-state-icon", innerHTML: icons.users }),
      h("h2", {}, "Список недоступен"),
      h("p", { class: "muted" }, err?.code === "permission-denied"
        ? "Правила Firestore не разрешают читать пользователей организации."
        : "Не удалось загрузить пользователей. Проверьте подключение к сети."),
      h("button", { type: "button", class: "btn secondary", onclick: () => window.location.reload() }, "Повторить")
    ));
  }

  return page;
}
