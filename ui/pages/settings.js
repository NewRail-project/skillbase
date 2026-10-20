// ui/pages/settings.js
import { useAuth } from '../authContext.js';
import { updateProfileData } from '../../core/auth.js';

export default function SettingsComponent() {
  const { user } = useAuth();
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `
    <h2>Настройки</h2>
    <form id="settings-form">
      <label>Email:</label>
      <input type="email" value="${user.email}" readonly />
      
      <label>Роль:</label>
      <select id="role" disabled>
        <option value="student">Студент</option>
        <option value="teacher">Преподаватель</option>
        <option value="admin">Администратор</option>
      </select>
      
      <button type="submit">Сохранить</button>
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