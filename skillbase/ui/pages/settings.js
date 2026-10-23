// STATUS: stub, будет заменён на этапе 3.
import { h, esc } from "../../shared/dom.js";
import { State } from "../../core/auth.js";

// Обновление профиля
const updateProfileData = async (newData) => {
  // TODO: Заменить на Firestore-запрос
};

function SettingsPage() {
  const div = h("div", { class: "card" });
  const user = State.user;
  const email = user?.email ?? '';

  div.append(
    h("h2", {}, "Настройки"),
    h("form", { id: "settings-form" },
      h("div", { class: "form-group" },
        h("label", { for: "email" }, "Email"),
        h("input", { type: "email", id: "email", value: esc(email), readonly: true, class: "form-control" })
      ),
      h("div", { class: "form-group" },
        h("label", { for: "role" }, "Роль"),
        h("select", { id: "role", disabled: true, class: "form-control" },
          h("option", { value: "student" }, "Студент"),
          h("option", { value: "teacher" }, "Преподаватель"),
          h("option", { value: "admin" }, "Администратор")
        )
      ),
      h("button", { type: "submit", class: "primary" }, "Сохранить")
    )
  );

  const form = div.querySelector('#settings-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const role = div.querySelector('#role').value;
    try {
      await updateProfileData({ role });
      alert('Настройки сохранены');
    } catch (e) {
      alert('Ошибка: ' + e.message);
    }
  });

  return div;
}
export default SettingsPage;