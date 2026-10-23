import { State, isStaff } from "../../core/auth.js";
import { listMyTests, listPublishedTests, setTestStatus } from "../../core/editor.js";
import { escapeHtml, formatDate } from "../../shared/utils.js";
import { h } from "../../shared/dom.js";
import { empty } from "../../ui/components/empty.js";
import { error } from "../../ui/components/error.js";

export default async function () {
  const div = document.createElement("div");
  div.className = "card";
  const staff = isStaff();
  div.append(
  h("h2", {}, staff ? "Мои тесты" : "Доступные тесты"),
  ...(staff ? [h("a", { class: "btn", href: "#create-test", style: "margin-bottom:16px" }, "+ Создать тест")] : []),
  h("div", { id: "list", class: "stack" }, h("div", { class: "spinner" }))
);
  const list = div.querySelector("#list");

  async function load() {
    try {
      const tests = staff ? await listMyTests(State.user.uid) : await listPublishedTests(State.profile.orgId);
      if (!tests.length) {
        list.replaceChildren(empty({ text: staff ? "Вы ещё не создали ни одного теста." : "Пока нет опубликованных тестов." }));
        return;
      }
      list.innerHTML = tests.map(t => `
        <div class="item">
          <h3>${escapeHtml(t.title)}</h3>
          <p class="muted">Вопросов: ${t.questions?.length || 0} · ${t.timePerQuestion ? t.timePerQuestion + " сек/вопрос" : "без лимита времени"} · ${formatDate(t.createdAt)}</p>
          <span class="status-pills ${t.status === "published" ? "status-ok" : "status-wait"}">
            ${t.status === "published" ? "✓ опубликован" : "● черновик"}
          </span>
          ${staff
            ? `<div class="row-actions"><button type="button" class="secondary toggle" data-id="${t.id}" data-status="${t.status}">${t.status === "published" ? "Снять с публикации" : "Опубликовать"}</button></div>`
            : `<a class="btn" href="#quiz/${encodeURIComponent(t.id)}">Начать</a>`}
        </div>`).join("");
    } catch (e) {
      console.error(e);
      list.replaceChildren(error({ text: "Не удалось загрузить тесты: " + (e.code || e.message) }));
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