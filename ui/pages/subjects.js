import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { getSubjects, createSubject } from "../../core/subjects.js";

export default async function SubjectsPage() {
  const page = h("div", { class: "page" });
  page.appendChild(h("h1", {}, "Предметы"));

  const subjects = await getSubjects();
  
  const list = h("div", { class: "card" });
  subjects.forEach(s => {
    list.appendChild(h("div", { class: "item" }, 
      h("b", {}, s.title),
      h("p", {}, s.description || "Без описания")
    ));
  });
  
  page.appendChild(list);

  // Simple add button (minimalist)
  const addBtn = h("button", { class: "primary", onclick: async () => {
    const title = prompt("Название предмета");
    if (title) {
        await createSubject({ title });
        window.location.reload();
    }
  }}, "Добавить предмет");
  
  page.appendChild(addBtn);

  return page;
}