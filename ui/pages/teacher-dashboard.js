// ui/pages/teacher-dashboard.js
import { useAuth } from '../authContext.js';
import { getTeacherResults } from '../../core/assign.js';

export default async function() {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = "<h2>Панель преподавателя</h2><div id='results'></div>";
  
  try {
    const results = await getTeacherResults('testId');
    const resultsDiv = div.querySelector('#results');
    resultsDiv.innerHTML = results.map(r => `
      <div class="card">
        <p>Тест: ${r.testId}</p>
        <p>Баллы: ${r.score}</p>
        <button onclick="window.location.hash='#teacher-results/${r.testId}'">Детали</button>
      </div>
    `).join("");
  } catch (e) {
    div.querySelector('#results').innerHTML = "Ошибка загрузки.";
  }
  return div;
}