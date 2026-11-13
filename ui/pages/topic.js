// ui/pages/topic.js — отдельная страница темы (маршрут #topic/<id>).
//
// Показывает тему предмета: описание, прикреплённые материалы (библиотека
// theory) и тесты. Студент видит только активные темы и опубликованные
// материалы/тесты; сотруднику доступны ссылки управления, как на странице
// предметов. Данные читаются существующими модулями (subjects, editor,
// material-library) — новой системы и дублей логики нет.
import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { getTopic, getSubject } from "../../core/subjects.js";
import { listMaterials } from "../../core/material-library.js";
import { listMyTests, listPublishedTests } from "../../core/editor.js";
import { icons } from "../../shared/icons.js";
import { STATUS_ARCHIVED } from "../../core/subjects-logic.js";

const encode = encodeURIComponent;

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
      h("a", { class: "btn secondary", href: "#subjects" }, "К списку предметов")
    ));

  const loadingView = h("section", { class: "panel" },
    h("div", { class: "panel-body" }, h("div", { class: "spinner" })));
  draw(loadingView);

  if (!topicId) {
    draw(notFound("Тема не выбрана", "Откройте тему через список предметов."));
    return page;
  }

  let topic, subject;
  try {
    topic = await getTopic(topicId);
    if (!topic || (!staff && topic.status === STATUS_ARCHIVED)) {
      draw(notFound("Тема не найдена", "Тема не существует или скрыта из списков."));
      return page;
    }
    subject = await getSubject(topic.subjectId).catch(() => null);
    // Архивный предмет скрыт от студентов целиком — вместе с темами.
    if (!staff && subject && subject.status === STATUS_ARCHIVED) {
      draw(notFound("Тема не найдена", "Тема не существует или скрыта из списков."));
      return page;
    }
  } catch (err) {
    console.error("Страница темы:", err);
    draw(notFound("Тема недоступна", err?.message || "Не удалось загрузить тему. Проверьте подключение к сети."));
    return page;
  }

  const back = h("p", { class: "muted" },
    h("a", { href: subject ? `#subjects/${encode(subject.id)}` : "#subjects" }, "← К предмету"));

  const archived = topic.status === STATUS_ARCHIVED;

  // Содержимое темы: материалы библиотеки и тесты, привязанные к теме.
  async function loadContent() {
    draw(h("div", { class: "panel" }, h("div", { class: "panel-body" }, h("div", { class: "spinner" }))));
    let materials, tests;
    try {
      const profile = State.profile || {};
      [materials, tests] = await Promise.all([
        listMaterials(),
        staff
          ? listMyTests(State.user.uid, profile.orgId, profile.role)
          : listPublishedTests(profile.orgId)
      ]);
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

    const theory = h("div", { class: "topic-block" },
      h("h3", {}, "Теория"),
      materials.length
        ? h("div", { class: "list" }, materials.map(m => h("div", { class: "list-row" },
          h("div", { class: "list-row-main" },
            h("div", { class: "list-row-title" }, m.title || "Материал"),
            h("div", { class: "list-row-sub" }, [m.pdfName ? `PDF · ${m.pdfName}` : "Книга", m.pageCount ? `${m.pageCount} стр.` : ""].filter(Boolean).join(" · "))),
          h("div", { class: "list-row-end" },
            h("a", { class: "btn primary", href: `#material/${encode(m.id)}/free` }, m.pdfName ? "Открыть" : "Читать"),
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

    const content = h("section", { class: "panel" },
      h("div", { class: "topic-content" }, theory, testsBlock));

    draw(h("div", {},
      back,
      h("div", { class: "page-head" },
        h("div", {},
          h("div", { class: "eyebrow" }, staff ? (archived ? "Управление · тема в архиве" : "Управление") : "Обучение"),
          h("h1", {}, topic.title),
          topic.description ? h("p", { class: "page-sub" }, topic.description) : null
        )
      ),
      content
    ));
  }

  await loadContent();
  return page;
}
