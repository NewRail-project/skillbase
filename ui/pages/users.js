// ui/pages/users.js
import { useAuth } from '../authContext.js';

export default function UsersComponent() {
  const { user } = useAuth();
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `
    <h2>Управление пользователями</h2>
    <div id="users-list">
      <p>Список пользователей будет загружен здесь...</p>
    </div>
  `;
  return div;
}