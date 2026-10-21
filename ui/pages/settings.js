// ui/pages/settings.js

// Обновление профиля
const updateProfileData = async (newData) => {
  // TODO: Заменить на Firestore-запрос
};

// DOM-элемент для настроек
function SettingsPage() {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `
    <h2>Настройки</h2>
    <form id="settings-form">
      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" value="${user.email}" readonly class="form-control" />
      </div>
      <div class="form-group">
        <label for="role">Роль</label>
        <select id="role" disabled class="form-control">
          <option value="student">Студент</option>
          <option value="teacher">Преподаватель</option>
          <option value="admin">Администратор</option>
        </select>
      </div>
      <button type="submit" class="primary">Сохранить</button>
    </form>
  `;

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