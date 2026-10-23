import { State, isStaff } from "../../core/auth.js";
import { listMyAttempts, listOrgAttempts, gradeAttempt } from "../../core/attempts.js";
import { renderTeacherResults, toCsv } from "../../ui/pages/teacher-results.js";
import { escapeHtml, formatDate } from "../../shared/utils.js";
import { empty } from "../../ui/components/empty.js";
import { error } from "../../ui/components/error.js";

function studentResultCard(attempt) {
  return `<div class="result-card">
    <h3>${escapeHtml(attempt.testTitle || attempt.testId)}</h3>
    <p class="muted">${formatDate(attempt.submittedAt)}</p>
    <span class="status-pills ${attempt.status === "graded" ? "status-ok" : "status-wait"}">
      ${attempt.status === "graded" ? `✓ ${attempt.score} из ${attempt.total}` : `◐ ожидает проверки`}
    </span>
  </div>`;
}

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
    if (!items.length) {
      list.replaceChildren(empty({
        text: "Вы ещё не проходили тесты.",
        actionText: "К тестам",
        onAction: () => window.location.hash = "#tests"
      }));
      return div;
    }
    
    list.innerHTML = items.map(attempt => studentResultCard(attempt)).join("");
  } catch (e) {
    console.error(e);
    list.replaceChildren(error({
      text: "Не удалось загрузить: " + (e.code || e.message),
      retryText: "Повторить"
    }));
  }
  
  return div;
}

async function staffView() {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `<div class="header-section">
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
    <h2>Результаты учеников</h2>
  </div>
  <div class="search-container">
    <input type="text" id="search" class="form-control" placeholder="Поиск по email" />
  </div>
  <div id="table"></div>`;
  
  const tableBox = div.querySelector("#table");
  const searchInput = div.querySelector("#search");
  const msg = document.createElement("div");
  msg.className = "muted";
  msg.textContent = "Пока нет данных.";
  div.querySelector(".tr-header").appendChild(msg);
  
  let attempts = [];
  
  const toRows = () => attempts.map(a => (
    {
      student: a.userEmail,
      test: a.testTitle,
      score: a.status === "graded" ? `${a.score} из ${a.total}` : "—",
      verified: a.status === "graded",
      attempt: a
    }
  )));
  
  async function load() {
    try {
      attempts = await listOrgAttempts(State.profile.orgId);
      const filteredAttempts = attempts.filter(a => a.userEmail.includes(searchInput.value) || searchInput.value === "");
      
      if (!filteredAttempts.length) {
        msg.textContent = "Нет результатов для поиска.";
        tableBox.innerHTML = "";
        return;
      }
      
      const box = document.createElement("div");
      renderTeacherResults(box, {
        rows: filteredAttempts.map(a => (
          {
            student: a.userEmail,
            test: a.testTitle,
            score: a.status === "graded" ? `${a.score} из ${a.total}` : "—",
            verified: a.status === "graded",
            attempt: a
          }
        )),
        onGrade: async (row) => { await grade([row.attempt]); },
        onExport: (rows) => {
          const url = URL.createObjectURL(new Blob(["\ufeff" + toCsv(rows)], { type: "text/csv;charset=utf-8" }));
          const a = document.createElement("a");
          a.href = url;
          a.download = "results.csv";
          a.click();
          URL.revokeObjectURL(url);
        }
      });
      
      tableBox.replaceChildren(box);
    } catch (e) {
      console.error(e);
      tableBox.innerHTML = `<div class="error-state">
        <p class="error-msg">Не удалось загрузить: ${escapeHtml(e.code || e.message)}</p>
      </div>`;
    }
  }

  async function grade(list) {
    msg.textContent = "Проверяем...";
    let ok = 0;
    for (const a of list) {
      try {
        await gradeAttempt(a, State.user.uid);
        ok++;
      } catch (e) {
        console.error(e);
        msg.textContent = "Ошибка проверки: " + (e.code || e.message);
        return;
      }
    }
    msg.textContent = `Проверено: ${ok} из ${list.length}.";
    await load();
  }

  searchInput.addEventListener("input", async () => {
    await load();
  });

  div.querySelector("#grade-all").addEventListener("click", () => {
    const pending = attempts.filter(a => a.status !== "graded" && attempts.some(att => att.userEmail.includes(searchInput.value)));
    if (!pending.length) {
      msg.textContent = "Нет ожидающих проверки.";
      return;
    }
    grade(pending);
  });

  await load();
  return div;
}