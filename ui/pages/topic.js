// ui/pages/topic.js — отдельная страница темы (маршрут #topic/<id>).
//
// ЭТАП 4: тема — полноценная учебная единица. Страница показывает:
//   • даты расписания (занятие, открытие, закрытие, публикация, срок сдачи),
//     учебную группу и хранимый статус темы (для сотрудника);
//   • состояние для конкретного ученика (доступна / откроется / закрыта /
//     изучается / просрочена) — вычисляется, не хранится в теме;
//   • материалы, тесты и практические задания темы (сроки из assignments);
//   • сотруднику: настройки темы (все поля), копирование, перенос в другую
//     дисциплину (копия + архивирование), порядок, архивирование и
//     «удаление» с проверкой зависимостей.
//
// Ограничение доступа: правила Firestore запрещают студенту читать
// черновики, запланированные и архивные темы и темы чужой группы; окно
// открытия/закрытия (даты) применяется здесь через core/schedule-logic.js —
// правила не могут фильтровать LIST-запросы по времени. Материалы и тесты
// до даты открытия не показываются.
//
// «Удаление»: физическое удаление запрещено правилами (история попыток
// должна сохраняться). Удаление = мягкое архивирование с предварительной
// проверкой зависимостей (материалы, тесты, задания).
import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { materialLink, materialProgressState } from "../../core/material-library-logic.js";
import { loadMaterialProgress } from "../../core/materials.js";
import { getTopic, getSubject, getTopics, updateTopic, moveTopic, copyTopic } from "../../core/subjects.js";
import {
  validateTopicData, TOPIC_DATE_FIELDS,
  TOPIC_STATUS_DRAFT, TOPIC_STATUS_PLANNED, TOPIC_STATUS_PUBLISHED, TOPIC_STATUS_ARCHIVED,
  TOPIC_STATUSES, TITLE_MAX, DESCRIPTION_MAX
} from "../../core/subjects-logic.js";
import {
  topicStatusLabel, studentTopicState, topicOpenNow,
  formatTopicDate, msToISODate, isoDateToMs, dateMs
} from "../../core/schedule-logic.js";
import { listMaterials } from "../../core/material-library.js";
import { listMyTests, listPublishedTests } from "../../core/editor.js";
import { listAssignments, getStudentAssignments } from "../../core/assign.js";
import { Timestamp } from "../../shared/firebase.js";
import { icons } from "../../shared/icons.js";
import { confirmAction } from "../components/confirm.js";
import { formDialog } from "../components/form-dialog.js";
import { toast } from "../components/toast.js";

const encode = encodeURIComponent;

// Значение input type=date → Timestamp локальной полуночи; "" → null.
function isoToTimestamp(iso) {
  const ms = isoDateToMs(iso);
  return ms === null ? null : Timestamp.fromDate(new Date(ms));
}

// Дата темы → значение для input type=date ("YYYY-MM-DD" или "").
function dateInputValue(topic, field) {
  const ms = dateMs(topic[field]);
  return ms === null ? "" : msToISODate(ms);
}

export default async function TopicPage() {
  const page = h("div", { class: "page" });
  const staff = isStaff();
  const topicId = (State.routeParam || "").split("/")[0];

  const box = h("div", { id: "topic-page" });
  page.appendChild(box);

  const draw = (node) => { box.textContent = ""; if (node) box.append(node); };

  const notFound = (title, text) => h("section", { class: "panel" },
    h("div", { class: "empty-state" },
      h("div", { class: "empty-state-icon", innerHTML: icons.book }),
      h("h2", {}, title),
      h("p", { class: "muted" }, text),
      h("a", { class: "btn secondary", href: "#disciplines" }, "К каталогу дисциплин")
    ));

  const loadingView = h("section", { class: "panel" },
    h("div", { class: "panel-body" }, h("div", { class: "spinner" })));
  draw(loadingView);

  if (!topicId) {
    draw(notFound("Тема не выбрана", "Откройте тему через каталог дисциплин."));
    return page;
  }

  let topic, subject;
  try {
    topic = await getTopic(topicId);
    if (!topic) {
      draw(notFound("Тема не найдена", "Тема не существует или скрыта из списков."));
      return page;
    }
    subject = await getSubject(topic.subjectId).catch(() => null);
    // Архивный предмет скрыт от студентов целиком — вместе с темами.
    if (!staff && subject && subject.status === "archived") {
      draw(notFound("Тема не найдена", "Тема не существует или скрыта из списков."));
      return page;
    }
  } catch (err) {
    // permission-denied (черновик/чужая группа/чужая организация) и ошибки
    // сети выглядят для студента одинаково: темы «нет».
    console.error("Страница темы:", err);
    draw(notFound("Тема недоступна", err?.message || "Не удалось загрузить тему. Проверьте подключение к сети."));
    return page;
  }

  const nowMs = Date.now();
  // Последнее загруженное содержимое — нужно проверке зависимостей
  // при «удалении» темы.
  const contentData = { materials: [], tests: [], assignments: [] };
  const studentState = studentTopicState(topic, nowMs);
  const storedArchived = topic.status === TOPIC_STATUS_ARCHIVED;

  // Студенту: тема хранимо видима (правила уже не отдали бы скрытую), но
  // окно дат применяется здесь: до открытия материалы не показываются.
  if (!staff) {
    if (studentState?.state === "closed") {
      draw(h("div", {},
        topicBack(),
        notFound("Тема закрыта", `Тема была доступна до ${formatTopicDate(topic.closeDate)}.`)));
      return page;
    }
    if (studentState?.state === "upcoming") {
      draw(h("div", {},
        topicBack(),
        h("section", { class: "panel" },
          h("div", { class: "empty-state" },
            h("div", { class: "empty-state-icon", innerHTML: icons.book }),
            h("h2", {}, topic.title),
            h("p", { class: "muted" },
              `Тема откроется ${formatTopicDate(topic.openDate)}. Материалы и задания появятся здесь автоматически.`),
            h("span", { class: "badge badge-neutral" }, "Материалы скрыты")
          ))));
      return page;
    }
  }

  // ---------- Содержимое темы ----------
  async function loadContent() {
    draw(h("div", { class: "panel" }, h("div", { class: "panel-body" }, h("div", { class: "spinner" }))));
    let materials, tests, assignments;
    try {
      const profile = State.profile || {};
      [materials, tests] = await Promise.all([
        listMaterials(),
        staff
          ? listMyTests(State.user.uid, profile.orgId, profile.role)
          : listPublishedTests(profile.orgId)
      ]);
      // Практические задания: задания (assignments), чьи тесты привязаны
      // к этой теме. Сотрудник видит задания организации, студент — своей
      // группы.
      const testIds = new Set(tests.map(t => t.id));
      const assignmentList = staff
        ? await listAssignments(profile.orgId)
        : await getStudentAssignments(profile.groupId || "", profile.orgId);
      assignments = assignmentList.filter(a => testIds.has(a.testId));
    } catch (err) {
      console.error("Содержимое темы:", err);
      draw(h("section", { class: "panel" },
        h("div", { class: "empty-state" },
          h("h2", {}, "Не удалось загрузить содержимое"),
          h("p", { class: "muted" }, err?.message || "Проверьте подключение к сети."),
          h("button", { type: "button", class: "btn secondary", onclick: loadContent }, "Повторить")
        )));
      return;
    }

    materials = materials
      .filter(m => m.topicId === topic.id)
      .filter(m => staff || !m.status || m.status === "published");
    tests = tests
      .filter(t => t.topicId === topic.id && t.status !== "deleted")
      .filter(t => staff || t.status === "published");
    contentData.materials = materials;
    contentData.tests = tests;
    contentData.assignments = assignments;

    // Прогресс изучения (этап 5): студент видит своё состояние по каждому
    // материалу темы — не открывал / открыл / читает / завершил. Скачивание
    // PDF не считается завершением: completed ставит только чтение книги
    // до последней страницы. Сотрудник пишет прогресс только локально
    // (правила), поэтому ему состояния не показываются.
    let progressStates = null;
    if (!staff) {
      progressStates = new Map();
      await Promise.all(materials.map(async m => {
        const p = await loadMaterialProgress(State.user.uid, m.id);
        progressStates.set(m.id, materialProgressState(p));
      }));
    }

    const theory = h("div", { class: "topic-block" },
      h("h3", {}, "Теория"),
      materials.length
        ? h("div", { class: "list" }, materials.map(m => h("div", { class: "list-row" },
          h("div", { class: "list-row-main" },
            h("div", { class: "list-row-title" }, m.title || "Материал"),
            h("div", { class: "list-row-sub" }, [
              m.pdfName ? `PDF · ${m.pdfName}` : "Книга",
              m.pageCount ? `${m.pageCount} стр.` : "",
              progressStates ? progressStates.get(m.id)?.label || "" : ""
            ].filter(Boolean).join(" · "))),
          h("div", { class: "list-row-end" },
            progressStates ? h("span", {
              class: `badge ${progressStates.get(m.id)?.state === "done" ? "badge-success" : "badge-neutral"}`
            }, progressStates.get(m.id)?.label || "") : null,
            h("a", {
              class: "btn primary",
              href: materialLink(window.location.hash, m.id)
            }, m.pdfName ? "Открыть" : "Читать"),
            staff ? h("a", { class: "btn secondary", href: `#material-editor/${encode(m.id)}` }, "Изменить") : null))))
        : h("p", { class: "muted" }, "Теория к теме пока не добавлена."),
      staff ? h("a", { class: "btn secondary", href: `#material-editor/new/${encode(topic.subjectId)}/${encode(topic.id)}` }, "Добавить теорию (книга или PDF)") : null);

    const testsBlock = h("div", { class: "topic-block" },
      h("h3", {}, "Тесты"),
      tests.length
        ? h("div", { class: "list" }, tests.map(t => h("div", { class: "list-row" },
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
      staff ? h("a", { class: "btn secondary", href: `#create-test/new/${encode(topic.subjectId)}/${encode(topic.id)}` }, "Добавить тест") : null);

    // Практические задания: сроки, просрочка, вход к прохождению.
    const assignmentsBlock = h("div", { class: "topic-block" },
      h("h3", {}, "Практические задания"),
      assignments.length
        ? h("div", { class: "list" }, assignments.map(a => {
          const overdue = a.deadline && dateMs(a.deadline) < nowMs;
          return h("div", { class: "list-row" },
            h("div", { class: "list-row-main" },
              h("div", { class: "list-row-title" }, a.testTitle || "Задание"),
              h("div", { class: "list-row-sub" }, [
                a.deadline ? `Срок: ${formatTopicDate(a.deadline)}` : "Без срока",
                a.kind === "training" ? "тренировка" : "проверка",
                overdue ? "просрочено" : ""
              ].filter(Boolean).join(" · "))),
            h("div", { class: "list-row-end" },
              overdue ? h("span", { class: "badge badge-danger" }, "Просрочено") : null,
              h("a", { class: "btn primary", href: "#assignments" }, "К заданиям")));
        }))
        : h("p", { class: "muted" }, "Практических заданий к теме пока нет."),
      staff ? h("a", { class: "btn secondary", href: "#assignments" }, "Все задания") : null);

    // Расписание темы: даты и группа. Показывается всем, у кого тема
    // открыта; студенту помогает видеть сроки.
    const schedule = h("section", { class: "panel" },
      h("div", { class: "section-title" },
        h("h2", {}, "Расписание")),
      h("div", { class: "list" },
        scheduleRow("Занятие", topic.lessonDate),
        scheduleRow("Дата публикации", topic.publishDate),
        scheduleRow("Дата открытия", topic.openDate),
        scheduleRow("Дата закрытия", topic.closeDate),
        scheduleRow("Срок сдачи", topic.dueDate),
        h("div", { class: "list-row" },
          h("div", { class: "list-row-main" },
            h("div", { class: "list-row-title" }, "Учебная группа"),
            h("div", { class: "list-row-sub" },
              topic.groupId ? topic.groupId : "Для всех групп")))));

    // Действия сотрудника
    const actions = staff ? h("div", { class: "btn-row" },
      h("button", {
        type: "button",
        class: "btn primary",
        onclick: topicSettings
      }, "Настройки темы"),
      h("a", {
        class: "btn secondary",
        href: `#topic-analytics/${encode(topic.id)}`
      }, "Аналитика"),
      h("button", {
        type: "button",
        class: "btn secondary",
        "aria-label": "Переместить тему выше",
        onclick: () => reorder(-1)
      }, "↑"),
      h("button", {
        type: "button",
        class: "btn secondary",
        "aria-label": "Переместить тему ниже",
        onclick: () => reorder(1)
      }, "↓"),
      h("button", {
        type: "button",
        class: "btn secondary",
        onclick: copyThis
      }, "Копировать"),
      h("button", {
        type: "button",
        class: "btn secondary",
        onclick: moveToSubject
      }, "Перенести"),
      h("button", {
        type: "button",
        class: "btn secondary",
        onclick: toggleArchive
      }, storedArchived ? "Вернуть" : "В архив"),
      h("button", {
        type: "button",
        class: "btn secondary",
        onclick: removeTopic
      }, "Удалить")
    ) : null;

    const content = h("section", { class: "panel" },
      h("div", { class: "topic-content" }, theory, testsBlock, assignmentsBlock));

    draw(h("div", {},
      topicBack(),
      h("div", { class: "page-head" },
        h("div", {},
          h("div", { class: "eyebrow" }, staff ? "Управление" : "Обучение"),
          h("h1", {}, topic.title),
          topic.description ? h("p", { class: "page-sub" }, topic.description) : null,
          h("p", { class: "muted topic-status-line" },
            staff
              ? h("span", {
                class: `badge ${storedArchived ? "badge-neutral" : topic.status === TOPIC_STATUS_PUBLISHED || topic.status === "active" ? "badge-success" : "badge-warning"}`
              }, topicStatusLabel(topic.status))
              : h("span", {
                class: `badge ${stateBadgeClass(studentState?.state)}`
              }, studentState?.label || ""))),
        staff ? h("div", { class: "page-head-actions" }, actions) : null
      ),
      schedule,
      content
    ));
  }

  function scheduleRow(label, value) {
    return h("div", { class: "list-row" },
      h("div", { class: "list-row-main" },
        h("div", { class: "list-row-title" }, label),
        h("div", { class: "list-row-sub" }, formatTopicDate(value))));
  }

  function topicBack() {
    return h("p", { class: "muted" },
      h("a", { href: subject ? `#discipline/${encode(subject.id)}` : "#disciplines" },
        "← К дисциплине"));
  }

  function stateBadgeClass(state) {
    if (state === "available") return "badge-success";
    if (state === "overdue") return "badge-danger";
    if (state === "closed") return "badge-neutral";
    return "badge-warning";
  }

  // ---------- Операции сотрудника ----------

  async function reload() {
    try {
      topic = await getTopic(topicId);
    } catch (err) {
      console.error("Тема:", err);
    }
    await loadContent();
  }

  // Порядок: на одну позицию вверх/вниз (moveTopic меняет order местами
  // с соседней темой той же дисциплины).
  async function reorder(delta) {
    try {
      await moveTopic(topic.id, delta);
      toast("Порядок изменён", "success");
      await reload();
    } catch (err) {
      console.error("Порядок темы:", err);
      toast(err?.message || "Не удалось изменить порядок.", "error");
    }
  }

  // Настройки темы: все поля этапа 4. Даты — input type=date; пустое поле
  // снимает дату (null). Статус и группа — селект/текст.
  async function topicSettings() {
    await formDialog({
      idPrefix: "topic-settings",
      title: "Настройки темы",
      text: "Название и описание видят студенты. Даты задают расписание: до открытия материалы скрыты, после закрытия тема недоступна. Публикация по расписанию не выполняется автоматически — статус меняется вручную.",
      fields: [
        { key: "title", label: "Название темы", value: topic.title, maxlength: TITLE_MAX },
        { key: "description", label: "Описание (необязательно)", value: topic.description, type: "textarea", maxlength: DESCRIPTION_MAX },
        {
          key: "status", label: "Статус", type: "select",
          value: topic.status === "active" ? TOPIC_STATUS_PUBLISHED : topic.status,
          options: [
            { value: TOPIC_STATUS_DRAFT, label: "Черновик" },
            { value: TOPIC_STATUS_PLANNED, label: "Запланирована" },
            { value: TOPIC_STATUS_PUBLISHED, label: "Опубликована" },
            { value: TOPIC_STATUS_ARCHIVED, label: "Архивирована" }
          ]
        },
        { key: "groupId", label: "Учебная группа", value: topic.groupId || "", maxlength: 100, hint: "Пусто — тема для всех групп" },
        { key: "lessonDate", label: "Дата проведения занятия", type: "date", value: dateInputValue(topic, "lessonDate") },
        { key: "openDate", label: "Дата открытия", type: "date", value: dateInputValue(topic, "openDate") },
        { key: "closeDate", label: "Дата закрытия", type: "date", value: dateInputValue(topic, "closeDate") },
        { key: "publishDate", label: "Дата публикации", type: "date", value: dateInputValue(topic, "publishDate") },
        { key: "dueDate", label: "Срок сдачи", type: "date", value: dateInputValue(topic, "dueDate") }
      ],
      submitLabel: "Сохранить",
      onSubmit: async (values) => {
        const patch = {
          title: values.title,
          description: values.description,
          status: values.status,
          groupId: values.groupId
        };
        for (const field of TOPIC_DATE_FIELDS) {
          patch[field] = isoToTimestamp(values[field]);
        }
        const check = validateTopicData(patch, false);
        if (!check.ok) return check.error;
        try {
          await updateTopic(topic.id, check.value);
          toast("Настройки сохранены", "success");
        } catch (err) {
          console.error("Настройки темы:", err);
          return err?.message || "Не удалось сохранить настройки.";
        }
        await reload();
        return null;
      }
    });
  }

  // Копирование: новый черновик «— копия» в той же дисциплине.
  async function copyThis() {
    const confirmed = await confirmAction({
      title: "Скопировать тему?",
      text: `Будет создан черновик «${topic.title} — копия» с теми же датами и группой. Материалы, тесты и история попыток останутся у оригинала.`,
      confirmLabel: "Скопировать",
      tone: "primary"
    });
    if (!confirmed) return;
    try {
      await copyTopic(topic.id);
      toast("Тема скопирована (черновик)", "success");
    } catch (err) {
      console.error("Копирование темы:", err);
      toast(err?.message || "Не удалось скопировать тему.", "error");
    }
  }

  // Перенос в другую дисциплину = копия в целевую + архивирование здесь
  // (правила запрещают менять subjectId и удалять документ; история
  // попыток сохраняется).
  async function moveToSubject() {
    let subjects = [];
    try {
      const { getSubjects } = await import("../../core/subjects.js");
      subjects = (await getSubjects()).filter(s => s.id !== topic.subjectId && s.status !== "archived");
    } catch (err) {
      console.error("Перенос темы:", err);
      toast(err?.message || "Не удалось загрузить дисциплины.", "error");
      return;
    }
    if (!subjects.length) {
      toast("Других дисциплин нет — перенести некуда.", "error");
      return;
    }
    await formDialog({
      idPrefix: "topic-move",
      title: "Перенести тему",
      text: "В новой дисциплине появится копия темы, а эта тема уйдёт в архив. Материалы, тесты и история попыток сохранятся — они привязаны к теме, а не к дисциплине.",
      fields: [
        {
          key: "subjectId", label: "Дисциплина", type: "select",
          value: subjects[0].id,
          options: subjects.map(s => ({ value: s.id, label: s.title }))
        }
      ],
      submitLabel: "Перенести",
      onSubmit: async (values) => {
        try {
          await copyTopic(topic.id, { toSubjectId: values.subjectId });
          await updateTopic(topic.id, { status: TOPIC_STATUS_ARCHIVED });
          toast("Тема перенесена: копия создана, оригинал в архиве", "success");
        } catch (err) {
          console.error("Перенос темы:", err);
          return err?.message || "Не удалось перенести тему.";
        }
        await reload();
        return null;
      }
    });
  }

  // Архивирование / возврат (мягкое «удаление» и восстановление).
  async function toggleArchive() {
    const toArchive = topic.status !== TOPIC_STATUS_ARCHIVED;
    const confirmed = await confirmAction({
      title: toArchive ? "Перевести тему в архив?" : "Вернуть тему из архива?",
      text: toArchive
        ? `${topic.title} исчезнет из списков студентов. Данные не удаляются: материалы, тесты и история попыток сохранят привязку.`
        : `${topic.title} снова появится в списках сотрудников.`,
      confirmLabel: toArchive ? "В архив" : "Вернуть",
      tone: toArchive ? "danger" : "primary"
    });
    if (!confirmed) return;
    try {
      await updateTopic(topic.id, { status: toArchive ? TOPIC_STATUS_ARCHIVED : TOPIC_STATUS_PUBLISHED });
      toast(toArchive ? "Тема в архиве" : "Тема возвращена", "success");
      await reload();
    } catch (err) {
      console.error("Архивирование темы:", err);
      toast(err?.message || "Не удалось изменить статус.", "error");
    }
  }

  // «Удалить» с безопасной проверкой зависимостей: физическое удаление
  // запрещено правилами (история попыток не должна пропадать), поэтому
  // удаление выполняется архивированием; диалог показывает, что привязано
  // к теме. Уничтожается только видимость, а не данные учеников.
  async function removeTopic() {
    const deps = [
      contentData.materials.length ? `материалы: ${contentData.materials.length}` : null,
      contentData.tests.length ? `тесты: ${contentData.tests.length}` : null,
      contentData.assignments.length ? `задания: ${contentData.assignments.length}` : null
    ].filter(Boolean);
    const depText = deps.length
      ? `К теме привязано: ${deps.join(", ")}. Привязки и история попыток учеников сохранятся.`
      : "Прямых привязок (материалы, тесты, задания) не найдено — тема нигде не используется.";
    const confirmed = await confirmAction({
      title: "Удалить тему?",
      text: `${topic.title} будет удалена из списков. ${depText} Физическое удаление запрещено правилами проекта: вместо него тема переводится в архив, чтобы не потерять историю выполненных заданий.`,
      confirmLabel: "Удалить (в архив)",
      tone: "danger"
    });
    if (!confirmed) return;
    try {
      await updateTopic(topic.id, { status: TOPIC_STATUS_ARCHIVED });
      toast("Тема удалена из списков (архив)", "success");
      await reload();
    } catch (err) {
      console.error("Удаление темы:", err);
      toast(err?.message || "Не удалось удалить тему.", "error");
    }
  }

  await loadContent();
  return page;
}
