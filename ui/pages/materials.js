// ui/pages/materials.js — библиотека материалов (маршрут #materials).
// Единый список всех материалов организации: книги тестов (id = testId)
// и самостоятельные материалы (core/material-library.js) в одной
// коллекции materials/{id}. Сотрудники видят всё и управляют статусами;
// студенты видят только опубликованные (правила Firestore — граница).
// Фильтры: предмет → тема, поиск по названию/описанию.
import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { toast } from "../components/toast.js";
import { confirmAction } from "../components/confirm.js";
import { lt } from "../../core/i18n.js";
import { empty } from "../components/empty.js";
import {
  STATUS_LABEL, MATERIAL_STATUS_DRAFT, MATERIAL_STATUS_PUBLISHED,
  MATERIAL_STATUS_ARCHIVED, visibleMaterials, sortMaterials, isPublished
} from "../../core/material-library-logic.js";
import {
  listMaterials, publishLibraryMaterial, archiveLibraryMaterial
} from "../../core/material-library.js";
import { getSubjects, getTopics } from "../../core/subjects.js";

function role() {
  return State.profile?.role || "";
}

function isStaff() {
  return role() === "teacher" || role() === "admin";
}

// Бейдж статуса: цвет согласован с badge-классами проекта.
function statusBadge(material) {
  const status = material.status || MATERIAL_STATUS_PUBLISHED;
  const cls = status === MATERIAL_STATUS_DRAFT ? "badge"
    : status === MATERIAL_STATUS_ARCHIVED ? "badge badge-warning"
      : "badge badge-success";
  return h("span", { class: cls }, STATUS_LABEL[status] || STATUS_LABEL.published);
}

function kindBadge(material) {
  const badges = [];
  if (material.pdfName) badges.push(h("span", { class: "badge" }, "PDF"));
  return badges;
}

export default async function MaterialsPage() {
  const page = h("div", { class: "page" });
  const staff = isStaff();

  const filterSubject = h("select", {},
    h("option", { value: "" }, "Все предметы"));
  const filterTopic = h("select", { disabled: "disabled" },
    h("option", { value: "" }, "Все темы"));
  const searchInput = h("input", {
    type: "search", placeholder: "Поиск по названию или описанию"
  });

  const listWrap = h("div", { class: "cards-grid" });
  const statusLine = h("div", { class: "form-hint", role: "status" });

  let materials = [];
  let subjects = [];
  const topicsBySubject = new Map();

  function matches(material) {
    const subjectId = filterSubject.value || "";
    const topicId = filterTopic.value || "";
    if (subjectId && material.subjectId !== subjectId) return false;
    if (topicId && material.topicId !== topicId) return false;
    const query = searchInput.value.trim().toLowerCase();
    if (query) {
      const haystack = `${material.title || ""} ${material.description || ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }

  function subjectTitle(id) {
    return subjects.find(s => s.id === id)?.title || "";
  }

  function paintList() {
    listWrap.textContent = "";
    const shown = sortMaterials(materials.filter(matches));
    if (!shown.length) {
      listWrap.appendChild(empty({
        icon: "book",
        text: materials.length ? "Ничего не найдено" : "Материалов пока нет"
      }));
      return;
    }
    shown.forEach(material => listWrap.appendChild(materialCard(material)));
  }

  function materialCard(material) {
    const status = material.status || MATERIAL_STATUS_PUBLISHED;
    const chapters = material.pageCount ? `${material.pageCount} стр.` : "";
    const meta = h("div", { class: "list-row-sub" },
      material.subjectId ? (subjectTitle(material.subjectId) || "Предмет") + (material.topicId ? " · тема" : "") : null,
      chapters,
      material.description ? String(material.description).slice(0, 120) : "");
    const badges = h("div", { class: "btn-row", style: "gap:6px;flex-wrap:wrap" },
      statusBadge(material), ...kindBadge(material));

    const actions = h("div", { class: "btn-row", style: "flex-wrap:wrap" });
    // «Прочитать материал» — добровольный режим читалки (не привязан к
    // попытке). Черновики студентам правилами закрыты.
    if (isPublished(material)) {
      actions.appendChild(h("a", {
        class: "btn primary", href: `#material/${encodeURIComponent(material.id)}/free`
      }, "Прочитать материал"));
    }
    if (material.pdfName) {
      actions.appendChild(h("span", { class: "chip" }, `PDF · ${material.pdfName}`));
    }
    if (staff) {
      actions.appendChild(h("a", {
        class: "btn secondary",
        href: `#material-editor/${encodeURIComponent(material.id)}`
      }, "Редактор"));
      // Статусные кнопки: публикуем черновик, архивируем/возвращаем прочее.
      if (material.authorId === State.user.uid) {
        if (status === MATERIAL_STATUS_DRAFT) {
          actions.appendChild(h("button", {
            type: "button", class: "btn secondary",
            onclick: () => changeStatus(material, publishLibraryMaterial, "Опубликовать")
          }, "Опубликовать"));
        } else if (status === MATERIAL_STATUS_PUBLISHED) {
          actions.appendChild(h("button", {
            type: "button", class: "btn secondary",
            onclick: () => changeStatus(material, archiveLibraryMaterial, "В архив")
          }, "В архив"));
        } else {
          actions.appendChild(h("button", {
            type: "button", class: "btn secondary",
            onclick: () => changeStatus(material, publishLibraryMaterial, "Вернуть из архива")
          }, "Вернуть из архива"));
        }
      }
    }
    return h("article", { class: "card mat-card" },
      h("div", { class: "list-row-title" }, material.title || "Без названия"),
      badges, meta, actions);
  }

  async function changeStatus(material, action, label) {
    const ok = await confirmAction({
      title: `${label}?`,
      text: `Материал «${material.title || "Без названия"}».`
        + (label === "В архив" ? " Студентам он станет недоступен." : ""),
      confirmLabel: label
    });
    if (!ok) return;
    try {
      await action(material.id);
      material.status = label === "В архив" ? MATERIAL_STATUS_ARCHIVED : MATERIAL_STATUS_PUBLISHED;
      paintList();
      toast(label === "В архив" ? "Материал в архиве" : "Материал опубликован", "success");
    } catch (err) {
      toast(err?.message || "Не удалось изменить статус.", "error");
    }
  }

  // ---------- Фильтры ----------
  filterSubject.addEventListener("change", async () => {
    const subjectId = filterSubject.value || "";
    filterTopic.textContent = "";
    filterTopic.appendChild(h("option", { value: "" }, "Все темы"));
    if (!subjectId) {
      filterTopic.disabled = true;
      paintList();
      return;
    }
    if (!topicsBySubject.has(subjectId)) {
      try {
        topicsBySubject.set(subjectId, await getTopics(subjectId));
      } catch (err) {
        console.error(err);
        topicsBySubject.set(subjectId, []);
      }
    }
    (topicsBySubject.get(subjectId) || []).forEach(topic => {
      if (topic.status !== "archived") {
        filterTopic.appendChild(h("option", { value: topic.id }, topic.title || "Тема"));
      }
    });
    filterTopic.disabled = false;
    paintList();
  });
  filterTopic.addEventListener("change", paintList);
  searchInput.addEventListener("input", paintList);

  // ---------- Загрузка ----------
  const staffActions = h("div", { class: "btn-row" });
  if (staff) {
    staffActions.appendChild(h("a", { class: "btn primary", href: "#material-editor/new" }, "Создать материал"));
  }

  page.appendChild(h("div", { class: "page-head" }, h("h1", {}, lt("title.materials")), staffActions));
  page.appendChild(h("div", { class: "panel" },
    h("div", { class: "panel-body filter-row" },
      filterSubject, filterTopic, searchInput)));
  page.appendChild(statusLine);
  page.appendChild(listWrap);

  try {
    materials = await listMaterials();
    subjects = await getSubjects().catch(err => { console.error(err); return []; });
    subjects.filter(s => s.status !== "archived").forEach(s =>
      filterSubject.appendChild(h("option", { value: s.id }, s.title || "Предмет")));
    filterSubject.disabled = false;
    paintList();
    statusLine.textContent = staff
      ? `Материалов: ${materials.length} (включая черновики и архив).`
      : `Опубликованных материалов: ${materials.filter(isPublished).length}.`;
  } catch (err) {
    listWrap.textContent = "";
    listWrap.appendChild(h("div", { class: "panel" },
      h("p", { class: "form-error" }, err?.message || "Каталог не загружен.")));
  }
  return page;
}
