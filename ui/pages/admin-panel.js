// STATUS: stub, будет заменён на этапе 3.
import { h } from "../../shared/dom.js";

function AdminPanelPage() {
  const div = h("div", { class: "card" });
  div.append(
    h("h2", {}, "Админ-панель"),
    h("div", { id: "admin-content" },
      h("p", {}, "Добро пожаловать, администратор!"),
      h("button", { class: "primary", onclick: () => { window.location.hash = '#create-test'; } }, "Создать тест"),
      h("button", { class: "secondary", onclick: () => { window.location.hash = '#users'; } }, "Управление пользователями")
    )
  );
  return div;
}
export default AdminPanelPage;