import { getStudentAssignments } from "../../core/assign.js";
import { State } from "../../core/auth.js";

export default async function () {
  const div = document.createElement("div");
  div.className = "card";
  const h = document.createElement("h2");
  h.textContent = "Мои задания";
  const list = document.createElement("div");
  div.append(h, list);

  const show = (text) => { list.textContent = text; };
  const groupId = State.profile?.groupId;

  if (!groupId) {
    show("Вам ещё не назначена группа, поэтому заданий пока нет.");
    return div;
  }

  try {
    const items = await getStudentAssignments(groupId);
    if (!items.length) { show("Активных заданий нет."); return div; }
    list.textContent = "";
    items.forEach((a) => {
      const row = document.createElement("div");
      row.className = "card";
      const t = document.createElement("h3");
      t.textContent = `Тест: ${a.testId}`;
      const d = document.createElement("p");
      d.textContent = a.deadline?.seconds
        ? `Срок: ${new Date(a.deadline.seconds * 1000).toLocaleString("ru-RU")}`
        : "Срок не указан";
      const go = document.createElement("a");
      go.className = "btn primary";
      go.href = `#quiz/${encodeURIComponent(a.testId)}`;
      go.textContent = "Начать";
      row.append(t, d, go);
      list.appendChild(row);
    });
  } catch (e) {
    console.error(e);
    show("Не удалось загрузить задания.");
  }
  return div;
}
