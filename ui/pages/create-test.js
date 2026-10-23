import { State } from "../../core/auth.js";
import { parseQuizText, createTest } from "../../core/editor.js";
import { escapeHtml } from "../../shared/utils.js";

const EXAMPLE = `1. Столица Франции?
A) Берлин
B) Париж [правильный]
C) Рим

2. Какие числа чётные?
A) 2 *
B) 3
C) 4 *

3. Сколько будет 2+2? Ответ: 4`;

export default function () {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `
    <h2>Создание теста</h2>
    <div class="form-group"><label for="title">Название</label>
      <input id="title" class="form-control" maxlength="150" placeholder="Например: Основы электробезопасности" /></div>
    <div class="form-group"><label for="time">Секунд на вопрос (0 — без лимита)</label>
      <input id="time" type="number" min="0" max="3600" value="30" class="form-control" /></div>
    <div class="form-group"><label for="quiz-text">Текст теста</label>
      <textarea id="quiz-text" placeholder="Вставьте вопросы..."></textarea></div>
    <details class="muted" style="margin-bottom:12px"><summary>Формат и пример</summary>
      <p>Вопрос: «1. Текст». Варианты: «A) …». Правильный: добавьте <b>[правильный]</b>, <b>[+]</b> или <b>*</b> в конце. Несколько правильных = множественный выбор. Короткий ответ: «Ответ: …» в строке вопроса.</p>
      <pre style="white-space:pre-wrap">${escapeHtml(EXAMPLE)}</pre>
      <button type="button" class="secondary" id="example-btn">Вставить пример</button></details>
    <button type="button" id="parse-btn">Разобрать</button>
    <div id="preview" style="margin-top:16px"></div>`;

  const $ = (s) => div.querySelector(s);
  let parsed = null;

  $("#example-btn").addEventListener("click", () => { $("#quiz-text").value = EXAMPLE; });

  $("#parse-btn").addEventListener("click", () => {
    const preview = $("#preview");
    parsed = parseQuizText($("#quiz-text").value);
    const { questions, errors } = parsed;
    const ok = questions.length > 0 && errors.length === 0;

    preview.innerHTML = `
      ${errors.length ? `<div class="error-msg" style="text-align:left"><b>Исправьте ошибки:</b><br>${errors.map(escapeHtml).join("<br>")}</div>` : ""}
      ${questions.length === 0 && !errors.length ? `<p class="error-msg">Вопросы не найдены.</p>` : ""}
      ${questions.map((q, i) => `
        <div class="q-preview">
          <b>${i + 1}. ${escapeHtml(q.text)}</b> <span class="tag">${{ single: "один ответ", multiple: "несколько", short: "короткий" }[q.type]}</span>
          ${q.type === "short" ? `<div class="opt-ok">Ответ: ${escapeHtml(q.answer)}</div>`
            : q.options.map(o => `<div class="${o.correct ? "opt-ok" : ""}">${o.correct ? "✓" : "•"} ${escapeHtml(o.text)}</div>`).join("")}
        </div>`).join("")}
      ${ok ? `<div class="btn-row">
          <button type="button" class="secondary" data-status="draft">Сохранить черновик</button>
          <button type="button" data-status="published">Опубликовать</button></div>
        <div id="save-msg" role="alert" hidden style="margin-top:12px"></div>` : ""}`;
  });

  div.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-status]");
    if (!btn || !parsed) return;
    const msg = $("#save-msg");
    const title = $("#title").value.trim();
    if (!title) { msg.className = "error-msg"; msg.textContent = "Укажите название теста."; msg.hidden = false; return; }

    div.querySelectorAll("button[data-status]").forEach(b => (b.disabled = true));
    try {
      await createTest({
        title, parsed,
        timePerQuestion: Math.max(0, Math.min(3600, parseInt($("#time").value, 10) || 0)),
        status: btn.dataset.status
      }, State.user, State.profile);
      window.location.hash = "#tests";
    } catch (err) {
      console.error(err);
      msg.className = "error-msg";
      msg.textContent = "Не удалось сохранить: " + (err.code || err.message);
      msg.hidden = false;
      div.querySelectorAll("button[data-status]").forEach(b => (b.disabled = false));
    }
  });

  return div;
}
