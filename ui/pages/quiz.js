import { State } from "../../core/auth.js";
import { loadTest } from "../../core/editor.js";
import { submitAttempt } from "../../core/attempts.js";
import { escapeHtml } from "../../shared/utils.js";

export default async function QuizPage({ params }) {
  const div = document.createElement("div");
  div.className = "card";
  const testId = params[0];
  let interval = null;
  div._cleanup = () => clearInterval(interval);

  const fail = (text) => { div.innerHTML = `<p class="error-msg"></p><a class="btn" href="#tests">К списку тестов</a>`; div.querySelector("p").textContent = text; return div; };

  if (!testId) return fail("Тест не указан.");

  let test;
  try {
    test = await loadTest(testId);
  } catch (e) {
    console.error(e);
    return fail("Не удалось загрузить тест: " + (e.code || e.message));
  }
  if (!test || test.status !== "published") return fail("Тест не найден или не опубликован.");
  const qs = test.questions || [];
  if (!qs.length) return fail("В тесте нет вопросов.");

  const answers = {};
  const startedAt = Date.now();
  let idx = 0;
  let busy = false;

  function collect() {
    const q = qs[idx];
    if (q.type === "short") {
      const v = div.querySelector("#short")?.value.trim();
      if (v) answers[idx] = v; else delete answers[idx];
    } else {
      const picked = [...div.querySelectorAll("input[name='answer']:checked")].map(i => Number(i.value));
      if (!picked.length) delete answers[idx];
      else answers[idx] = q.type === "multiple" ? picked : picked[0];
    }
  }

  async function go(step) {
    if (busy) return;
    collect();
    if (idx + step >= qs.length) return finish();
    idx = Math.max(0, idx + step);
    render();
  }

  async function finish() {
    busy = true;
    clearInterval(interval);
    div.innerHTML = `<div class="spinner"></div><p class="muted" style="text-align:center">Отправляем ответы...</p>`;
    try {
      await submitAttempt({ test, answers, startedAt }, State.user, State.profile);
      div.innerHTML = `<h2>Ответы отправлены</h2>
        <p>Вы ответили на ${Object.keys(answers).length} из ${qs.length} вопросов. Результат появится после проверки преподавателем.</p>
        <a class="btn" href="#results">Мои результаты</a>`;
    } catch (e) {
      console.error(e);
      div.innerHTML = `<p class="error-msg"></p><button type="button" id="retry">Отправить ещё раз</button>`;
      div.querySelector("p").textContent = "Не удалось отправить: " + (e.code || e.message);
      div.querySelector("#retry").addEventListener("click", finish);
    }
  }

  function render() {
    clearInterval(interval);
    const q = qs[idx];
    const saved = answers[idx];
    const isMulti = q.type === "multiple";
    const last = idx === qs.length - 1;

    const body = q.type === "short"
      ? `<input type="text" id="short" class="form-control" autocomplete="off" placeholder="Ваш ответ" value="${escapeHtml(saved ?? "")}" />`
      : `<div class="options">${(q.options || []).map((o, i) => {
          const checked = isMulti ? (saved || []).includes(i) : saved === i;
          return `<div class="option"><label><input type="${isMulti ? "checkbox" : "radio"}" name="answer" value="${i}" ${checked ? "checked" : ""}> <span>${escapeHtml(o.text)}</span></label></div>`;
        }).join("")}</div>`;

    div.innerHTML = `
      <h3>${escapeHtml(test.title)}</h3>
      <div class="quiz-progress"><i style="width:${(idx / qs.length) * 100}%"></i></div>
      <p class="muted">Вопрос ${idx + 1} из ${qs.length}${isMulti ? " · выберите все верные" : ""}</p>
      <p><b>${escapeHtml(q.text)}</b></p>
      ${body}
      ${test.timePerQuestion > 0 ? `<p class="timer">Осталось: <span id="t">${test.timePerQuestion}</span> сек</p>` : ""}
      <div class="btn-row" style="margin-top:12px">
        <button type="button" class="secondary" id="prev" ${idx === 0 ? "disabled" : ""}>Назад</button>
        <button type="button" id="next">${last ? "Завершить" : "Далее"}</button>
      </div>`;

    div.querySelector("#prev").addEventListener("click", () => go(-1));
    div.querySelector("#next").addEventListener("click", () => go(1));

    if (test.timePerQuestion > 0) {
      let left = test.timePerQuestion;
      const t = div.querySelector("#t");
      interval = setInterval(() => {
        left--;
        if (t) t.textContent = left;
        if (left <= 0) { clearInterval(interval); go(1); }
      }, 1000);
    }
  }

  render();
  return div;
}
