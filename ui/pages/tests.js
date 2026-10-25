import { State, isStaff } from "../../core/auth.js";
import { listMyTests, listPublishedTests, setTestStatus } from "../../core/editor.js";
import { escapeHtml, formatDate } from "../../shared/utils.js";

export default async function () {
  const div = document.createElement("div");
  div.className = "card";
  const staff = isStaff();
  div.innerHTML = `<h2>${staff ? "Мои тесты" : "Доступные тесты"}</h2>
    ${staff ? `<a class="btn" href="#create-test" style="margin-bottom:16px">+ Создать тест</a>` : ""}
    <div id="list" class="stack"><div class="spinner"></div></div>`;
  const list = div.querySelector("#list");

  async function load() {
    try {
      const tests = staff ? await listMyTests(State.user.uid) : await listPublishedTests(State.profile.orgId);
      if (!tests.length) {
        list.innerHTML = `<p class="muted">${staff ? "Вы ещё не создали ни одного теста." : "Пока нет опубликованных тестов."}</p>`;
        return;
      }
      list.innerHTML = tests.map(t => `
        <div class="item">
          <h3>${escapeHtml(t.title)}</h3>
          <p class="muted">Вопросов: ${t.questions?.length || 0} · ${t.timePerQuestion ? t.timePerQuestion + " сек/вопрос" : "без лимита времени"} · ${formatDate(t.createdAt)}</p>
          ${staff
            ? `<p><span class="tag ${t.status === "published" ? "ok" : "wait"}">${t.status === "published" ? "опубликован" : "черновик"}</span></p>
               <div class="row-actions"><button type="button" class="secondary toggle" data-id="${t.id}" data-status="${t.status}">${t.status === "published" ? "Снять с публикации" : "Опубликовать"}</button></div>`
            : `<a class="btn" href="#quiz/${encodeURIComponent(t.id)}">Начать</a>`}
        </div>`).join("");
    } catch (e) {
      console.error(e);
      list.innerHTML = `<p class="error-msg">Не удалось загрузить тесты: ${escapeHtml(e.code || e.message)}</p>`;
    }
  }

  div.addEventListener("click", async (e) => {
    const btn = e.target.closest(".toggle");
    if (!btn) return;
    btn.disabled = true;
    try {
      await setTestStatus(btn.dataset.id, btn.dataset.status === "published" ? "draft" : "published");
    } catch (err) { alert("Ошибка: " + (err.code || err.message)); }
    load();
  });

  await load();
  return div;
}
