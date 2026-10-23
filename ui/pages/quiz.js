import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { loadTest } from "../../core/editor.js";
import { icons } from "../../shared/icons.js";

const TYPE_LABEL = {
  single: "Один ответ",
  multiple: "Несколько ответов",
  short: "Короткий ответ"
};

export default async function QuizPage() {
  const page = h("div", { class: "page" });
  const testId = State.routeParam;

  const back = h("a", { class: "btn secondary", href: "#tests" }, "К каталогу");

  if (!testId) {
    page.append(
      h("div", { class: "panel" },
        h("div", { class: "empty-state" },
          h("div", { class: "empty-state-icon", innerHTML: icons.book }),
          h("h2", {}, "Тест не указан"),
          h("p", { class: "muted" }, "Откройте тест из каталога."),
          back
        )
      )
    );
    return page;
  }

  let test = null;
  let loadError = null;
  try {
    test = await loadTest(testId);
  } catch (err) {
    loadError = err;
  }

  if (loadError || !test) {
    page.append(
      h("div", { class: "panel" },
        h("div", { class: "empty-state" },
          h("div", { class: "empty-state-icon", innerHTML: icons.book }),
          h("h2", {}, loadError ? "Не удалось открыть тест" : "Тест не найден"),
          h("p", { class: "muted" }, loadError?.code === "permission-denied"
            ? "Правила Firestore не разрешают чтение этого теста."
            : loadError?.code === "unavailable"
              ? "Нет связи с Firestore. Проверьте подключение к интернету."
              : "Возможно, тест снят с публикации или ссылка устарела."),
          back
        )
      )
    );
    return page;
  }

  const questions = test.questions || [];
  const settings = test.settings || {};

  page.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Тест"),
      h("h1", {}, test.title || "Без названия"),
      test.description ? h("p", { class: "page-sub" }, test.description) : null
    ),
    h("div", { class: "page-head-actions" }, back)
  ));

  page.appendChild(h("section", { class: "stat-grid" },
    h("div", { class: "stat" },
      h("div", { class: "stat-value" }, String(questions.length)),
      h("div", { class: "stat-label" }, "вопросов")
    ),
    h("div", { class: "stat" },
      h("div", { class: "stat-value" }, settings.timePerQuestion ? settings.timePerQuestion + " с" : "—"),
      h("div", { class: "stat-label" }, "на вопрос")
    ),
    h("div", { class: "stat" },
      h("div", { class: "stat-value" }, settings.passScore ? settings.passScore + "%" : "—"),
      h("div", { class: "stat-label" }, "проходной балл")
    ),
    h("div", { class: "stat" },
      h("div", { class: "stat-value" }, settings.attemptsLimit ?? "—"),
      h("div", { class: "stat-label" }, "попыток")
    )
  ));

  if (test.instructions) {
    page.appendChild(h("section", { class: "panel" },
      h("div", { class: "section-title" }, h("h2", {}, "Инструкция")),
      h("p", { class: "muted", style: "margin:8px 0 0;white-space:pre-line" }, test.instructions)
    ));
  }

  const list = h("section", { class: "panel panel-flush" });
  list.appendChild(h("div", { class: "panel-head" },
    h("h2", {}, "Содержание"),
    h("span", { class: "badge " + (test.status === "published" ? "badge-success" : "badge-warning") },
      test.status === "published" ? "Опубликован" : "Черновик")
  ));

  const questionsBox = h("div", { class: "list" });
  if (!questions.length) {
    questionsBox.appendChild(h("div", { class: "empty-state" },
      h("p", { class: "muted" }, "В тесте пока нет вопросов.")
    ));
  }
  questions.forEach((q, index) => {
    const item = h("div", { class: "list-row", style: "align-items:flex-start" },
      h("span", { class: "badge badge-neutral" }, String(index + 1)),
      h("div", { class: "list-row-main" },
        h("div", { class: "list-row-title" }, q.text || "Вопрос без текста"),
        h("div", { class: "list-row-sub" },
          `${TYPE_LABEL[q.type] || "Вопрос"} · ${q.points || 1} ${q.points === 1 ? "балл" : "баллов"}`),
        q.type !== "short" && (q.options || []).length
          ? h("ul", { class: "muted", style: "margin:8px 0 0;padding-left:20px" },
              (q.options || []).map(o => h("li", {}, o.text || "—")))
          : null
      )
    );
    questionsBox.appendChild(item);
  });
  list.appendChild(questionsBox);
  page.appendChild(list);

  const actions = h("section", { class: "panel" },
    h("div", { class: "section-title" }, h("h2", {}, "Прохождение")),
    h("p", { class: "muted" },
      isStaff()
        ? "Вы видите тест как автор. Прохождение предназначено для студентов."
        : "Запуск попытки станет доступен, когда администратор платформы включит сохранение попыток: сейчас в правилах Firestore нет коллекций attempts и testKeys, поэтому ответы некуда записать."
    ),
    h("div", { class: "btn-row" },
      isStaff()
        ? h("a", { class: "btn primary", href: "#create-test" }, "Открыть редактор")
        : h("button", { type: "button", class: "btn primary", disabled: "disabled", "aria-disabled": "true" },
            "Начать прохождение")
    )
  );
  page.appendChild(actions);

  return page;
}
