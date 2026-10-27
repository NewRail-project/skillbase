// ui/pages/analytics.js — аналитика по тесту: процент верных по вопросам,
// средний балл по группам, вопросы с процентом верных ниже 40%.
// Считается на клиенте по последним 500 попыткам (ANALYTICS_LIMIT);
// ключи — из testKeys, доступных только сотрудникам организации.
// Таблицы и проценты — на CSS, без библиотек.
import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { listPublishedTests } from "../../core/editor.js";
import { listOrgAttempts } from "../../core/attempts.js";
import { db, getDoc, doc } from "../../shared/firebase.js";
import { buildAnalytics, ANALYTICS_LIMIT, LOW_PERCENT_THRESHOLD } from "../../core/analytics-logic.js";
import { icons } from "../../shared/icons.js";
import { toast } from "../components/toast.js";

export default async function AnalyticsPage() {
  const page = h("div", { class: "page" });
  page.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Аналитика"),
      h("h1", {}, "Аналитика по тесту"),
      h("p", { class: "page-sub" },
        `Последние ${ANALYTICS_LIMIT} попыток с ключами из testKeys. ` +
        `Вопросы ниже ${LOW_PERCENT_THRESHOLD}% верных — на пересдачу.`)
    )
  ));

  const keysPerTest = new Map(); // testId → keys map
  let tests = [];
  try {
    tests = await listPublishedTests(State.profile.orgId);
  } catch (err) {
    console.error("Аналитика: тесты:", err);
    page.appendChild(h("div", { class: "panel" },
      h("div", { class: "empty-state" }, h("h2", {}, "Тесты недоступны"),
        h("p", { class: "muted" }, explainError(err))
      )
    ));
    return page;
  }

  const select = h("select", { class: "form-control", "aria-label": "Тест" });
  select.appendChild(h("option", { value: "" }, tests.length ? "Выберите тест" : "Опубликованных тестов нет"));
  tests.forEach(t => {
    select.appendChild(h("option", { value: t.id }, t.title || t.id));
  });
  page.appendChild(h("div", { class: "field analytics-picker" }, select));

  const report = h("div", { class: "analytics-report" });
  page.appendChild(report);

  select.addEventListener("change", () => {
    const testId = select.value;
    if (!testId) { report.textContent = ""; return; }
    loadReport(report, testId, { keysPerTest, orgId: State.profile.orgId, groupIdFilter: isStaff()
    && State.profile?.teacherGroups ? State.profile.teacherGroups : null }).catch(err => {
      console.error("Аналитика:", err);
      toast(explainError(err), "error");
    });
  });

  if (tests.length) {
    select.value = tests[0].id;
    select.dispatchEvent(new Event("change"));
  }

  return page;
}

async function loadReport(report, testId, { keysPerTest, orgId, groupIdFilter }) {
  report.textContent = "";
  report.appendChild(h("div", { class: "panel-body" }, h("div", { class: "spinner" })));

  // Ключи из testKeys (сотрудники организации).
  let keys = {};
  if (!keysPerTest.has(testId)) {
    try {
      const snap = await getDoc(doc(db, "testKeys", testId));
      if (snap.exists()) keys = snap.data().items || snap.data().keys || {};
    } catch (err) {
      console.error("testKeys:", err);
    }
    keysPerTest.set(testId, keys);
  }
  keys = keysPerTest.get(testId);

  let attempts = [];
  try {
    attempts = await listOrgAttempts(orgId, { groupIdFilter });
  } catch (err) {
    console.error("Аналитика: попытки:", err);
    report.textContent = "";
    report.appendChild(h("div", { class: "panel" },
      h("div", { class: "empty-state" }, h("h2", {}, "Попытки недоступны"),
        h("p", { class: "muted" }, explainError(err)))
    ));
    return;
  }
  // Выборка попыток идёт всей организации; фильтр по testId — на клиенте,
  // как и в results.js (rules проверяют каждый документ сама).
  const filtered = attempts.filter(a => a.testId === testId);

  // Вопросы теста: заголовки для таблицы (публичная часть теста).
  const testSnap = await getDoc(doc(db, "tests", testId)).catch(() => null);
  const questions = testSnap?.exists() ? testSnap.data().questions || [] : [];
  const titles = questions.map(q => q.text || "");

  const data = buildAnalytics(filtered, keys);
  drawReport(report, data, titles);
}

function drawReport(report, data, titles) {
  report.textContent = "";
  if (!data.attemptsCount) {
    report.appendChild(h("div", { class: "panel" },
      h("div", { class: "empty-state" },
        h("div", { class: "empty-state-icon", innerHTML: icons.chart }),
        h("h2", {}, "Попыток пока нет"),
        h("p", { class: "muted" }, "Ещё никто не прошёл этот тест.")
      )
    ));
    return;
  }

  report.appendChild(h("div", { class: "quick-actions" },
    h("div", { class: "quick-action" },
      h("b", {}, String(data.attemptsCount)),
      h("span", {}, "попыток в выборке")
    ),
    h("div", { class: "quick-action" },
      h("b", {}, String(data.lowQuestions.length)),
      h("span", {}, `вопросов ниже ${LOW_PERCENT_THRESHOLD}%`)
    )
  ));

  // Проценты верных по вопросам: колонки вопроса, CSS grid.
  if (data.perQuestion.length) {
    const cols = Math.min(data.perQuestion.length, 10);
    const wrap = h("div", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Верно по вопросам")),
      h("div", { class: "panel-body" },
        h("div", {
          class: "question-columns",
          style: `--q-cols:${cols}`
        },
          data.perQuestion.map(q => h("div", { class: "question-col" },
            h("div", { class: "question-col-head" }, `№${Number(q.qid) + 1}`),
            h("div", { class: "question-col-title muted" }, titles[Number(q.qid)] || ""),
            h("div", {
              class: "question-col-bar" + (q.low ? " low" : "")
            },
              h("div", {
                class: "question-col-fill",
                style: `height:${q.percent == null ? 0 : Math.min(100, q.percent)}%`
              })
            ),
            h("div", {
              class: "question-col-value" + (q.low ? " low" : "")
            }, q.percent == null ? "—" : `${q.percent}%`),
            h("div", { class: "muted small" }, `${q.correct} из ${q.attempts}`)
          ))
        ),
        h("div", { class: "table-wrap" }, questionTable(data, titles))
      )
    );
    report.appendChild(wrap);
  }

  // Средний балл по группам.
  if (data.groups.length) {
    report.appendChild(h("div", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Средний балл по группам")),
      h("div", { class: "table-wrap" }, groupTable(data.groups))
    ));
  }

  // Вопросы с низким процентом.
  if (data.lowQuestions.length) {
    report.appendChild(h("div", { class: "panel" },
      h("div", { class: "panel-head" },
        h("h2", {}, `Вопросы ниже ${LOW_PERCENT_THRESHOLD}%`),
        h("span", { class: "badge badge-warning" }, String(data.lowQuestions.length))
      ),
      h("ul", { class: "list low-questions" },
        data.lowQuestions.map(q => h("li", {},
          h("b", {}, `№${Number(q.qid) + 1}`),
          titles[Number(q.qid)] ? h("span", { class: "muted" }, ` — ${titles[Number(q.qid)]}`) : null,
          h("span", { class: "badge badge-warning" }, `${q.percent}%`)
        ))
      )
    ));
  }
}

function questionTable(data, titles) {
  const table = h("table", { class: "table analytics-table" },
    h("thead", {}, h("tr", {},
      h("th", {}, "Вопрос"), h("th", {}, "Верно"),
      h("th", {}, "Отвечали"), h("th", {}, "%")))
  );
  const tbody = h("tbody");
  data.perQuestion.forEach(q => {
    tbody.appendChild(h("tr", {},
      h("td", {}, `№${Number(q.qid) + 1}`,
        titles[Number(q.qid)] ? h("div", { class: "list-row-sub muted" }, titles[Number(q.qid)]) : null),
      h("td", {}, `${q.correct}`),
      h("td", {}, `${q.answered} из ${q.attempts}`),
      h("td", {}, h("span", {
        class: "badge " + (q.low ? "badge-warning" : "badge-success")
      }, q.percent == null ? "—" : `${q.percent}%`))
    ));
  });
  table.appendChild(tbody);
  return table;
}

function groupTable(groups) {
  const table = h("table", { class: "table analytics-table" },
    h("thead", {}, h("tr", {},
      h("th", {}, "Группа"), h("th", {}, "Попыток"),
      h("th", {}, "Средний %"), h("th", {}, "Мин — макс")))
  );
  const tbody = h("tbody");
  groups.forEach(g => {
    tbody.appendChild(h("tr", {},
      h("td", {}, g.groupId),
      h("td", {}, String(g.attempts)),
      h("td", {}, h("span", {
        class: "badge " + (g.avgPercent < LOW_PERCENT_THRESHOLD ? "badge-warning" : "badge-success")
      }, `${g.avgPercent}%`)),
      h("td", { class: "muted" }, `${g.minPercent}% — ${g.maxPercent}%`)
    ));
  });
  table.appendChild(tbody);
  return table;
}

function explainError(err) {
  if (err?.code === "permission-denied") {
    return "Правила Firestore не разрешают чтение (нужна роль преподавателя или администратора).";
  }
  return "Не удалось загрузить данные. Проверьте подключение к сети.";
}
