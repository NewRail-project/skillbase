// ui/pages/teacher-results.js
import { h, esc } from "../../shared/dom.js";
import { toCsv } from "../../shared/csv.js";

export function renderTeacherResults(container, { rows = [], onGrade, onExport } = {}) {
  container.textContent = "";
  const section = h("section", { class: "teacher-results" });

  const header = h("header", { class: "tr-header" });
  header.append(h("h2", {}, "Результаты"), h("button", { type: "button", class: "tr-export", onclick: () => onExport?.(rows) }, "Экспорт CSV"));
  section.appendChild(header);

  const wrap = h("div", { class: "tr-table-wrap" });
  const table = h("table", { class: "tr-table" });

  const thead = h("thead");
  thead.appendChild(h("tr", {},
    h("th", {}, "Ученик"),
    h("th", {}, "Тест"),
    h("th", {}, "Балл"),
    h("th", {}, "Статус"),
    h("th", {})
  ));
  table.appendChild(thead);

  const tbody = h("tbody");
  rows.forEach((r, i) => {
    const tr = h("tr", { "data-index": String(i) });
    tr.append(
      h("td", {}, esc(r.student ?? '')),
      h("td", {}, esc(r.test ?? '')),
      h("td", {}, r.score ?? '—'),
      h("td", {}, r.verified ? 'проверено' : 'ожидает'),
      h("td", {},
        r.verified ? null : h("button", { type: "button", class: "tr-grade", "data-index": String(i), onclick: () => onGrade?.(rows[i]) }, "Проверить")
      )
    );
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  section.appendChild(wrap);
  container.appendChild(section);
}

export { toCsv };