// ui/pages/student-dashboard.js
import { useAuth } from '../authContext.js';
import { getStudentAssignments } from '../../core/assign.js';

export default async function() {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = "<h2>Мои задания</h2><div id='list'>Загрузка...</div>";
  
  try {
    const assignments = await getStudentAssignments('groupId');
    const list = div.querySelector('#list');
    list.innerHTML = assignments.map(a => `
      <div class="card">
        <h3>Тест: ${a.testId}</h3>
        <p>Дедлайн: ${new Date(a.deadline.seconds * 1000).toLocaleString()}</p>
        <button onclick="window.location.hash='#quiz/${a.testId}'">Начать</button>
      </div>
    `).join("");
  } catch (e) {
    div.querySelector('#list').innerHTML = "Ошибка загрузки.";
  }
  return div;
}