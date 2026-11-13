// STATUS: stub, будет заменён на этапе 6.
import { h, esc } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { t as tr, lt } from "../../core/i18n.js";
import { loading } from "../components/loading.js";
import { error as errorState } from "../components/error.js";

const getTeacherResults = async (testId) => {
  // TODO: Заменить на Firestore-запрос
  return [];
};

async function TeacherDashboardPage() {
  const div = h("div", { class: "card" });
  div.append(h("h2", {}, lt("title.teacher")));
  const resultsDiv = h("div", { id: "results" }, loading());
  div.append(resultsDiv);

  async function load() {
    resultsDiv.replaceChildren(loading());
    try {
      const results = await getTeacherResults('testId', State.profile?.teacherGroups || null);
      resultsDiv.textContent = "";
      if (!results.length) {
        resultsDiv.append(h("p", { class: "muted" }, "Пока нет результатов."));
        return;
      }
      results.forEach(r => {
        const card = h("div", { class: "card" });
        card.append(
          h("p", {}, "Тест: " + esc(r.testId)),
          h("p", {}, "Баллы: " + esc(String(r.score ?? ''))),
          // Детали — история теста: "#teacher-results" не существует (404).
          h("button", { class: "primary", onclick: () => { window.location.hash = '#test-history/' + r.testId; } }, "Детали")
        );
        resultsDiv.appendChild(card);
      });
    } catch (e) {
      console.error("Панель преподавателя:", e);
      resultsDiv.replaceChildren(errorState({
        text: "Не удалось загрузить результаты. Проверьте подключение к сети.",
        onRetry: load // повтор без перезагрузки страницы
      }));
    }
  }

  await load();
  return div;
}
export default TeacherDashboardPage;
