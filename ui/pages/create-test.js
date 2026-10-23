import { State } from "../../core/auth.js";
import { parseQuizText, createTest } from "../../core/editor.js";
import { escapeHtml } from "../../shared/utils.js";
import { empty } from "../../ui/components/empty.js";
import { error } from "../../ui/components/error.js";
import { confirm } from "../../ui/components/confirm.js";

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
    <div class="header-section">
      <div class="logo-bar">
        <svg width="24" height="24" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M16 48L240 48" stroke-linecap="round"/>
          <path d="M16 96L240 96" stroke-linecap="round"/>
          <path d="M16 64L20 80" stroke-linecap="round"/>
          <path d="M48 64L52 80" stroke-linecap="round"/>
          <path d="M80 64L84 80" stroke-linecap="round"/>
          <path d="M112 64L116 80" stroke-linecap="round"/>
          <path d="M144 64L148 80" stroke-linecap="round"/>
          <path d="M176 64L180 80" stroke-linecap="round"/>
          <path d="M208 64L212 80" stroke-linecap="round"/>
        </svg>
      </div>
      <h2>Создание теста</h2>
    </div>
    <div class="form-container">
      <div class="form-group">
        <label for="title">Название</label>
        <input id="title" class="form-control" maxlength="150" placeholder="Например: Основы электробезопасности" />
      </div>
      <div class="form-group">
        <label for="time">Секунд на вопрос (0 — без лимита)</label>
        <input id="time" type="number" min="0" max="3600" value="30" class="form-control" />
      </div>
      <div class="form-group">
        <label for="quiz-text">Текст теста</label>
        <textarea id="quiz-text" placeholder="Вставьте вопросы..." class="form-control"></textarea>
      </div>
      <details class="muted" style="margin-bottom:12px">
        <summary>Формат и пример</summary>
        <p>Вопрос: «1. Текст». Варианты: «A) …». Правильный: добавьте <b>[правильный]</b>, <b>[+]</b> или <b>*</b> в конце. Несколько правильных = множественный выбор. Короткий ответ: «Ответ: …» в строке вопроса.</p>
        <pre style="white-space:pre-wrap">${escapeHtml(EXAMPLE)}</pre>
        <button type="button" class="secondary" id="example-btn">Вставить пример</button>
      </details>
      <button type="button" id="parse-btn" class="primary">Разобрать</button>
      <div id="preview" class="preview-container"></div>
    </div>
  `;

  const $ = (s) => div.querySelector(s);
  let parsed = null;

  const preview = div.querySelector("#preview");
  const saveMsg = div.querySelector("#save-msg");

  const exampleBtn = div.querySelector("#example-btn");
  const parseBtn = div.querySelector("#parse-btn");

  exampleBtn.addEventListener("click", () => {
    $("#quiz-text").value = EXAMPLE;
  });

  parseBtn.addEventListener("click", () => {
    const quizText = $("#quiz-text").value;
    parsed = parseQuizText(quizText);
    const { questions, errors } = parsed;
    const ok = questions.length > 0 && errors.length === 0;

    preview.innerHTML = `
      ${errors.length ? `<div class="error-state">
        <p class="error-msg">Исправьте ошибки:</p>
        <ul>
          ${errors.map(e => `<li>${escapeHtml(e)}</li>`).join("")}
        </ul>
      </div>` : ""}
      ${questions.length === 0 && !errors.length ? `<div class="empty-state">
        <p>Вопросы не найдены.</p>
      </div>` : ""}
      ${questions.map((q, i) => {
        const icon = $(`#icon-${i}`);
        return `<div class="q-preview">
          <div class="question-header">
            <b>${i + 1}. ${escapeHtml(q.text)}</b>
            <span class="tag ${q.type}">
              ${q.type === "short" ? "короткий" : q.type === "multiple" ? "несколько" : "один ответ"}
            </span>
          </div>
          ${q.type === "short" ? `<div class="opt-ok">Ответ: ${escapeHtml(q.answer)}</div>` : 
            q.options.map(o => `<div class="option ${o.correct ? "option-correct" : ""}">
              ${o.correct ? "✓" : "•"} ${escapeHtml(o.text)}</div>`).join("")}
        </div>`;
      }).join("")}
      ${ok ? `<div class="btn-row">
        <button type="button" class="secondary" data-status="draft">Сохранить черновик</button>
        <button type="button" data-status="published" class="primary">Опубликовать</button>
      </div>` : ""}
    `;

    if (questions.length > 0) {
      questions.forEach((q, i) => {
        const previewItem = div.querySelector(`.q-preview:nth-of-type(${i + 1})`);
        if (previewItem) {
          previewItem.innerHTML = preview.innerHTML;
        }
      });
    }
  });

  div.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-status]");
    if (!btn || !parsed) return;
    
    const title = $("#title").value.trim();
    if (!title) {
      saveMsg.className = "error-msg";
      saveMsg.textContent = "Укажите название теста.";
      saveMsg.hidden = false;
      return;
    }
    
    const time = Math.max(0, Math.min(3600, parseInt($("#time").value, 10) || 0));
    
    const confirmDialog = confirm({
      text: "Вы уверены, что хотите опубликовать тест?",
      actionText: "Да",
      cancelText: "Отмена",
      onConfirm: async () => {
        try {
          await createTest({
            title, parsed,
            timePerQuestion: time,
            status: btn.dataset.status
          }, State.user, State.profile);
          window.location.hash = "#tests";
        } catch (err) {
          console.error(err);
          saveMsg.className = "error-msg";
          saveMsg.textContent = "Не удалось сохранить: " + (err.code || err.message);
          saveMsg.hidden = false;
        }
      }
    });
  });

  return div;
}