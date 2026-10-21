// ui/pages/users.js

// Загрузка пользователей
const getUsers = async () => {
  // TODO: Заменить на Firestore-запрос
  return [];
};

// DOM-элемент для управления пользователями
function UsersPage() {
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
export default UsersPage;