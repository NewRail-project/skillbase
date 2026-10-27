import { h } from "../../shared/dom.js";
import {
  parseQuizText, updateTest, saveTest, publishTest, loadTest,
  getCurrentTest, resetTest, validateTestDraft, validateTestForPublish
} from "../../core/editor.js";
import { State, isAdmin } from "../../core/auth.js";
import { serializeTest } from "../../core/import/serializer.js";
import { authErrorMessage } from "../../shared/errors.js";
import { icons } from "../../shared/icons.js";
import { formFromSettings, mergeSettings } from "../../core/settings.js";

const EXAMPLE = `1. Какой сигнал разрешает движение?
A) Красный
B) Зелёный [+]
C) Жёлтый

2. Что означает жёлтый сигнал?
A) Стой
B) Разрешено движение с готовностью остановиться [+]
C) Ограничение скорости`;

function errorText(err) {
  if (err?.code === "permission-denied") {
    return "Правила Firestore не разрешают запись теста.";
  }
  if (err?.code === "unavailable") {
    return "Нет связи с Firestore. Проверьте подключение к интернету.";
  }
  return err?.message || authErrorMessage(err);
}

function errorPage(title, text, action) {
  return h("div", { class: "page" },
    h("div", { class: "panel" },
      h("div", { class: "empty-state" },
        h("div", { class: "empty-state-icon", innerHTML: icons.book }),
        h("h2", {}, title),
        h("p", { class: "muted" }, text),
        action
      )
    )
  );
}

function hasStoredKeys(test) {
  const questions = Array.isArray(test?.questions) ? test.questions : [];
  return questions.some(question => {
    if (question?.type === "short") return Boolean(question.answer);
    return (question?.options || []).some(option => option?.correct === true);
  });
}

export default async function CreateTestPage() {
  const editId = decodeURIComponent((State.routeParam || "").split("/")[0] || "");
  const back = h("a", { class: "btn secondary", href: "#tests" }, "Мои тесты");
  let editing = null;

  if (editId) {
    try {
      editing = await loadTest(editId);
    } catch (err) {
      return errorPage(
        "Не удалось открыть тест",
        err?.code === "permission-denied"
          ? "Правила Firestore не разрешают чтение этого теста."
          : errorText(err),
        back
      );
    }

    if (!editing) {
      return errorPage("Тест не найден", "Возможно, он был удалён или ссылка устарела.", back);
    }

    if (editing.authorId !== State.user?.uid && !isAdmin()) {
      return errorPage(
        "Нет прав на редактирование",
        "Редактировать тест может только автор или администратор организации.",
        h("div", { class: "btn-row" },
          h("a", { class: "btn secondary", href: `#quiz/${encodeURIComponent(editId)}` }, "Открыть просмотр"),
          back
        )
      );
    }
  } else if (getCurrentTest().id) {
    // После сохранения предыдущего теста currentTest хранит его id.
    // Без сброса новая форма перезаписала бы старый документ.
    resetTest();
  }

  const saveLabel = editId ? "Сохранить изменения" : "Сохранить черновик";
  const page = h("div", { class: "page" });
  let parsed = null;

  page.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Преподавателю"),
      h("h1", {}, editId ? "Редактирование теста" : "Создание теста"),
      h("p", { class: "page-sub" }, editId
        ? "Изменения сохраняются в тот же тест: ID, автор и версия не меняются."
        : "Вставьте вопросы в текстовом формате или соберите их вручную. Проверьте предпросмотр перед публикацией.")
    ),
    h("div", { class: "page-head-actions" }, back)
  ));

  const status = h("div", {
    class: "form-error", role: "status", "aria-live": "polite",
    style: "white-space:pre-line"
  });

  const warnings = h("div", {
    class: "form-hint", role: "status", "aria-live": "polite",
    style: "white-space:pre-line"
  });

  const titleInput = h("input", {
    type: "text", id: "t-title", maxlength: "120",
    placeholder: "Например: Охрана труда на перегоне", autocomplete: "off"
  });
  const descriptionInput = h("textarea", {
    id: "t-description", rows: "2", placeholder: "Короткое описание для каталога"
  });
  const quizText = h("textarea", {
    id: "quiz-text", rows: "12", spellcheck: "false",
    placeholder: EXAMPLE
  });
  const parseBtn = h("button", { type: "button", class: "btn primary" }, "Разобрать вопросы");

  // ---- Настройки теста ----
  // Начальные значения берём из загружаемого теста или из черновика.
  const initialSettings = formFromSettings((editing || getCurrentTest()).settings);
  const checkbox = (id, label, checked) => {
    const input = h("input", { type: "checkbox", id, checked });
    input.checked = checked;
    return { input, row: h("label", { class: "option", for: id, style: "display:flex;gap:var(--space-2);align-items:center;cursor:pointer" }, input, h("span", {}, label)) };
  };
  const numberField = (id, label, value, hint, attrs = {}) => {
    const input = h("input", { type: "number", id, inputmode: "numeric", step: "1", ...attrs });
    input.value = value;
    return { input, field: h("div", { class: "field" }, h("label", { for: id }, label), input, h("span", { class: "form-hint" }, hint)) };
  };
  const selectField = (id, label, value, options, hint) => {
    const input = h("select", { id }, options.map(([val, text]) => h("option", { value: val }, text)));
    input.value = value;
    if (input.value !== value) input.value = options[0][0];
    return { input, field: h("div", { class: "field" }, h("label", { for: id }, label), input, h("span", { class: "form-hint" }, hint)) };
  };
  const shuffleQ = checkbox("s-shuffle-q", "Перемешивать вопросы", initialSettings.shuffleQuestions);
  const shuffleO = checkbox("s-shuffle-o", "Перемешивать варианты ответов", initialSettings.shuffleOptions);
  const perQuestion = numberField("s-per-question", "Время на вопрос, сек", initialSettings.timePerQuestionSec,
    "От 5 до 3600. Пусто — без ограничения. В live задаёт таймер вопроса у ведущего.", { min: "5", max: "3600", placeholder: "—" });
  const totalTime = numberField("s-total", "Время на тест, мин", initialSettings.totalTimeMin,
    "От 1 до 480. Пусто — без ограничения. Если указано, оно главнее времени на вопрос.", { min: "1", max: "480", placeholder: "—" });
  const passScore = numberField("s-pass", "Проходной балл, %", initialSettings.passScore,
    "От 1 до 100. Пусто — без проходного балла.", { min: "1", max: "100", placeholder: "—" });
  const attempts = numberField("s-attempts", "Попыток на ученика", initialSettings.attemptsLimit,
    "От 1 до 50. При выключенных повторных попытках принудительно 1.", { min: "1", max: "50" });

  const onQuestionTimeout = selectField("s-q-timeout", "Истекло время вопроса",
    initialSettings.onQuestionTimeout,
    [["lock", "Блокировать, идти дальше самому"], ["next", "Автопереход к следующему"]],
    "Работает только при заданном времени на вопрос. «Блокировать»: вопрос нельзя заполнить после истечения, ученик переходит сам. «Автопереход»: вопрос без ответа, экран сам идёт далее. В live то же самое, но решает ведущий/сервер.");
  const onTotalTimeout = selectField("s-t-timeout", "Истекло общее время",
    initialSettings.onTotalTimeout,
    [["submit", "Автоотправка сохранённых ответов"], ["expire", "Попытка просрочена, не оценивается"]],
    "«Автоотправка» в ученическом тесте отправит то, что успели; «Просрочена» пометит попытку как просроченную без оценки. В live не применяется: ведущий закрывает вопрос сам.");
  const answerPolicyField = selectField("s-policy", "Политика ответов",
    initialSettings.answerPolicy,
    [["final", "Ответ фиксируется кнопкой"], ["changeable", "Можно менять и возвращаться"]],
    "«Фиксируется»: после нажатия «Ответить» вернуться нельзя. «Можно менять»: свободное редактирование до отправки. В live совпадает с ученическим режимом.");
  const showCorrectField = checkbox("s-show-correct", "Показать верный ответ после вопроса", initialSettings.showCorrectAfterQuestion);
  const allowRetakeField = checkbox("s-allow-retake", "Разрешить повторные попытки", initialSettings.allowRetake);
  const showLeaderboardField = checkbox("s-leaderboard", "Таблица результатов участникам (live)", initialSettings.showLeaderboard);

  const policyDependent = () => { showCorrectField.input.disabled = answerPolicyField.input.value !== "final"; };
  const retakeDependent = () => {
    const disabled = !allowRetakeField.input.checked;
    attempts.input.disabled = disabled;
    attempts.input.value = disabled ? "1" : attempts.input.value || "3";
  };
  answerPolicyField.input.addEventListener("change", policyDependent);
  allowRetakeField.input.addEventListener("change", retakeDependent);
  policyDependent();
  retakeDependent();

  // Поля теста, влияющие на каталог и старт (не settings, но в этой же форме).
  const categoryInput = h("input", { type: "text", id: "t-category", maxlength: "40",
    placeholder: "Например, Охрана труда" });
  const colorSelect = h("select", { id: "t-color" },
    [["", "Без цвета (по умолчанию)"], ["1", "Акцент"], ["2", "Дополнительный"], ["3", "Сигнальный"], ["4", "Спокойный"]]
      .map(([v, t]) => h("option", { value: v }, t)));
  colorSelect.value = String((editing || getCurrentTest()).color ?? "");
  const instructionsInput = h("textarea", { id: "t-instructions", rows: "3", maxlength: "2000",
    placeholder: "Что ученик должен знать перед стартом" });
  instructionsInput.value = (editing || getCurrentTest()).instructions || "";

  const settingsBox = h("fieldset", { class: "field", style: "border:1px solid var(--border);border-radius:var(--radius, 8px);padding:var(--space-3)" },
    h("legend", {}, "Настройки теста"),
    h("div", { class: "options" }, shuffleQ.row, shuffleO.row, allowRetakeField.row, showLeaderboardField.row),
    h("div", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--space-3);margin-top:var(--space-3)" },
      perQuestion.field, totalTime.field, passScore.field, attempts.field),
    h("div", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--space-3);margin-top:var(--space-3)" },
      onQuestionTimeout.field, onTotalTimeout.field, answerPolicyField.field),
    h("div", { class: "options", style: "margin-top:var(--space-3)" },
      showCorrectField.row)
  );

  const catalogBox = h("fieldset", { class: "field", style: "border:1px solid var(--border);border-radius:var(--radius, 8px);padding:var(--space-3)" },
    h("legend", {}, "Каталог и старт"),
    h("div", { class: "field" }, h("label", { for: "t-category" }, "Категория"),
      categoryInput, h("span", { class: "form-hint" }, "Фильтр в каталоге тестов.")),
    h("div", { class: "field" }, h("label", { for: "t-color" }, "Цвет карточки"),
      colorSelect, h("span", { class: "form-hint" }, "Цвет обложки в каталоге (live — у бейджа комнаты).")),
    h("div", { class: "field" }, h("label", { for: "t-instructions" }, "Инструкция перед стартом"),
      instructionsInput, h("span", { class: "form-hint" }, "Показывается на странице теста до начала попытки."))
  );

  function readSettingsForm() {
    return {
      shuffleQuestions: shuffleQ.input.checked,
      shuffleOptions: shuffleO.input.checked,
      timePerQuestionSec: perQuestion.input.value,
      totalTimeMin: totalTime.input.value,
      onQuestionTimeout: onQuestionTimeout.input.value,
      onTotalTimeout: onTotalTimeout.input.value,
      passScore: passScore.input.value,
      attemptsLimit: attempts.input.value,
      allowRetake: allowRetakeField.input.checked,
      answerPolicy: answerPolicyField.input.value,
      showLeaderboard: showLeaderboardField.input.checked,
      showCorrectAfterQuestion: showCorrectField.input.checked && answerPolicyField.input.value === "final"
    };
  }

  function readCatalogForm() {
    return {
      category: categoryInput.value.trim(),
      color: colorSelect.value,
      instructions: instructionsInput.value
    };
  }

  const actions = h("div", { class: "btn-row", hidden: "hidden" },
    h("button", { type: "button", class: "btn secondary", id: "save-btn" }, saveLabel),
    h("button", { type: "button", class: "btn primary", id: "publish-btn" }, "Опубликовать")
  );

  const editor = h("form", { class: "panel", novalidate: "novalidate", onsubmit: (event) => event.preventDefault() },
    h("div", { class: "field" },
      h("label", { for: "t-title" }, "Название"),
      titleInput
    ),
    h("div", { class: "field" },
      h("label", { for: "t-description" }, "Описание"),
      descriptionInput
    ),
    h("div", { class: "field" },
      h("label", { for: "quiz-text" }, "Вопросы"),
      quizText,
      h("span", { class: "form-hint" },
        "Правильный ответ отмечайте [+], [правильный] или * в конце строки. Несколько отмеченных вариантов — вопрос с множественным выбором. Короткий ответ: «Ответ: текст».")
    ),
    settingsBox,
    catalogBox,
    status,
    warnings,
    h("div", { class: "btn-row" }, parseBtn),
    actions
  );

  const preview = h("section", { class: "panel" },
    h("div", { class: "section-title" },
      h("h2", {}, "Предпросмотр"),
      h("span", { class: "muted", id: "preview-count" }, "не разобрано")
    ),
    h("div", { id: "preview-body" },
      h("div", { class: "empty-state" },
        h("div", { class: "empty-state-icon", innerHTML: icons.book }),
        h("p", { class: "muted" }, "Вставьте вопросы и нажмите «Разобрать вопросы».")
      )
    )
  );

  page.append(h("div", { class: "split" }, editor, preview));

  const previewBody = preview.querySelector("#preview-body");
  const previewCount = preview.querySelector("#preview-count");

  if (editing) {
    titleInput.value = editing.title || "";
    descriptionInput.value = editing.description || "";
    quizText.value = serializeTest(editing);
  }

  function say(text, isError) {
    status.textContent = text || "";
    status.className = isError ? "form-error" : "form-hint";
    status.style.color = isError ? "" : "var(--ok)";
  }

  function sayWarnings(list) {
    const items = Array.isArray(list) ? list.filter(Boolean) : [];
    warnings.textContent = items.length ? "Предупреждения:\n" + items.join("\n") : "";
  }

  function renderPreview(result) {
    previewBody.textContent = "";
    previewCount.textContent = `${result.questions.length} вопросов`;

    if (!result.questions.length) {
      previewBody.appendChild(h("div", { class: "empty-state" },
        h("p", { class: "muted" }, "Вопросы не распознаны. Проверьте формат.")
      ));
    }

    result.questions.forEach((q, i) => {
      const box = h("div", { class: "item" },
        h("div", { class: "list-row-title" }, `${i + 1}. ${q.text}`),
        h("div", { class: "list-row-sub" },
          `${q.type === "short" ? "Короткий ответ" : q.type === "multiple" ? "Несколько ответов" : "Один ответ"} · ${q.points || 1} б.`)
      );
      if (q.type === "short") {
        box.appendChild(h("div", { class: "option correct" }, `Ответ: ${q.answer}`));
      } else {
        const opts = h("div", { class: "options" });
        (q.options || []).forEach(o => {
          opts.appendChild(h("div", { class: o.correct ? "option correct" : "option" },
            (o.correct ? "✓ " : "") + o.text));
        });
        box.appendChild(opts);
      }
      previewBody.appendChild(box);
    });

    if (result.errors?.length) {
      previewBody.appendChild(h("div", { class: "form-error" }, result.errors.join("\n")));
    }
  }

  async function runParse() {
    say("");
    sayWarnings([]);
    try {
      parsed = await parseQuizText(quizText.value);
      renderPreview(parsed);
      const warningsFound = (parsed.structuredErrors || [])
        .filter(item => item.severity === "warning")
        .map(item => item.message);
      sayWarnings(warningsFound);
      const ok = parsed.questions.length && !(parsed.errors && parsed.errors.length);
      actions.hidden = !ok;
      if (!ok) say("Исправьте ошибки в вопросах — публикация недоступна.", true);
      else say(`Распознано вопросов: ${parsed.questions.length}.`, false);
    } catch (e) {
      actions.hidden = true;
      say(e.message, true);
    }
  }

  parseBtn.addEventListener("click", runParse);

  async function persist(publish) {
    say("");
    sayWarnings([]);
    const title = titleInput.value.trim();
    if (!title) { say("Введите название теста.", true); titleInput.focus(); return; }
    if (!parsed || !parsed.questions.length) { say("Сначала разберите вопросы.", true); return; }

    const saveBtn = actions.querySelector("#save-btn");
    const publishBtn = actions.querySelector("#publish-btn");
    saveBtn.disabled = publishBtn.disabled = true;
    const label = publish ? "Публикуем…" : "Сохраняем…";
    (publish ? publishBtn : saveBtn).textContent = label;

    try {
      // Проверяем ровно тот объект, который будет сохранён: настройки
      // (mode, settings) берутся из текущего теста, а не подставляются здесь.
      // Служебные Timestamp-поля не клонируем через JSON: editor сохраняет
      // исходные значения документа при обновлении.
      const base = getCurrentTest();
      delete base.createdAt;
      delete base.updatedAt;
      delete base.publishedAt;
      const draft = {
        ...base,
        title,
        description: descriptionInput.value.trim(),
        ...readCatalogForm(),
        questions: parsed.questions,
        settings: mergeSettings(base.settings, readSettingsForm())
      };

      const validation = publish
        ? validateTestForPublish(draft)
        : validateTestDraft(draft);
      sayWarnings(validation.warnings);

      if (validation.errors.length) {
        say(validation.errors.join("\n"), true);
        return;
      }

      updateTest(draft);

      if (publish) await publishTest();
      else await saveTest();
      say(publish ? "Тест опубликован." : (editId ? "Изменения сохранены." : "Черновик сохранён."), false);
    } catch (e) {
      if (e?.code === "validation") {
        say((e.errors?.length ? e.errors : [e.message]).join("\n"), true);
        sayWarnings(e.warnings || []);
      } else {
        console.error(e);
        say(errorText(e), true);
      }
    } finally {
      saveBtn.disabled = publishBtn.disabled = false;
      saveBtn.textContent = saveLabel;
      publishBtn.textContent = "Опубликовать";
    }
  }

  actions.querySelector("#save-btn").addEventListener("click", () => persist(false));
  actions.querySelector("#publish-btn").addEventListener("click", () => persist(true));

  if (editId && editing) {
    await runParse();
    if (!hasStoredKeys(editing)) {
      sayWarnings([
        "Не удалось загрузить правильные ответы из testKeys. Проверьте отметки [+] и ответы вручную перед сохранением."
      ]);
    }
  }

  return page;
}
