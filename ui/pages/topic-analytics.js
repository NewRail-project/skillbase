// ui/pages/topic-analytics.js — аналитика учебной темы (#topic-analytics/<id>).
// Показатели темы по попыткам, распределение оценок, сложные вопросы.
import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { getTopic, getSubject } from "../../core/subjects.js";
import { listOrgAttempts } from "../../core/attempts.js";
import { listOrgUsers } from "../../core/admins.js";
import { getTestKeys } from "../../core/editor.js";
import { teacherCanSeeAttempt } from "../../core/access.js";
import {
  topicAnalytics, buildAnalytics, topicStudentRows, TOPIC_STATUS_LABELS, TOPIC_PASS_PERCENT
} from "../../core/analytics-logic.js";
import { gradeLabel, earnedLabel } from "../../core/score-format.js";
import { barChart, progressMeter } from "../components/charts.js";
import { loading } from "../components/loading.js";
import { error as errorState } from "../components/error.js";

const stat = (label, value, sub) => h("div", { class: "quick-action" },
  h("b", {}, String(value)), h("span", {}, label), sub ? h("small", { class: "muted" }, sub) : null);
const pct = (v) => (v === null || v === undefined ? "—" : `${v}%`);
const dateRu = (ms) => (ms ? new Date(ms).toLocaleDateString("ru-RU") : "—");

// ФИО по алфавиту, статус и баллы. Все, кто назначен на тему, видны даже без попыток.
function studentsTable(rows) {
  return h("section", { class: "panel" },
    h("div", { class: "panel-head" }, h("h2", {}, "Ученики и оценки")),
    h("div", { class: "panel-body" }, rows.length
      ? h("div", { class: "analytics-table-wrap" },
        h("table", { class: "analytics-table" },
          h("thead", {}, h("tr", {},
            ["ФИО", "Статус", "Попыток", "Лучший балл", "Набрано", "Последний", "Дата"].map(c => h("th", {}, c)))),
          h("tbody", {}, rows.map(r => h("tr", { class: `topic-row-${r.status}` },
            h("td", {}, r.name),
            h("td", {}, TOPIC_STATUS_LABELS[r.status]),
            h("td", {}, String(r.attemptsCount)),
            h("td", {}, gradeLabel(r.bestScore)),
            h("td", {}, earnedLabel(r.bestEarned, r.bestMax)),
            h("td", {}, gradeLabel(r.latestScore)),
            h("td", {}, dateRu(r.latestMs)))))))
      : h("p", { class: "muted" }, "Назначенных учеников и попыток по теме пока нет.")),
    h("p", { class: "muted stat-hint" }, `Оценка — в баллах (0–100); «Сдал» — от ${TOPIC_PASS_PERCENT} б. Здесь обычные прохождения; результаты Live-комнат смотрите в Live-отчёте.`));
}

export default async function TopicAnalyticsPage() {
  const page = h("div", { class: "page" });
  if (!isStaff()) {
    page.append(h("section", { class: "panel" }, h("p", { class: "muted" }, "Аналитика доступна сотрудникам организации.")));
    return page;
  }
  const id = (State.routeParam || "").split("/")[0];
  const body = h("div", {});
  page.appendChild(body);

  async function load() {
    body.replaceChildren(loading());
    try {
      const topic = id ? await getTopic(id) : null;
      if (!topic) {
        body.replaceChildren(h("section", { class: "panel" }, h("div", { class: "empty-state" },
          h("h2", {}, "Тема не найдена"), h("a", { class: "btn secondary", href: "#analytics" }, "К аналитике"))));
        return;
      }
      const orgId = State.profile.orgId;
      const [subject, allAttempts, users] = await Promise.all([
        topic.subjectId ? getSubject(topic.subjectId).catch(() => null) : null,
        listOrgAttempts(orgId, { topicId: id }),
        listOrgUsers(orgId)
      ]);
      const attempts = allAttempts.filter(a => teacherCanSeeAttempt(a, State.profile, State.user?.uid));
      const students = users.filter(u => u.role === "student"
        && (!topic.groupId || u.groupId === topic.groupId));

      // Сложные вопросы: берём тест темы с наибольшим числом попыток.
      const byTest = new Map();
      for (const a of attempts) byTest.set(a.testId, (byTest.get(a.testId) || 0) + 1);
      const topTest = [...byTest.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const keys = topTest ? await getTestKeys(topTest) : null;
      const questionStats = keys
        ? buildAnalytics(attempts.filter(a => a.testId === topTest), keys) : null;

      const data = topicAnalytics({ attempts, assignedCount: students.length, questionStats });
      const dist = (data.distribution?.buckets || []).map(b => ({ label: b.label, value: b.count, hint: String(b.count) }));
      const maxDist = Math.max(1, ...dist.map(d => d.value));
      const hard = (data.questionStats?.lowQuestions || []).slice(0, 5);

      body.replaceChildren(
        h("div", { class: "page-head" }, h("div", {},
          h("div", { class: "eyebrow" }, h("a", { href: `#topic/${encodeURIComponent(topic.id)}` }, "← К теме")),
          h("h1", {}, topic.title),
          h("p", { class: "page-sub" }, subject ? `Аналитика темы · ${subject.title}` : "Аналитика темы"))),
        h("section", { class: "panel" }, h("div", { class: "panel-body" },
          h("div", { class: "quick-actions" },
            stat("Средний балл", gradeLabel(data.averageScore)),
            stat("Лучший балл", gradeLabel(data.bestScore)),
            stat("Попыток", data.attemptsCount, `оценено: ${data.gradedCount}`),
            stat("Сдали", data.passedCount, `из ${data.assignedCount} назначенных`)),
          progressMeter(data.assignedCount ? Math.round(data.passedCount / data.assignedCount * 100) : null,
            { label: `Доля сдавших (от ${TOPIC_PASS_PERCENT} б.)` }))),
        h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", {}, "Распределение оценок")),
          h("div", { class: "panel-body" }, dist.length ? barChart(dist, { ariaLabel: "Распределение оценок", max: maxDist })
            : h("p", { class: "muted" }, "Оценённых попыток пока нет."))),
        h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", {}, "Сложные вопросы")),
          h("div", { class: "panel-body" }, hard.length
            ? barChart(hard.map(q => ({ label: `Вопрос ${Number(q.qid) + 1}`, value: q.percent ?? 0 })), { ariaLabel: "Процент верных ответов" })
            : h("p", { class: "muted" }, "Сложных вопросов не выявлено или данных пока мало."))),
        studentsTable(topicStudentRows({ attempts, students })));
    } catch (err) {
      console.error("Аналитика темы:", err);
      body.replaceChildren(errorState({ text: err?.message || "Не удалось загрузить аналитику темы.", onRetry: load }));
    }
  }
  await load();
  return page;
}
