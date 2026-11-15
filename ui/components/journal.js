// ui/components/journal.js — Переиспользуемые компоненты для электронного журнала.
//
// Включает:
//   — journalTable: адаптивная таблица оценок для мобильных и десктопов
//   — gradeEditorModal: диалог ручной правки оценки с сохранением истории
//   — attendanceModal: диалог отметки посещаемости (present/absent/late/excused)
//   — journalExportButton: кнопка экспорта данных в CSV

import { h } from "../../shared/dom.js";
import { modal } from "./modal.js";
import { toast } from "./toast.js";
import { icons } from "../../shared/icons.js";
import { ATTENDANCE_STATUS, GRADE_SOURCE } from "../../core/journal-logic.js";

/**
 * Адаптивная таблица журнала.
 * @param {Object} props
 * @param {Array<string>} props.headers - названия колонок
 * @param {Array<Object>} props.rows - данные строк
 * @param {Function} [props.onEditGrade] - колбэк при клике на оценку для редактирования
 * @param {Function} [props.onMarkAttendance] - колбэк при клике на посещаемость
 * @param {boolean} [props.isStaff] - признак сотрудника (для отображения кнопок действий)
 */
export function journalTable({ headers = [], rows = [], onEditGrade = null, onMarkAttendance = null, isStaff = false } = {}) {
  if (!rows.length) {
    return h("div", { class: "empty-state" },
      h("div", { class: "empty-state-icon", innerHTML: icons.book }),
      h("h3", {}, "Записи не найдены"),
      h("p", { class: "muted" }, "В выбранном виде журнала пока нет данных.")
    );
  }

  return h("div", { class: "journal-table-wrapper" },
    h("table", { class: "journal-table" },
      h("thead", {},
        h("tr", {},
          headers.map((hdr, i) => h("th", { key: i }, hdr)),
          isStaff ? h("th", {}, "Действия") : null
        )
      ),
      h("tbody", {},
        rows.map((row, idx) => h("tr", { key: row.id || idx },
          headers.map((_, colIdx) => renderTableCell(row, colIdx, onEditGrade, onMarkAttendance, isStaff)),
          isStaff ? h("td", { class: "actions-cell" },
            onEditGrade ? h("button", {
              type: "button",
              class: "btn text small",
              title: "Изменить оценку",
              onclick: () => onEditGrade(row)
            }, "Правка") : null,
            onMarkAttendance ? h("button", {
              type: "button",
              class: "btn text small secondary",
              title: "Отметить посещаемость",
              onclick: () => onMarkAttendance(row)
            }, "Н/П") : null
          ) : null
        ))
      )
    )
  );
}

function renderTableCell(row, colIdx, onEditGrade, onMarkAttendance, isStaff) {
  // Формируем значение в зависимости от индексов или свойств
  const keys = Object.keys(row);
  const key = keys[colIdx] || "";
  let val = row[key];

  if (key === "grade" || key === "testGrade" || key === "overallGrade") {
    const formatted = val !== null && val !== undefined ? String(val) : "—";
    if (isStaff && onEditGrade) {
      return h("td", { class: "grade-cell clickable", onclick: () => onEditGrade(row) },
        h("span", { class: `grade-badge ${gradeClass(val)}` }, formatted)
      );
    }
    return h("td", { class: "grade-cell" },
      h("span", { class: `grade-badge ${gradeClass(val)}` }, formatted)
    );
  }

  if (key === "attendanceStatus") {
    const statusText = attendanceLabel(val);
    const badgeClass = attendanceClass(val);
    if (isStaff && onMarkAttendance) {
      return h("td", { class: "attendance-cell clickable", onclick: () => onMarkAttendance(row) },
        h("span", { class: `badge ${badgeClass}` }, statusText)
      );
    }
    return h("td", { class: "attendance-cell" },
      h("span", { class: `badge ${badgeClass}` }, statusText)
    );
  }

  return h("td", {}, val !== null && val !== undefined ? String(val) : "—");
}

function gradeClass(val) {
  if (val === null || val === undefined) return "neutral";
  const num = Number(val);
  if (num >= 80) return "good";
  if (num >= 60) return "warning";
  return "danger";
}

function attendanceLabel(status) {
  switch (status) {
    case ATTENDANCE_STATUS.PRESENT: return "Присутствовал";
    case ATTENDANCE_STATUS.ABSENT:  return "Отсутствовал";
    case ATTENDANCE_STATUS.LATE:    return "Опоздал";
    case ATTENDANCE_STATUS.EXCUSED: return "Извинён";
    default:                        return status || "—";
  }
}

function attendanceClass(status) {
  switch (status) {
    case ATTENDANCE_STATUS.PRESENT: return "good";
    case ATTENDANCE_STATUS.ABSENT:  return "danger";
    case ATTENDANCE_STATUS.LATE:    return "warning";
    case ATTENDANCE_STATUS.EXCUSED: return "info";
    default:                        return "neutral";
  }
}

/**
 * Диалог ручной правки оценки.
 */
export async function openGradeEditorModal({ studentName = "", currentGrade = 0, onSave = null }) {
  let newGrade = currentGrade;
  let reason = "";

  const confirmed = await modal({
    title: "Ручная правка оценки",
    body: h("div", { class: "journal-dialog" },
      studentName ? h("p", { class: "muted" }, `Студент: ${studentName}`) : null,
      h("div", { class: "field" },
        h("label", { class: "label" }, "Текущая оценка"),
        h("input", { type: "number", class: "input", value: currentGrade, readonly: true })
      ),
      h("div", { class: "field" },
        h("label", { class: "label" }, "Новая оценка (0..100)"),
        h("input", {
          type: "number",
          class: "input",
          min: 0,
          max: 100,
          value: currentGrade,
          oninput: (e) => { newGrade = Number(e.target.value); }
        })
      ),
      h("div", { class: "field" },
        h("label", { class: "label" }, "Причина изменения *"),
        h("textarea", {
          class: "textarea",
          rows: 3,
          placeholder: "Укажите причину правки оценки...",
          oninput: (e) => { reason = e.target.value; }
        })
      )
    ),
    okLabel: "Сохранить правку",
    cancelLabel: "Отмена"
  });

  if (!confirmed) return false;

  if (newGrade < 0 || newGrade > 100) {
    toast("Оценка должна быть от 0 до 100", "error");
    return false;
  }

  if (!reason.trim()) {
    toast("Необходимо указать причину правки", "error");
    return false;
  }

  if (onSave) {
    await onSave({ from: currentGrade, to: newGrade, reason: reason.trim() });
  }

  return true;
}

/**
 * Диалог отметки посещаемости.
 */
export async function openAttendanceModal({ studentName = "", disciplineTitle = "", onSave = null }) {
  let selectedStatus = ATTENDANCE_STATUS.PRESENT;
  let reason = "";

  const confirmed = await modal({
    title: "Отметка посещаемости",
    body: h("div", { class: "journal-dialog" },
      studentName ? h("p", { class: "muted" }, `Студент: ${studentName}`) : null,
      disciplineTitle ? h("p", { class: "muted" }, `Дисциплина: ${disciplineTitle}`) : null,
      h("div", { class: "field" },
        h("label", { class: "label" }, "Статус посещаемости"),
        h("select", {
          class: "select",
          onchange: (e) => { selectedStatus = e.target.value; }
        },
          h("option", { value: ATTENDANCE_STATUS.PRESENT }, "Присутствовал"),
          h("option", { value: ATTENDANCE_STATUS.ABSENT }, "Отсутствовал"),
          h("option", { value: ATTENDANCE_STATUS.LATE }, "Опоздал"),
          h("option", { value: ATTENDANCE_STATUS.EXCUSED }, "Извинён (уважительная причина)")
        )
      ),
      h("div", { class: "field" },
        h("label", { class: "label" }, "Примечание / Причина"),
        h("textarea", {
          class: "textarea",
          rows: 2,
          placeholder: "Дополнительные сведения...",
          oninput: (e) => { reason = e.target.value; }
        })
      )
    ),
    okLabel: "Сохранить",
    cancelLabel: "Отмена"
  });

  if (!confirmed) return false;

  if (onSave) {
    await onSave({ status: selectedStatus, reason: reason.trim() });
  }

  return true;
}

/**
 * Кнопка экспорта журнала в CSV.
 */
export function journalExportButton({ onExport, label = "Экспорт в CSV" } = {}) {
  return h("button", {
    type: "button",
    class: "btn secondary small",
    onclick: onExport
  },
    h("span", { class: "btn-icon", innerHTML: icons.download || "" }),
    h("span", {}, label)
  );
}
