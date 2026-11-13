// ui/pages/subjects.js — «Предметы и темы».
//
// Единая структура организации: предметы, внутри них темы. Преподаватели и
// администраторы управляют структурой (создание, изменение, архивирование),
// студенты видят только активные элементы в режиме чтения.
// Данные и проверки — core/subjects.js + subjects-logic.js (правила Firestore
// остаются основной границей безопасности). После операций страница
// перерисовывается локально, без location.reload.
import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import {
  getSubjects, getTopics, getSubject,
  createSubject, updateSubject,
  createTopic, updateTopic, moveTopic
} from "../../core/subjects.js";
import {
  TITLE_MAX, DESCRIPTION_MAX,
  STATUS_ACTIVE, STATUS_ARCHIVED
} from "../../core/subjects-logic.js";
import { confirmAction } from "../components/confirm.js";
import { modal } from "../components/modal.js";
import { toast } from "../components/toast.js";
import { icons } from "../../shared/icons.js";
import { listMaterials } from "../../core/material-library.js";
import { listMyTests, listPublishedTests } from "../../core/editor.js";

// Стартовые предметы (план этапа 1: на старте два предмета). Названия
// предзаполняются в диалоге создания — сотрудник может изменить их
// непосредственно перед созданием в своей организации.
const START_SUBJECT_1 = "Инструктаж по технике безопасности и охране труда при управлении и обслуживании локомотива";
const START_SUBJECT_2 = "Порядок подготовки локомотива к поездке";

// ---------- Вспомогательное ----------

// «1 тема / 2 темы / 5 тем»; при нуле — приглашение завести темы
// (студентам без намёка на управление: просто «Тем пока нет»).
function topicCountLabel(count, staff) {
  if (!count) return staff ? "Тем пока нет — добавьте первую" : "Тем пока нет";
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (count === 1) return "1 тема";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} темы`;
  return `${count} тем`;
}

// ---------- Диалог формы (создание/изменение предмета или темы) ----------
//
// В отличие от confirmAction (только Promise<boolean>), здесь после нажатия
// кнопки сохранения выполняется onSubmit(values): строка с ошибкой держит
// диалог открытым, null — закрывает его. Ошибка показывается в диалоге,
// а не через toast, чтобы пользователь не терял введённый текст из виду.
function formDialog({ title, text, fields, submitLabel, onSubmit }) {
  return new Promise(resolve => {
    const dialog = modal();
    const previouslyFocused = document.activeElement;
    let settled = false;

    const finish = (saved) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown, true);
      dialog.close();
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        try { previouslyFocused.focus(); } catch { /* элемент мог исчезнуть */ }
      }
      resolve(saved);
    };

    function onKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    }

    const errorBox = h("div", { class: "form-error", role: "alert" });
    const inputs = fields.map(field => {
      const input = field.type === "textarea"
        ? h("textarea", {
          id: `subject-form-${field.key}`,
          rows: "3",
          maxlength: String(field.maxlength)
        })
        : h("input", {
          id: `subject-form-${field.key}`,
          type: "text",
          maxlength: String(field.maxlength),
          autocomplete: "off"
        });
      input.value = field.value || "";
      return h("div", { class: "field" },
        h("label", { for: input.id }, field.label),
        input,
        h("div", { class: "form-hint" },
          field.hint || `До ${field.maxlength} символов`)
      );
    });

    const saveBtn = h("button", { type: "button", class: "btn primary" }, submitLabel);
    const cancelBtn = h("button", { type: "button", class: "btn secondary", onclick: () => finish(false) }, "Отмена");

    saveBtn.addEventListener("click", async () => {
      errorBox.textContent = "";
      const values = Object.fromEntries(fields.map((field, i) => [field.key, inputs[i].querySelector("input, textarea").value]));
      saveBtn.disabled = true;
      try {
        const error = await onSubmit(values);
        if (error) {
          errorBox.textContent = error;
          saveBtn.disabled = false;
          return;
        }
        finish(true);
      } catch (e) {
        errorBox.textContent = e?.message || "Не удалось сохранить. Попробуйте ещё раз.";
        saveBtn.disabled = false;
      }
    });

    const content = dialog.querySelector(".modal-content");
    content.setAttribute("role", "dialog");
    content.setAttribute("aria-modal", "true");
    content.setAttribute("aria-label", title);
    content.append(
      h("h2", { style: "margin-top:0" }, title),
      text ? h("p", { class: "muted" }, text) : null,
      ...inputs,
      errorBox,
      h("div", { class: "btn-row" }, saveBtn, cancelBtn)
    );

    const closeBtn = dialog.querySelector(".modal-close");
    if (closeBtn) closeBtn.setAttribute("aria-label", "Закрыть");
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) finish(false);
    });

    document.addEventListener("keydown", onKeydown, true);
    dialog.show();
    inputs[0].querySelector("input, textarea").focus();
  });
}

export default async function SubjectsPage() {
  const page = h("div", { class: "page" });
  const staff = isStaff();

  // #subjects — все предметы; #subjects/<id> — один предмет со списком тем
  // (страница предмета из сценария «предмет → темы»).
  const routeSubjectId = (State.routeParam || "").split("/")[0];

  const state = {
    subjects: [],
    topics: new Map(),   // subjectId -> массив тем
    open: new Set(),     // раскрытые темы (id)
    content: new Map(),  // topicId -> { loading, error, materials, tests }
    catalog: null,       // { materials, tests } — читается один раз для всех тем
    loading: true,
    error: null,
    notFound: false
  };

  const listBox = h("div", { id: "subjects-list" });

  const addSubjectBtn = staff ? h("button", {
    type: "button",
    class: "btn primary",
    onclick: () => subjectForm(null)
  }, "Добавить предмет") : null;

  page.append(
    h("div", { class: "page-head" },
      h("div", {},
        h("div", { class: "eyebrow" }, staff ? "Управление" : "Обучение"),
        h("h1", {}, "Предметы и темы"),
        h("p", { class: "page-sub" }, staff
          ? "Структура организации: предметы и темы, к которым привязываются учебные материалы и тесты."
          : "Предметы и темы вашей организации.")
      ),
      // Условный элемент передаётся внутрь h(), а не в append(): append(null)
      // вставил бы текст "null".
      h("div", { class: "page-head-actions" }, addSubjectBtn)
    ),
    listBox
  );

  // ---------- Загрузка ----------

  async function load() {
    state.loading = true;
    state.error = null;
    state.notFound = false;
    draw();
    try {
      if (routeSubjectId) {
        // Страница предмета: читаем один документ вместо всего списка.
        const subject = await getSubject(routeSubjectId);
        if (!subject || (!staff && subject.status === STATUS_ARCHIVED)) {
          state.loading = false;
          state.notFound = true;
          draw();
          return;
        }
        state.subjects = [subject];
        state.topics.set(subject.id, await getTopics(subject.id));
      } else {
        state.subjects = await getSubjects();
        // Темы читаются по предметам; организации небольшие (старт — два
        // предмета), поэтому последовательных запросов немного.
        for (const subject of state.subjects) {
          state.topics.set(subject.id, await getTopics(subject.id));
        }
      }
      state.loading = false;
      draw();
    } catch (err) {
      console.error("Предметы и темы:", err);
      state.loading = false;
      state.error = err;
      draw();
    }
  }

  // ---------- Отрисовка ----------

  function draw() {
    listBox.textContent = "";

    if (state.loading) {
      listBox.append(h("section", { class: "panel" },
        h("div", { class: "panel-body" }, h("div", { class: "spinner" }))));
      return;
    }

    // Прямая ссылка #subjects/<id> на несуществующий или архивный предмет:
    // студенту архивный не показываем (он «не существует»).
    if (state.notFound) {
      listBox.append(h("section", { class: "panel" },
        h("div", { class: "empty-state" },
          h("div", { class: "empty-state-icon", innerHTML: icons.book }),
          h("h2", {}, "Предмет не найден"),
          h("p", { class: "muted" }, "Предмет не существует или скрыт из списков."),
          h("a", { class: "btn secondary", href: "#subjects" }, "К списку предметов")
        )));
      return;
    }

    if (state.error) {
      listBox.append(h("section", { class: "panel" },
        h("div", { class: "empty-state" },
          h("div", { class: "empty-state-icon", innerHTML: icons.book }),
          h("h2", {}, "Список недоступен"),
          h("p", { class: "muted" },
            state.error?.message || "Не удалось загрузить предметы. Проверьте подключение к сети."),
          h("button", { type: "button", class: "btn secondary", onclick: load }, "Повторить")
        )));
      return;
    }

    const active = state.subjects.filter(s => s.status !== STATUS_ARCHIVED);
    const archived = staff
      ? state.subjects.filter(s => s.status === STATUS_ARCHIVED)
      : [];

    // Режим страницы предмета: назад к списку + панель этого предмета.
    if (routeSubjectId && active.length) {
      listBox.append(
        h("p", { class: "muted" },
          h("a", { href: "#subjects" }, "← Все предметы")),
        h("div", { class: "list" }, subjectPanel(active[0], { single: true }))
      );
      if (archived.length) drawArchive(archived);
      return;
    }

    if (!active.length && !archived.length) {
      listBox.append(h("section", { class: "panel" },
        h("div", { class: "empty-state" },
          h("div", { class: "empty-state-icon", innerHTML: icons.book }),
          h("h2", {}, "Пока нет ни одного предмета"),
          h("p", { class: "muted" }, staff
            ? "Создайте первый предмет — внутри него появятся темы для теории и тестов."
            : "Преподаватели ещё не завели предметы. Они появятся здесь автоматически."),
          staff ? h("div", { class: "btn-row" },
            h("button", {
              type: "button",
              class: "btn secondary",
              onclick: seedSubjects
            }, "Создать стартовые предметы"),
            h("button", {
              type: "button",
              class: "btn primary",
              onclick: () => subjectForm(null)
            }, "Добавить предмет")
          ) : null
        )));
      return;
    }

    if (!active.length) {
      listBox.append(h("p", { class: "muted" }, "Активных предметов нет."));
    }

    const list = h("div", { class: "list" });
    active.forEach(subject => list.append(subjectPanel(subject)));
    listBox.append(list);

    // Архив показывается только сотрудникам: студенты активные данные и так
    // не видят, а сотруднику нужен способ найти и вернуть скрытое.
    if (archived.length) drawArchive(archived);
  }

  function drawArchive(archived) {
    listBox.append(h("section", { class: "panel" },
      h("div", { class: "section-title" },
        h("h2", {}, "Архив"),
        h("span", { class: "muted" }, "Скрыто от студентов")
      ),
      h("div", { class: "list" },
        ...archived.map(subject => h("div", { class: "list-row" },
          h("div", { class: "list-row-main" },
            h("div", { class: "list-row-title", style: "color:var(--text-2)" }, subject.title),
            h("div", { class: "list-row-sub" }, subject.description || "Без описания")
          ),
          h("div", { class: "list-row-end" },
            h("button", {
              type: "button",
              class: "btn secondary",
              onclick: () => toggleArchive("subject", subject)
            }, "Вернуть")
          )
        ))
      )
    ));
  }

  function subjectPanel(subject, { single = false } = {}) {
    const topics = (state.topics.get(subject.id) || []);
    const visibleTopics = staff ? topics : topics.filter(t => t.status !== STATUS_ARCHIVED);

    const actions = staff ? h("div", { class: "btn-row" },
      h("button", {
        type: "button",
        class: "btn primary",
        onclick: () => topicForm(subject)
      }, "Добавить тему"),
      h("button", {
        type: "button",
        class: "btn secondary",
        onclick: () => subjectForm(subject)
      }, "Изменить"),
      h("button", {
        type: "button",
        class: "btn secondary",
        onclick: () => toggleArchive("subject", subject)
      }, "В архив")
    ) : null;

    // Заголовок предмета — ссылка на его страницу (страница списка ссылку
    // не дублирует: там это текущий адрес).
    const title = single
      ? h("h2", {}, subject.title)
      : h("h2", {}, h("a", { href: `#subjects/${encode(subject.id)}` }, subject.title));

    return h("section", { class: "panel" },
      h("div", { class: "section-title" },
        title,
        h("span", { class: "muted" }, topicCountLabel(visibleTopics.length, staff))
      ),
      subject.description ? h("p", { class: "muted", style: "margin-top:0" }, subject.description) : null,
      visibleTopics.length
        ? h("div", { class: "list" },
          ...visibleTopics.map((topic, index) => topicRow(subject, topic, index)))
        : null,
      actions
    );
  }

  // Каталог теории и тестов читается один раз и раскладывается по темам.
  async function loadCatalog() {
    if (state.catalog) return state.catalog;
    const profile = State.profile || {};
    const [materials, tests] = await Promise.all([
      listMaterials().catch(() => []),
      (staff
        ? listMyTests(State.user.uid, profile.orgId, profile.role)
        : listPublishedTests(profile.orgId)).catch(() => [])
    ]);
    state.catalog = {
      materials: materials.filter(m => staff || !m.status || m.status === "published"),
      tests: tests.filter(t => t.status !== "deleted")
    };
    return state.catalog;
  }

  async function toggleTopic(topic) {
    if (state.open.has(topic.id)) { state.open.delete(topic.id); draw(); return; }
    state.open.add(topic.id);
    state.content.set(topic.id, { loading: true });
    draw();
    try {
      const catalog = await loadCatalog();
      state.content.set(topic.id, {
        materials: catalog.materials.filter(m => m.topicId === topic.id),
        tests: catalog.tests.filter(t => t.topicId === topic.id)
      });
    } catch (err) {
      console.error("Содержимое темы:", err);
      state.content.set(topic.id, { error: true });
    }
    draw();
  }

  const encode = encodeURIComponent;

  function topicContent(subject, topic) {
    const data = state.content.get(topic.id) || { loading: true };
    if (data.loading) return h("div", { class: "topic-content" }, h("div", { class: "spinner" }));
    if (data.error) return h("div", { class: "topic-content" }, h("p", { class: "form-error" }, "Не удалось загрузить теорию и тесты темы."));

    const theory = h("div", { class: "topic-block" },
      h("h3", {}, "Теория"),
      data.materials.length
        ? h("div", { class: "list" }, data.materials.map(m => h("div", { class: "list-row" },
          h("div", { class: "list-row-main" },
            h("div", { class: "list-row-title" }, m.title || "Материал"),
            h("div", { class: "list-row-sub" }, [m.pdfName ? `PDF · ${m.pdfName}` : "Книга", m.pageCount ? `${m.pageCount} стр.` : ""].filter(Boolean).join(" · "))),
          h("div", { class: "list-row-end" },
            h("a", { class: "btn primary", href: `#material/${encode(m.id)}/free` }, m.pdfName ? "Открыть" : "Читать"),
            staff ? h("a", { class: "btn secondary", href: `#material-editor/${encode(m.id)}` }, "Изменить") : null))))
        : h("p", { class: "muted" }, "Теория к теме пока не добавлена."),
      staff ? h("a", { class: "btn secondary", href: `#material-editor/new/${encode(subject.id)}/${encode(topic.id)}` }, "Добавить теорию (книга или PDF)") : null);

    const tests = h("div", { class: "topic-block" },
      h("h3", {}, "Тесты"),
      data.tests.length
        ? h("div", { class: "list" }, data.tests.map(t => h("div", { class: "list-row" },
          h("div", { class: "list-row-main" },
            h("div", { class: "list-row-title" }, t.title || "Тест"),
            h("div", { class: "list-row-sub" }, [
              Array.isArray(t.questions) ? `${t.questions.length} вопр.` : (t.questionCount ? `${t.questionCount} вопр.` : ""),
              t.requireMaterial ? "сначала теория" : "",
              staff && t.status !== "published" ? "черновик" : ""
            ].filter(Boolean).join(" · "))),
          h("div", { class: "list-row-end" },
            staff
              ? [
                t.status === "published" ? h("a", { class: "btn primary", href: `#launch/${encode(t.id)}` }, "Запустить в Live") : null,
                h("a", { class: "btn secondary", href: `#test-history/${encode(t.id)}` }, "История и оценки"),
                h("a", { class: "btn secondary", href: `#create-test/${encode(t.id)}` }, "Изменить")
              ]
              : h("a", { class: "btn primary", href: `#quiz/${encode(t.id)}` }, "Пройти тест")))))
        : h("p", { class: "muted" }, "Тестов к теме пока нет."),
      staff ? h("a", { class: "btn secondary", href: `#create-test/new/${encode(subject.id)}/${encode(topic.id)}` }, "Добавить тест") : null);

    return h("div", { class: "topic-content" }, theory, tests);
  }

  function topicRow(subject, topic, index = 0) {
    const archived = topic.status === STATUS_ARCHIVED;
    const isOpen = state.open.has(topic.id);
    const end = h("div", { class: "list-row-end" },
      // Порядок тем: только сотрудники, по одной позиции за нажатие.
      staff ? h("button", {
        type: "button",
        class: "btn secondary",
        "aria-label": `Переместить тему выше: ${topic.title}`,
        onclick: () => reorderTopic(subject, topic, -1)
      }, "↑") : null,
      staff ? h("button", {
        type: "button",
        class: "btn secondary",
        "aria-label": `Переместить тему ниже: ${topic.title}`,
        onclick: () => reorderTopic(subject, topic, 1)
      }, "↓") : null,
      h("button", {
        type: "button",
        class: "btn primary",
        "aria-expanded": isOpen ? "true" : "false",
        onclick: () => toggleTopic(topic)
      }, isOpen ? "Свернуть" : "Открыть"),
      staff ? h("button", {
        type: "button",
        class: "btn secondary",
        onclick: () => topicForm(subject, topic)
      }, "Изменить") : null,
      staff ? h("button", {
        type: "button",
        class: "btn secondary",
        onclick: () => toggleArchive("topic", topic, subject)
      }, archived ? "Вернуть" : "В архив") : null
    );

    // Понятный порядок: номер в списке + кликабельный заголовок, ведущий
    // на отдельную страницу темы (материалы и тесты темы).
    const titleLink = h("a", {
      class: "list-row-title",
      href: `#topic/${encode(topic.id)}`
    }, `${index + 1}. ${topic.title}`);

    return h("div", { class: "topic-item" },
      h("div", { class: "list-row" },
        h("div", { class: "list-row-main" },
          h("div", archived
            ? { class: "list-row-title-wrap", style: "color:var(--text-2)" }
            : { class: "list-row-title-wrap" }, titleLink),
          h("div", { class: "list-row-sub" },
            archived ? "В архиве — скрыта от студентов" : (topic.description || ""))
        ),
        end
      ),
      isOpen ? topicContent(subject, topic) : null
    );
  }

  async function reorderTopic(subject, topic, delta) {
    try {
      await moveTopic(topic.id, delta);
      // Перечитываем список предмета: порядок могли поменять местами с
      // соседней темой (в том числе архивной).
      state.topics.set(subject.id, await getTopics(subject.id));
      draw();
    } catch (err) {
      console.error("Порядок тем:", err);
      toast(err?.message || "Не удалось изменить порядок. Попробуйте ещё раз.", "error");
    }
  }

  // ---------- Операции ----------

  // Стартовые предметы: два курса плана этапа 1. Создание — обычным
  // createSubject по одному, как при ручном добавлении (правила Firestore
  // проверяют каждый документ так же). Если второй предмет не создался,
  // первый остаётся — диалог покажет причину.
  async function seedSubjects() {
    await formDialog({
      title: "Создать стартовые предметы",
      text: "Названия можно изменить перед созданием. Темы заведёте внутри предметов позже.",
      fields: [
        { key: "title1", label: "Предмет 1", value: START_SUBJECT_1, maxlength: TITLE_MAX },
        { key: "title2", label: "Предмет 2", value: START_SUBJECT_2, maxlength: TITLE_MAX }
      ],
      submitLabel: "Создать два предмета",
      onSubmit: async (values) => {
        const title1 = values.title1.trim();
        const title2 = values.title2.trim();
        if (!title1 || !title2) return "Укажите названия обоих предметов.";
        if (title1 === title2) return "Названия предметов должны различаться.";

        const baseOrder = state.subjects.reduce((max, s) => Math.max(max, Number(s.order) || 0), 0);
        const created1 = await createSubject({ title: title1, order: baseOrder + 1 });
        state.subjects.push(created1);
        state.topics.set(created1.id, []);
        draw();

        let created2;
        try {
          created2 = await createSubject({ title: title2, order: baseOrder + 2 });
        } catch (err) {
          draw();
          return `Первый предмет создан, второй — нет: ${err?.message || "попробуйте ещё раз"}`;
        }
        state.subjects.push(created2);
        state.topics.set(created2.id, []);
        toast("Создано два предмета", "success");
        draw();
        return null;
      }
    });
  }

  async function subjectForm(subject) {
    const editing = Boolean(subject);
    await formDialog({
      title: editing ? "Изменить предмет" : "Новый предмет",
      text: "Название увидят студенты; описание — короткий поясняющий текст в списке.",
      fields: [
        { key: "title", label: "Название", value: subject?.title, maxlength: TITLE_MAX, hint: `Например, «Электротехника». До ${TITLE_MAX} символов` },
        { key: "description", label: "Описание (необязательно)", value: subject?.description, type: "textarea", maxlength: DESCRIPTION_MAX }
      ],
      submitLabel: editing ? "Сохранить" : "Создать",
      onSubmit: async (values) => {
        if (editing) {
          await updateSubject(subject.id, { title: values.title, description: values.description });
          subject.title = values.title.trim();
          subject.description = values.description.trim();
          toast("Предмет обновлён", "success");
        } else {
          const order = state.subjects.reduce((max, s) => Math.max(max, Number(s.order) || 0), 0) + 1;
          const created = await createSubject({
            title: values.title,
            description: values.description,
            order
          });
          state.subjects.push(created);
          state.topics.set(created.id, []);
          toast("Предмет создан", "success");
        }
        draw();
        return null;
      }
    });
  }

  async function topicForm(subject, topic) {
    const editing = Boolean(topic);
    await formDialog({
      title: editing ? "Изменить тему" : `Новая тема — ${subject.title}`,
      text: "Темы внутри предмета: по ним пишутся материалы и привязываются тесты.",
      fields: [
        { key: "title", label: "Название темы", value: topic?.title, maxlength: TITLE_MAX },
        { key: "description", label: "Описание (необязательно)", value: topic?.description, type: "textarea", maxlength: DESCRIPTION_MAX }
      ],
      submitLabel: editing ? "Сохранить" : "Создать",
      onSubmit: async (values) => {
        if (editing) {
          await updateTopic(topic.id, { title: values.title, description: values.description });
          topic.title = values.title.trim();
          topic.description = values.description.trim();
          toast("Тема обновлена", "success");
        } else {
          const existing = state.topics.get(subject.id) || [];
          const order = existing.reduce((max, t) => Math.max(max, Number(t.order) || 0), 0) + 1;
          const created = await createTopic({
            subjectId: subject.id,
            title: values.title,
            description: values.description,
            order
          });
          state.topics.set(subject.id, [...existing, created]);
          toast("Тема создана", "success");
        }
        draw();
        return null;
      }
    });
  }

  // Архивирование мягкое: данные не удаляются, предмет или тема исчезают
  // из списков студентов. Привязки тестов и материалов продолжают работать.
  async function toggleArchive(kind, item, subject) {
    const toArchive = item.status !== STATUS_ARCHIVED;
    const isSubject = kind === "subject";
    const confirmed = await confirmAction({
      title: toArchive
        ? (isSubject ? "Убрать предмет в архив?" : "Убрать тему в архив?")
        : (isSubject ? "Вернуть предмет из архива?" : "Вернуть тему из архива?"),
      text: toArchive
        ? `${item.title} исчезнет из списков студентов. Данные не удаляются: тесты и материалы сохранят привязку.`
        : `${item.title} снова появится в списках студентов.`,
      confirmLabel: toArchive ? "В архив" : "Вернуть",
      tone: toArchive ? "danger" : "primary"
    });
    if (!confirmed) return;

    try {
      const patch = { status: toArchive ? STATUS_ARCHIVED : STATUS_ACTIVE };
      await (isSubject ? updateSubject : updateTopic)(item.id, patch);
      item.status = patch.status;
      toast(toArchive ? "Перемещено в архив" : "Возвращено из архива", "success");
      draw();
    } catch (err) {
      console.error("Архивирование:", err);
      toast(err?.message || "Не удалось изменить статус. Попробуйте ещё раз.", "error");
    }
  }

  // Первая отрисовка со спиннером — до завершения загрузки.
  draw();
  await load();

  return page;
}
