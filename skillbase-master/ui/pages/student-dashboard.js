// STATUS: stub, будет заменён на этапе 5.
import { h, esc } from "../../shared/dom.js";

const getStudentAssignments = async (groupId) => {
  // TODO: Заменить на Firestore-запрос
  return [];
};

async function StudentDashboardPage() {
  const div = h("div", { class: "card" });
  div.append(h("h2", {}, "Мои задания"), h("div", { id: "list" }, "Загрузка..."));

  try {
    const assignments = await getStudentAssignments('groupId');
    const list = div.querySelector('#list');
    list.textContent = "";
    if (!assignments.length) {
      list.append(h("p", { class: "muted" }, "Заданий пока нет."));
      return div;
    }
    assignments.forEach(a => {
      const card = h("div", { class: "card" });
      card.append(
        h("h3", {}, "Тест: " + esc(a.testId)),
        h("p", {}, "Дедлайн: " + new Date(a.deadline.seconds * 1000).toLocaleString()),
        h("button", { class: "primary", onclick: () => { window.location.hash = '#quiz/' + a.testId; } }, "Начать")
      );
      list.appendChild(card);
    });
  } catch (e) {
    div.querySelector('#list').textContent = "Ошибка загрузки.";
  }

  return div;
}
export default StudentDashboardPage;