import { parseQuizText, updateTest, saveTest, publishTest } from "../../core/editor.js";
import { authErrorMessage } from "../../shared/errors.js";

export default function () {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `
    <h2>Создание теста</h2>
    <div class="form-group">
      <label for="t-title">Название</label>
      <input id="t-title" class="form-control" type="text" maxlength="120" />
    </div>
    <div class="form-group">
      <label for="quiz-text">Вопросы</label>
      <textarea id="quiz-text" class="form-control" rows="10"
        placeholder="1. Столица Франции?&#10;A) Берлин&#10;B) Париж [+]&#10;C) Рим"></textarea>
    </div>
    <p class="hint">Правильный ответ отмечайте [+]. Короткий ответ: «1. Вопрос? Ответ: текст».</p>
    <button type="button" class="primary" id="parse-btn">Разобрать</button>
    <div id="preview"></div>
    <div id="status" role="status"></div>
    <div class="button-group" id="actions" hidden>
      <button type="button" class="secondary" id="save-btn">Сохранить черновик</button>
      <button type="button" class="primary" id="publish-btn">Опубликовать</button>
    </div>
  `;

  const $ = (s) => div.querySelector(s);
  const preview = $("#preview"), status = $("#status"), actions = $("#actions");
  let parsed = null;

  const say = (text, isError) => {
    status.className = isError ? "error-msg" : "success-msg";
    status.textContent = text;
  };

  function renderPreview(result) {
    preview.textContent = "";
    const h = document.createElement("h3");
    h.textContent = `Вопросов: ${result.questions.length}`;
    preview.appendChild(h);

    result.questions.forEach((q, i) => {
      const box = document.createElement("div");
      box.className = "question";
      const t = document.createElement("h4");
      t.textContent = `${i + 1}. ${q.text}`;
      box.appendChild(t);
      if (q.type === "short") {
        const a = document.createElement("div");
        a.className = "option correct";
        a.textContent = `Ответ: ${q.answer}`;
        box.appendChild(a);
      } else {
        const opts = document.createElement("div");
        opts.className = "options";
        q.options.forEach((o) => {
          const row = document.createElement("div");
          row.className = o.correct ? "option correct" : "option";
          row.textContent = (o.correct ? "✓ " : "") + o.text;
          opts.appendChild(row);
        });
        box.appendChild(opts);
      }
      preview.appendChild(box);
    });

    if (result.errors && result.errors.length) {
      const e = document.createElement("div");
      e.className = "error-msg";
      e.textContent = result.errors.join("\n");
      preview.appendChild(e);
    }
  }

  $("#parse-btn").addEventListener("click", async () => {
    status.textContent = "";
    try {
      parsed = await parseQuizText($("#quiz-text").value);
      renderPreview(parsed);
      actions.hidden = !(parsed.questions.length && !(parsed.errors && parsed.errors.length));
    } catch (e) {
      actions.hidden = true;
      say(e.message, true);
    }
  });

  async function persist(publish) {
    const title = $("#t-title").value.trim();
    if (!title) { say("Введите название теста.", true); return; }
    if (!parsed || !parsed.questions.length) { say("Сначала разберите вопросы.", true); return; }
    $("#save-btn").disabled = $("#publish-btn").disabled = true;
    try {
      updateTest({ title, questions: parsed.questions });
      if (publish) await publishTest(); else await saveTest();
      say(publish ? "Тест опубликован." : "Черновик сохранён.", false);
    } catch (e) {
      console.error(e);
      say(e && e.code ? authErrorMessage(e) : (e.message || "Не удалось сохранить."), true);
    } finally {
      $("#save-btn").disabled = $("#publish-btn").disabled = false;
    }
  }
  $("#save-btn").addEventListener("click", () => persist(false));
  $("#publish-btn").addEventListener("click", () => persist(true));

  return div;
}
