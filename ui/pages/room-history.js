// ui/pages/room-history.js — история завершённых Live-комнат: #room-history
// (список) и #room-history/<код> (повторный просмотр отчёта). Доступ:
// преподаватель — свои комнаты, администратор — комнаты организации
// (правила roomHistory). Отчёт строится из СОХРАНЁННОГО снимка: оценки
// не пересчитываются и не изменяются; недостающие поля старых записей
// показываются честным «—», не выдумываются. Компоненты — те же, что на
// итоговом экране Live (параллельной системы отчётов нет).
import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { loadCss } from "../../shared/load-css.js";
import { getRoomHistory, listRoomHistory } from "../../core/rooms.js";
import {
  historyRow, sortHistoryRows, snapshotReport
} from "../../core/room-history.js";
import {
  overviewPanel, reportSection, studentsPanel, journalPanel, recommendationsPanel
} from "../components/live-report.js";
import { avatarChip } from "../components/avatar.js";
import { formatDate } from "../../shared/utils.js";

export default async function RoomHistoryPage() {
  await loadCss("ui/css/live.css");
  const code = decodeURIComponent((State.routeParam || "").split("/")[0] || "");
  return code ? reportPage(code) : listPage();
}

// ---------- Список завершённых комнат ----------

async function listPage() {
  const page = h("div", { class: "page" });
  const body = h("div", {}, h("div", { class: "spinner" }));
  page.append(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "История"),
      h("h1", {}, "Завершённые Live-комнаты")),
    h("div", { class: "page-head-actions" },
      h("a", { class: "btn secondary", href: "#/" }, "На главную"))), body);

  const isAdmin = State.profile?.role === "admin";
  try {
    const docs = isAdmin
      ? await listRoomHistory({ orgId: State.profile.orgId })
      : await listRoomHistory({ hostId: State.user.uid });
    body.replaceChildren(renderList(sortHistoryRows(docs.map(historyRow))));
  } catch (err) {
    console.error("История Live-комнат:", err);
    body.replaceChildren(h("p", { class: "form-error" },
      err?.message || "Не удалось загрузить историю комнат."));
  }
  return page;
}

function renderList(rows) {
  if (!rows.length) {
    return h("div", { class: "panel" },
      h("div", { class: "empty-state" },
        h("h2", {}, "Пока пусто"),
        h("p", { class: "muted" },
          "Завершите Live-комнату — её итоговый отчёт появится здесь и откроется без повторного запуска теста.")));
  }
  return h("div", { class: "history-list" }, rows.map(row => {
    const meta = [row.subjectName, row.topicName].filter(Boolean).join(" · ");
    const duels = row.duelsResolved == null ? ""
      : row.duelsResolved ? " · дуэли разрешены" : " · есть неразрешённые дуэли";
    return h("section", { class: "panel history-item" },
      h("div", { class: "panel-body" },
        h("div", { class: "history-item-head" },
          h("h3", {}, row.testTitle),
          h("span", { class: "badge badge-neutral" },
            `участников: ${row.participants}`)),
        meta ? h("p", { class: "muted" }, meta) : null,
        h("p", { class: "muted" },
          `Завершена: ${row.finishedAtMs ? formatDate({ seconds: row.finishedAtMs / 1000, nanoseconds: (row.finishedAtMs % 1000) * 1e6 }) : "—"} · средняя оценка ${row.averageGrade} · верных ${row.averagePercent}%${duels}`)),
      h("div", { class: "history-item-actions" },
        h("a", { class: "btn primary", href: `#room-history/${row.code}` }, "Открыть отчёт")));
  }));
}

// ---------- Повторный просмотр отчёта ----------

async function reportPage(code) {
  const page = h("div", { class: "page" });
  const body = h("div", {}, h("div", { class: "spinner" }));
  page.append(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "История Live-комнат"),
      h("h1", { id: "rh-title" }, "Загрузка…")),
    h("div", { class: "page-head-actions" },
      h("a", { class: "btn secondary", href: "#room-history" }, "К списку"))), body);

  let snapshot;
  try {
    snapshot = await getRoomHistory(code);
    if (!snapshot) {
      body.replaceChildren(h("div", { class: "panel" },
        h("div", { class: "empty-state" },
          h("h2", {}, "Отчёта нет в истории"),
          h("p", { class: "muted" },
            "Эта комната завершилась до появления истории либо снимок не был сохранён. Частичный отчёт недоступен, данные не выдумываются."))));
      return page;
    }
  } catch (err) {
    console.error("История Live-комнат:", err);
    body.replaceChildren(h("p", { class: "form-error" },
      err?.message || "Не удалось загрузить отчёт."));
    return page;
  }

  page.querySelector("#rh-title").textContent = snapshot.testTitle || `Комната ${code}`;
  body.replaceChildren(renderSnapshot(code, snapshot));
  return page;
}

// Один снимок → один экран: обзор → рейтинг → дуэли → статистика →
// участники → журнал → рекомендации. Все данные уже вычислены и сохранены:
// пересчёт оценок при просмотре не выполняется.
function renderSnapshot(code, snapshot) {
  const report = snapshotReport(snapshot);
  const overview = snapshot.overview || {};
  const nodes = [];

  nodes.push(overviewPanel({
    title: snapshot.testTitle || `Комната ${code}`,
    subject: snapshot.subjectName || "",
    topic: snapshot.topicName || "",
    finishedLabel: snapshot.finishedAtMs
      ? formatDate({ seconds: snapshot.finishedAtMs / 1000, nanoseconds: (snapshot.finishedAtMs % 1000) * 1e6 })
      : "—",
    participants: overview.participants ?? 0,
    observers: overview.observers ?? 0,
    group: report.group,
    verdict: report.verdict
  }));

  nodes.push(ratingPanelFromSnapshot(snapshot));

  if (snapshot.duels) {
    nodes.push(duelsPanelFromSnapshot(snapshot.duels));
  }

  if (report.group || (report.questions || []).length) {
    nodes.push(reportSection(report, { title: "Статистика", sections: ["group", "questions"] }));
  } else {
    nodes.push(h("section", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", {}, "Статистика")),
      h("div", { class: "panel-body" },
        h("p", { class: "muted" }, "В снимке нет статистики по вопросам — комната сохранена до появления этой части истории."))));
  }

  nodes.push(studentsPanel(report, []));
  nodes.push(journalPanel(snapshot.journal || [], {
    grades: snapshot.studentsDetail || [],
    // Экспорт из сохранённого снимка журнала: те же строки, что в таблице.
    export: {
      title: snapshot.testTitle || "",
      dateMs: snapshot.finishedAtMs ?? null
    }
  }));
  nodes.push(recommendationsPanel(report));
  return h("div", { class: "room-history-report" }, nodes);
}

// Рейтинг из снимка: места, ФИО/аватар, очки. Таблица читает сохранённые
// строки — не пересчитывает очки и не трогает учебные оценки.
function ratingPanelFromSnapshot(snapshot) {
  const rows = snapshot.rating || [];
  const body = rows.length
    ? h("div", { class: "table-scroll" },
      h("table", { class: "live-table" },
        h("thead", {}, h("tr", {},
          ["Место", "Участник", "Баллы"].map(t => h("th", {}, t)))),
        h("tbody", {}, rows.map(row => h("tr", { "data-uid": row.uid || "" },
          h("td", {}, String(row.place ?? "—")),
          h("td", {},
            avatarChip(row.avatar, row.name),
            ` ${row.name || "Участник"}`),
          h("td", {}, String(row.score ?? 0)))))))
    : h("p", { class: "muted" }, "В снимке нет строк рейтинга.");
  return h("section", { class: "panel live-rating", "aria-label": "Итоговый рейтинг" },
    h("div", { class: "panel-head" }, h("h2", {}, "Итоговый рейтинг")),
    h("div", { class: "panel-body" }, body));
}

// Дуэли из снимка: статусы групп, счёт и порядок — только для просмотра.
function duelsPanelFromSnapshot(duels) {
  return h("section", { class: "panel duels-panel", "aria-label": "Дуэли за места" },
    h("div", { class: "panel-head" },
      h("h2", {}, "Разрешение ничьих"),
      h("span", {
        class: `badge ${duels.status === "resolved" ? "badge-success" : "badge-neutral"}`
      }, duels.status === "resolved" ? "места распределены"
        : duels.status === "pending" ? "есть неразрешённые" : "статус: идут")),
    h("div", { class: "panel-body" },
      (duels.groups || []).length
        ? h("ul", { class: "live-accuracy" },
          duels.groups.map(g => {
            const names = Object.keys(g.names || {})
              .map(uid => `${g.names[uid]} — ${g.tally?.[uid] ?? 0}`).join("; ");
            const order = (g.order || []).map(uid => g.names?.[uid] || uid).join(" → ");
            const reason = g.stoppedReason ? ` Остановлено: ${g.stoppedReason}.` : "";
            const decision = g.decision ? ` Решение преподавателя (${g.decision.authorUid || ""}): ${g.decision.reason || ""}.` : "";
            return h("li", {},
              `Группа ${g.id || ""} · ${g.status || "—"} · раундов: ${g.rounds ?? 0}. Участники: ${names}.`,
              order ? ` Порядок: ${order}.` : "", reason, decision);
          }))
        : h("p", { class: "muted" }, "Дуэлей не было.")));
}
