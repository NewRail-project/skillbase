// ui/pages/teacher-dashboard.js

// Загрузка результатов преподавателя
const getTeacherResults = async (testId) => {
  // TODO: Заменить на Firestore-запрос
  return [];
};

// DOM-элемент для панели преподавателя
async function TeacherDashboardPage() {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = "<h2>Панель преподавателя</h2><div id='results'></div>";

  try {
    const results = await getTeacherResults('testId');
    const resultsDiv = div.querySelector('#results');
    resultsDiv.innerHTML = results.map(r => {
      return `<div class="card">` +
        `<p>Тест: ${r.testId}</p>` +
        `<p>Баллы: ${r.score}</p>` +
        `<button class="primary" onclick="window.location.hash='#teacher-results/${r.testId}'">Детали</button>` +
        `</div>`;
    }).join("");
  } catch (e) {
    div.querySelector('#results').innerHTML = "Ошибка загрузки.";
  }

  return div;
}
export default TeacherDashboardPage;