// ui/pages/student-dashboard.js — панель студента: продолжить обучение,
// ближайшие сроки, незавершённые задания, прогресс по дисциплинам,
// последние результаты и слабые темы.
import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { lt } from "../../core/i18n.js";
import { getStudentAssignments } from "../../core/assign.js";
import { listMyAttempts } from "../../core/attempts.js";
import { getSubjects, getTopics } from "../../core/subjects.js";
import {
  isAssignmentVisible,
  assignmentState,
  assignmentKindLabel,
  assignmentBadgeClass,
  STATE_LABEL,
  STATE_BADGE,
  STATE_DOT,
  sortAssignments,
  deadlineSubtitle
} from "../../core/assignment-logic.js";
import { icons } from "../../shared/icons.js";

function formatDate(value) {
  if (!value) return "—";
  const date = value.toDate ? value.toDate() : value.seconds ? new Date(value.seconds * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit", month: "short", year: "numeric"
  });
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = value.toDate ? value.toDate() : value.seconds ? new Date(value.seconds * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

function attemptResultLabel(attempt) {
  if (attempt.status === "graded" && attempt.total) {
    const percent = Number.isFinite(attempt.percent)
      ? attempt.percent
      : Math.round((attempt.score / attempt.total) * 100);
    return `${attempt.score}/${attempt.total} (${percent}%)`;
  }
  return "—";
}

export default async function StudentDashboardPage() {
  const page = h("div", { class: "page" });

  // Шапка страницы
  page.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, lt("title.student")),
      h("h1", {}, "Моё обучение"),
      h("p", { class: "page-sub" }, "Продолжайте обучение и следите за прогрессом")
    ),
    h("div", { class: "page-head-actions" },
      h("a", { class: "btn secondary", href: "#assignments" }, "Все задания"),
      h("a", { class: "btn secondary", href: "#results" }, "Результаты")
    )
  ));

  // Основной контент
  const body = h("div", { class: "dashboard-grid" });
  page.appendChild(body);

  try {
    const profile = State.profile;
    const uid = State.user?.uid;
    const orgId = profile?.orgId;
    const groupId = profile?.groupId;

    if (!uid || !orgId || !groupId) {
      body.appendChild(h("div", { class: "empty-state" },
        h("div", { class: "empty-state-icon", innerHTML: icons.user || "👤" }),
        h("h2", {}, "Профиль не заполнен"),
        h("p", { class: "muted" }, "Укажите группу в профиле, чтобы видеть задания и прогресс."),
        h("a", { class: "btn primary", href: "#profile" }, "Заполнить профиль")
      ));
      return page;
    }

    // Загружаем данные параллельно
    const [assignments, attempts, subjects] = await Promise.all([
      getStudentAssignments(groupId, orgId),
      listMyAttempts(uid),
      getSubjects()
    ]);

    // Фильтруем видимые задания (не показываем ещё не открытые)
    const visibleAssignments = assignments.filter(a => isAssignmentVisible(a));

    // Блок 1: Продолжить обучение (незавершённые материалы)
    body.appendChild(await buildContinueLearningBlock(attempts, subjects));

    // Блок 2: Ближайшие сроки
    body.appendChild(buildUpcomingDeadlinesBlock(visibleAssignments, attempts));

    // Блок 3: Незавершённые задания
    body.appendChild(buildIncompleteAssignmentsBlock(visibleAssignments, attempts));

    // Блок 4: Прогресс по дисциплинам
    body.appendChild(await buildDisciplineProgressBlock(subjects, attempts));

    // Блок 5: Последние результаты
    body.appendChild(buildRecentResultsBlock(attempts));

    // Блок 6: Слабые темы
    body.appendChild(await buildWeakTopicsBlock(attempts, subjects));

  } catch (err) {
    console.error("Панель студента:", err);
    body.textContent = "";
    body.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "empty-state-icon", innerHTML: icons.chart || "📊" }),
      h("h2", {}, "Не удалось загрузить данные"),
      h("p", { class: "muted" },
        err?.code === "permission-denied"
          ? "Нет доступа к данным организации."
          : "Проверьте подключение к сети и повторите попытку."
      ),
      h("button", {
        type: "button", class: "btn secondary",
        onclick: () => window.location.reload()
      }, "Повторить")
    ));
  }

  return page;
}

// Блок 1: Продолжить обучение (незавершённые материалы)
async function buildContinueLearningBlock(attempts, subjects) {
  const section = h("section", { class: "panel panel-flush" });
  section.appendChild(h("div", { class: "panel-head" },
    h("h2", {}, "Продолжить обучение"),
    h("a", { class: "btn secondary", href: "#disciplines" }, "Все дисциплины")
  ));

  const inProgressAttempts = attempts.filter(a => a.status === "in_progress");

  if (!inProgressAttempts.length) {
    section.appendChild(h("div", { class: "panel-body" },
      h("p", { class: "muted" }, "Нет незавершённых материалов. Начните новое обучение!")
    ));
    return section;
  }

  const list = h("div", { class: "list" });
  inProgressAttempts.slice(0, 5).forEach(attempt => {
    const row = h("div", { class: "list-row" },
      h("span", { class: "dot warn" }),
      h("div", { class: "list-row-main" },
        h("div", { class: "list-row-title" }, attempt.testTitle || "Тест"),
        h("div", { class: "list-row-sub" },
          `Начато: ${formatDate(attempt.startedAt)} · ${attempt.groupId || "—"}`
        )
      ),
      h("div", { class: "list-row-end" },
        h("span", { class: "badge badge-warning" }, "В процессе"),
        h("a", {
          class: "btn primary",
          href: `#quiz/${encodeURIComponent(attempt.testId)}${attempt.assignmentId ? "/" + encodeURIComponent(attempt.assignmentId) : ""}`
        }, "Продолжить")
      )
    );
    list.appendChild(row);
  });

  section.appendChild(list);
  return section;
}

// Блок 2: Ближайшие сроки
function buildUpcomingDeadlinesBlock(assignments, attempts) {
  const now = Date.now();
  const withDeadlines = assignments.filter(a => a.deadline);
  const sorted = sortAssignments(withDeadlines, attempts, now);

  const section = h("section", { class: "panel panel-flush" });
  section.appendChild(h("div", { class: "panel-head" },
    h("h2", {}, "Ближайшие сроки"),
    h("a", { class: "btn secondary", href: "#assignments" }, "Все задания")
  ));

  if (!sorted.length) {
    section.appendChild(h("div", { class: "panel-body" },
      h("p", { class: "muted" }, "Нет заданий со сроками.")
    ));
    return section;
  }

  const list = h("div", { class: "list" });
  sorted.slice(0, 5).forEach(assignment => {
    const state = assignmentState(assignment, attempts, now);

    const row = h("div", { class: "list-row" },
      h("span", { class: "dot " + STATE_DOT[state] }),
      h("div", { class: "list-row-main" },
        h("div", { class: "list-row-title" }, assignment.testTitle || "Тест"),
        h("div", { class: "list-row-sub" },
          `Срок: ${formatDate(assignment.deadline)} · ${deadlineSubtitle(assignment.deadline, now)}` +
          (assignment.startAt ? ` · Откроется: ${formatDate(assignment.startAt)}` : "")
        )
      ),
      h("div", { class: "list-row-end" },
        h("span", { class: "badge " + assignmentBadgeClass(assignment) }, assignmentKindLabel(assignment)),
        h("span", { class: STATE_BADGE[state] }, STATE_LABEL[state]),
        state !== "done" && state !== "scheduled"
          ? h("button", {
              class: "btn " + (state === "overdue" ? "secondary" : "primary"),
              onclick: () => {
                window.location.hash = `#quiz/${encodeURIComponent(assignment.testId)}/${encodeURIComponent(assignment.id)}`;
              }
            }, state === "overdue" ? "Открыть" : "Начать")
          : state === "done"
            ? h("a", { class: "btn secondary", href: "#results" }, "Результат")
            : null
      )
    );
    list.appendChild(row);
  });

  section.appendChild(list);
  return section;
}

// Блок 3: Незавершённые задания
function buildIncompleteAssignmentsBlock(assignments, attempts) {
  const now = Date.now();
  const incomplete = assignments.filter(a => {
    const state = assignmentState(a, attempts, now);
    return state === "open" || state === "dueToday" || state === "overdue";
  });

  const section = h("section", { class: "panel panel-flush" });
  section.appendChild(h("div", { class: "panel-head" },
    h("h2", {}, "Незавершённые задания"),
    h("a", { class: "btn secondary", href: "#assignments" }, "Все задания")
  ));

  if (!incomplete.length) {
    section.appendChild(h("div", { class: "panel-body" },
      h("p", { class: "muted" }, "Все задания выполнены! 🎉")
    ));
    return section;
  }

  const sorted = sortAssignments(incomplete, attempts, now);
  const list = h("div", { class: "list" });

  sorted.slice(0, 10).forEach(assignment => {
    const state = assignmentState(assignment, attempts, now);
    const hasAttempt = attempts.some(at =>
      at.assignmentId === assignment.id && at.status === "in_progress"
    );

    const row = h("div", { class: "list-row" },
      h("span", { class: "dot " + STATE_DOT[state] }),
      h("div", { class: "list-row-main" },
        h("div", { class: "list-row-title" },
          assignment.testTitle || "Тест",
          hasAttempt ? h("span", { class: "badge badge-warning", style: "margin-left:6px" }, "Начато") : null
        ),
        h("div", { class: "list-row-sub" },
          `Группа: ${assignment.groupId || "—"} · ` +
          (assignment.deadline ? `Срок: ${formatDate(assignment.deadline)}` : "Без срока") +
          (assignment.startAt && new Date(assignment.startAt.seconds * 1000) > new Date()
            ? ` · Откроется: ${formatDate(assignment.startAt)}` : "")
        )
      ),
      h("div", { class: "list-row-end" },
        h("span", { class: "badge " + assignmentBadgeClass(assignment) }, assignmentKindLabel(assignment)),
        h("span", { class: STATE_BADGE[state] }, STATE_LABEL[state]),
        state !== "scheduled"
          ? h("button", {
              class: "btn " + (state === "overdue" ? "secondary" : "primary"),
              onclick: () => {
                window.location.hash = `#quiz/${encodeURIComponent(assignment.testId)}/${encodeURIComponent(assignment.id)}`;
              }
            }, hasAttempt ? "Продолжить" : state === "overdue" ? "Открыть" : "Начать")
          : null
      )
    );
    list.appendChild(row);
  });

  section.appendChild(list);
  return section;
}

// Блок 4: Прогресс по дисциплинам
async function buildDisciplineProgressBlock(subjects, attempts) {
  const section = h("section", { class: "panel panel-flush" });
  section.appendChild(h("div", { class: "panel-head" },
    h("h2", {}, "Прогресс по дисциплинам"),
    h("a", { class: "btn secondary", href: "#disciplines" }, "Все дисциплины")
  ));

  if (!subjects.length) {
    section.appendChild(h("div", { class: "panel-body" },
      h("p", { class: "muted" }, "Дисциплины ещё не добавлены.")
    ));
    return section;
  }

  const list = h("div", { class: "list" });

  // Загружаем темы для каждого предмета параллельно
  const topicsData = await Promise.all(
    subjects.slice(0, 5).map(async subject => {
      try {
        const topics = await getTopics(subject.id);
        return { subject, topics };
      } catch (err) {
        console.warn(`Не удалось загрузить темы для ${subject.id}:`, err);
        return { subject, topics: [] };
      }
    })
  );

  for (const { subject, topics } of topicsData) {
    const publishedTopics = topics.filter(t =>
      t.status === "published" || t.status === "active"
    );

    if (!publishedTopics.length) continue;

    // Считаем прогресс: количество тем с завершёнными материалами
    let completedCount = 0;
    for (const topic of publishedTopics) {
      // Проверяем, были ли попытки по тестам этой темы
      const topicAttempts = attempts.filter(at =>
        at.topicId === topic.id &&
        (at.status === "graded" || at.status === "submitted")
      );
      if (topicAttempts.length > 0) {
        completedCount++;
      }
    }

    const progressPercent = Math.round((completedCount / publishedTopics.length) * 100);

    const row = h("div", { class: "list-row" },
      h("span", { class: "dot " + (progressPercent >= 100 ? "ok" : progressPercent > 0 ? "warn" : "muted") }),
      h("div", { class: "list-row-main" },
        h("div", { class: "list-row-title" }, subject.title || "Без названия"),
        h("div", { class: "list-row-sub" },
          `${publishedTopics.length} тем · Завершено: ${completedCount} (${progressPercent}%)`
        )
      ),
      h("div", { class: "list-row-end" },
        h("span", { class: "badge " + (progressPercent >= 100 ? "badge-success" : progressPercent > 0 ? "badge-warning" : "badge-neutral") },
          `${progressPercent}%`
        ),
        h("a", {
          class: "btn secondary",
          href: `#discipline/${encodeURIComponent(subject.id)}`
        }, "Открыть")
      )
    );
    list.appendChild(row);
  }

  if (!list.children.length) {
    section.appendChild(h("div", { class: "panel-body" },
      h("p", { class: "muted" }, "Нет доступных дисциплин с темами.")
    ));
    return section;
  }

  section.appendChild(list);
  return section;
}

// Блок 5: Последние результаты
function buildRecentResultsBlock(attempts) {
  const graded = attempts
    .filter(a => a.status === "graded" || a.status === "submitted")
    .sort((a, b) => {
      const aTime = a.submittedAt?.seconds || a.finishedAt?.seconds || 0;
      const bTime = b.submittedAt?.seconds || b.finishedAt?.seconds || 0;
      return bTime - aTime;
    });

  const section = h("section", { class: "panel panel-flush" });
  section.appendChild(h("div", { class: "panel-head" },
    h("h2", {}, "Последние результаты"),
    h("a", { class: "btn secondary", href: "#results" }, "Все результаты")
  ));

  if (!graded.length) {
    section.appendChild(h("div", { class: "panel-body" },
      h("p", { class: "muted" }, "Пока нет результатов. Пройдите первый тест!")
    ));
    return section;
  }

  const list = h("div", { class: "list" });
  graded.slice(0, 5).forEach(attempt => {
    const statusBadge = attempt.status === "graded" ? "badge-success" : "badge-info";
    const statusLabel = attempt.status === "graded" ? "Проверено" : "Ожидает проверки";

    const row = h("div", { class: "list-row" },
      h("span", { class: "dot " + (attempt.status === "graded" ? "ok" : "warn") }),
      h("div", { class: "list-row-main" },
        h("div", { class: "list-row-title" }, attempt.testTitle || "Тест"),
        h("div", { class: "list-row-sub" },
          `Дата: ${formatDateTime(attempt.submittedAt || attempt.finishedAt || attempt.startedAt)} · ` +
          `Результат: ${attemptResultLabel(attempt)}`
        )
      ),
      h("div", { class: "list-row-end" },
        h("span", { class: "badge " + statusBadge }, statusLabel),
        attempt.assignmentId
          ? h("a", {
              class: "btn secondary",
              href: `#assignments`
            }, "К заданию")
          : h("a", {
              class: "btn secondary",
              href: `#results`
            }, "Результаты")
      )
    );
    list.appendChild(row);
  });

  section.appendChild(list);
  return section;
}

// Блок 6: Слабые темы
async function buildWeakTopicsBlock(attempts, subjects) {
  const graded = attempts.filter(a => a.status === "graded" && a.total);

  const section = h("section", { class: "panel panel-flush" });
  section.appendChild(h("div", { class: "panel-head" },
    h("h2", {}, "Слабые темы"),
    h("a", { class: "btn secondary", href: "#results" }, "Все результаты")
  ));

  if (!graded.length) {
    section.appendChild(h("div", { class: "panel-body" },
      h("p", { class: "muted" }, "Недостаточно данных для анализа. Пройдите несколько тестов.")
    ));
    return section;
  }

  // Группируем по topicId и считаем средний процент
  const topicMap = new Map();
  graded.forEach(attempt => {
    if (!attempt.topicId) return;
    const percent = Number.isFinite(attempt.percent)
      ? attempt.percent
      : Math.round((attempt.score / attempt.total) * 100);

    if (!topicMap.has(attempt.topicId)) {
      topicMap.set(attempt.topicId, {
        topicId: attempt.topicId,
        totalPercent: 0,
        count: 0
      });
    }
    const topic = topicMap.get(attempt.topicId);
    topic.totalPercent += percent;
    topic.count++;
  });

  // Считаем средний процент и фильтруем слабые темы (< 60%)
  const weakTopics = [...topicMap.values()]
    .map(t => ({
      ...t,
      avgPercent: Math.round(t.totalPercent / t.count)
    }))
    .filter(t => t.avgPercent < 60)
    .sort((a, b) => a.avgPercent - b.avgPercent);

  if (!weakTopics.length) {
    section.appendChild(h("div", { class: "panel-body" },
      h("p", { class: "muted" }, "Отлично! Слабых тем не обнаружено. 🎉")
    ));
    return section;
  }

  // Ищем названия тем по topicId
  const topicNames = new Map();
  for (const subject of subjects) {
    try {
      const topics = await getTopics(subject.id);
      topics.forEach(t => topicNames.set(t.id, t.title || "Без названия"));
    } catch (err) {
      // Игнорируем ошибки загрузки тем
    }
  }

  const list = h("div", { class: "list" });
  weakTopics.slice(0, 5).forEach(topic => {
    const topicName = topicNames.get(topic.topicId) || "Неизвестная тема";
    const row = h("div", { class: "list-row" },
      h("span", { class: "dot warn" }),
      h("div", { class: "list-row-main" },
        h("div", { class: "list-row-title" }, topicName),
        h("div", { class: "list-row-sub" },
          `Средний результат: ${topic.avgPercent}% · Попыток: ${topic.count}`
        )
      ),
      h("div", { class: "list-row-end" },
        h("span", { class: "badge badge-danger" }, `${topic.avgPercent}%`),
        h("a", {
          class: "btn secondary",
          href: `#topic/${encodeURIComponent(topic.topicId)}`
        }, "Изучить")
      )
    );
    list.appendChild(row);
  });

  section.appendChild(list);
  return section;
}