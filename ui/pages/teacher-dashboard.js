// STATUS: stub, будет заменён на этапе 6.
import { h, esc } from "../../shared/dom.js";
import { State } from "../../core/auth.js";

const getTeacherResults = async (testId) => {
  // TODO: Заменить на Firestore-запрос
  return [];
};

async function TeacherDashboardPage() {
  const div = h("div", { class: "card" });
  div.append(h("h2", {}, "Панель преподавателя"), h("div", { id: "results" }));

  try {
    const results = await getTeacherResults('testId', State.profile?.teacherGroups || null);
    const resultsDiv = div.querySelector('#results');
    resultsDiv.textContent = "";
    results.forEach(r => {
      const card = h("div", { class: "card" });
      card.append(
        h("p", {}, "Тест: " + esc(r.testId)),
        h("p", {}, "Баллы: " + esc(String(r.score ?? ''))),
        h("button", { class: "primary", onclick: () => { window.location.hash = '#teacher-results/' + r.testId; } }, "Детали")
      );
      resultsDiv.appendChild(card);
    });
  } catch (e) {
    div.querySelector('#results').textContent = "Ошибка загрузки.";
  }

  return div;
}
export default TeacherDashboardPage;