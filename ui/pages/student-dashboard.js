// STATUS: stub, будет заменён на этапе 5.
import { h, esc } from "../../shared/dom.js";
import { t as tr, lt } from "../../core/i18n.js";
import { loading } from "../components/loading.js";
import { error as errorState } from "../components/error.js";

const getStudentAssignments = async (groupId) => {
  // TODO: Заменить на Firestore-запрос
  return [];
};

async function StudentDashboardPage() {
  const div = h("div", { class: "card" });
  div.append(h("h2", {}, lt("asg.title")));
  const list = h("div", { id: "list" }, loading());
  div.append(list);

  async function load() {
    list.replaceChildren(loading());
    try {
      const assignments = await getStudentAssignments('groupId');
      list.textContent = "";
      if (!assignments.length) {
        list.append(h("p", { class: "muted" }, lt("asg.emptyTitle")));
        return;
      }
      assignments.forEach(a => {
        const card = h("div", { class: "card" });
        card.append(
          h("h3", {}, tr("guest.testLabel") + esc(a.testId)),
          h("p", {}, "Дедлайн: " + new Date(a.deadline.seconds * 1000).toLocaleString()),
          h("button", { class: "primary", onclick: () => { window.location.hash = '#quiz/' + a.testId; } }, "Начать")
        );
        list.appendChild(card);
      });
    } catch (e) {
      console.error("Панель студента:", e);
      list.replaceChildren(errorState({
        text: "Не удалось загрузить задания. Проверьте подключение к сети.",
        onRetry: load // повтор без перезагрузки страницы
      }));
    }
  }

  await load();
  return div;
}
export default StudentDashboardPage;
