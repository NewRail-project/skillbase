// ui/pages/admin-panel.js
import { useAuth } from '../authContext.js';

export default function AdminPanelComponent() {
  const { user } = useAuth();
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `
    <h2>Админ-панель</h2>
    <div id="admin-content">
      <p>Добро пожаловать, администратор!</p>
      <button onclick="window.location.hash='#create-test'">Создать тест</button>
      <button onclick="window.location.hash='#users'">Управление пользователями</button>
    </div>
  `;
  return div;
}