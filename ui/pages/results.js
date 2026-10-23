import { State, isStaff } from "../../core/auth.js";
import { listMyAttempts, listOrgAttempts, gradeAttempt } from "../../core/attempts.js";
import { renderTeacherResults, toCsv } from "./teacher-results.js";
import { escapeHtml, formatDate } from "../../shared/utils.js";

export default async function () {
  return isStaff() ? staffView() : studentView();
}

async function studentView() {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `<h2>Мои результаты</h2><div id="list" class="stack"><div class="spinner"></div></div>`;
  const list = div.querySelector("#list");
  try {
    const items = await listMyAttempts(State.user.uid);
    list.innerHTML = items.length ? items.map(a => `
      <div class="item">
        <h3>${escapeHtml(a.testTitle || a.testId)}</h3>
        <p class="muted">${formatDate(a.submittedAt)}</p>
        <p>${a.status === "graded"
          ? `<span class="tag ok">Результат: ${a.score} из ${a.total}</span>`
          : `<span class="tag wait">ожидает проверки</span>`}</p>
      </div>`).join("") : `<p class="muted">Вы ещё не проходили тесты.</p><a class="btn" href="#tests">К тестам</a>`;
  } catch (e) {
    console.error(e);
    list.innerHTML = `<p class="error-msg">Не удалось загрузить: ${escapeHtml(e.code || e.message)}</p>`;
  }
  return div;
}

async function staffView() {
  const div = document.createElement("div");
  div.innerHTML = `<div class="card"><h2>Результаты учеников</h2>
    <button type="button" id="grade-all">Проверить все ожидающие</button>
    <p id="msg" class="muted" style="margin-top:8px"></p></div><div id="table"></div>`;
  const tableBox = div.querySelector("#table");
  const msg = div.querySelector("#msg");
  const keysCache = {};
  let attempts = [];

  const toRows = () => attempts.map(a => ({
    student: a.userEmail, test: a.testTitle,
    score: a.status === "graded" ? `${a.score}/${a.total}` : "—",
    verified: a.status === "graded", attempt: a
  }));

  async function load() {
    try {
      attempts = await listOrgAttempts(State.profile.orgId);
    } catch (e) {
      console.error(e);
      tableBox.innerHTML = `<div class="card"><p class="error-msg">Не удалось загрузить: ${escapeHtml(e.code || e.message)}</p></div>`;
      return;
    }
    const box = document.createElement("div");
    box.className = "card";
    renderTeacherResults(box, {
      rows: toRows(),
      onGrade: async (row) => { await grade([row.attempt]); },
      onExport: (rows) => {
        const url = URL.createObjectURL(new Blob(["\ufeff" + toCsv(rows)], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url; a.download = "results.csv"; a.click();
        URL.revokeObjectURL(url);
      }
    });
    tableBox.replaceChildren(box);
  }

  async function grade(list) {
    msg.textContent = "Проверяем...";
    let ok = 0;
    for (const a of list) {
      try { await gradeAttempt(a, State.user.uid, keysCache); ok++; }
      catch (e) { console.error(e); msg.textContent = "Ошибка проверки: " + (e.code || e.message); return; }
    }
    msg.textContent = `Проверено: ${ok}`;
    await load();
  }

  div.querySelector("#grade-all").addEventListener("click", () => {
    const pending = attempts.filter(a => a.status !== "graded");
    if (!pending.length) { msg.textContent = "Нет ожидающих проверки."; return; }
    grade(pending);
  });

  await load();
  return div;
}
