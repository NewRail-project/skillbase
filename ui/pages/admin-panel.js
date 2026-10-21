// ui/pages/admin-panel.js

// DOM-элемент для админ-панели
function AdminPanelPage() {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `
    <h2>Админ-панель</h2>
    <div id="admin-content">
      <p>Добро пожаловать, администратор!</p>
      <button class="primary" onclick="window.location.hash='#create-test'">Создать тест</button>
      <button class="secondary" onclick="window.location.hash='#users'">Управление пользователями</button>
    </div>
  `;
  return div;
}
export default AdminPanelPage;