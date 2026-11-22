// ui/pages/teacher-dashboard.js — панель преподавателя: ожидающие проверки,
// просроченные задания, последняя активность, быстрые действия и статистика
// групп. Фильтрация по teacherGroups для преподавателей.
import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { lt } from "../../core/i18n.js";
import { listOrgAttempts } from "../../core/attempts.js";
import { listAssignments } from "../../core/assign.js";
import { loadPublicProfiles, displayName } from "../../core/profile.js";
import { createIcon } from "../../shared/svg.js";
import { icons } from "../../shared/icons.js";

function formatDate(value) {
  if (!value) return "—";
  const date = value.toDate ? value.toDate() : value.seconds ? new Date(value.seconds * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

function formatDateShort(value) {
  if (!value) return "—";
  const date = value.toDate ? value.toDate() : value.seconds ? new Date(value.seconds * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric"
  });
}

function statusBadge(status) {
  const map = {
    submitted: "badge-info",
    graded: "badge-success",
    in_progress: "badge-warning",
    expired: "badge-danger"
  };
  return map[status] || "badge-neutral";
}

// Цвет кольца статуса (не бейдж).
function statusDot(status) {
  const map = {
    submitted: "warn",
    graded: "ok",
    in_progress: "warn",
    expired: "danger"
  };
  return map[status] || "muted";
}

function statusLabel(status) {
  const map = {
    submitted: "Ожидает проверки",
    graded: "Проверено",
    in_progress: "В процессе",
    expired: "Просрочено"
  };
  return map[status] || status;
}

export default async function TeacherDashboardPage() {
  const page = h("div", { class: "page" });

  // Шапка страницы
  page.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, lt("title.teacher")),
      h("h1", {}, "Рабочее пространство"),
      h("p", { class: "page-sub" }, "Проверка работ, назначения и статистика групп")
    ),
    h("div", { class: "page-head-actions" },
      h("a", { class: "btn secondary", href: "#tests" }, "Каталог тестов"),
      h("a", { class: "btn secondary", href: "#results" }, "Результаты")
    )
  ));

  // Основной контент
  const body = h("div", { class: "dashboard-grid" });
  page.appendChild(body);

  // Скелетон на время загрузки
  const loadingPanel = h("section", { class: "panel panel-flush" },
    h("div", { class: "panel-head" }, h("h2", {}, "Загрузка…")),
    h("div", { class: "panel-body" },
      h("div", { class: "skeleton-line", style: "height:20px;margin-bottom:12px" }),
      h("div", { class: "skeleton-line", style: "height:20px;margin-bottom:12px" }),
      h("div", { class: "skeleton-line", style: "height:20px" })
    )
  );
  body.appendChild(loadingPanel);

  async function load() {
    const profile = State.profile;
    const orgId = profile?.orgId;
    const teacherGroups = isStaff() && profile?.teacherGroups ? profile.teacherGroups : null;
    const isAdmin = profile?.role === "admin";

    // Загружаем данные параллельно
    const [attempts, assignments] = await Promise.all([
      listOrgAttempts(orgId, {
        groupIdFilter: teacherGroups,
        limit: 100
      }),
      listAssignments(orgId)
    ]);

    // Фильтруем назначения для преподавателя
    const filteredAssignments = teacherGroups
      ? assignments.filter(a => teacherGroups.includes(a.groupId))
      : assignments;

    // Блок 1: Ожидающие проверки
    body.appendChild(await buildPendingReviewBlock(attempts));

    // Блок 2: Просроченные задания
    body.appendChild(buildOverdueAssignmentsBlock(filteredAssignments, attempts));

    // Блок 3: Быстрые действия
    body.appendChild(buildQuickActionsBlock());

    // Блок 4: Последняя активность
    body.appendChild(await buildRecentActivityBlock(attempts));

    // Блок 5: Статистика групп
    body.appendChild(await buildGroupStatsBlock(attempts, teacherGroups, isAdmin));
  }

  try {
    await load();
  } catch (err) {
    console.error("Панель преподавателя:", err);
    body.textContent = "";
    body.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "empty-state-icon", innerHTML: icons.chart }),
      h("h2", {}, "Не удалось загрузить данные"),
      h("p", { class: "muted" },
        err?.code === "permission-denied"
          ? "Нет доступа к данным организации."
          : "Проверьте подключение к сети и повторите попытку."
      ),
      h("button", {
        type: "button", class: "btn secondary",
        onclick: () => { body.textContent = ""; body.appendChild(loadingPanel.cloneNode(true)); load(); }
      }, "Повторить")
    ));
  }

  return page;
}

// Блок 1: Ожидающие проверки
async function buildPendingReviewBlock(attempts) {
  const pending = attempts.filter(a => a.status === "submitted");

  const section = h("section", { class: "panel panel-flush" });
  const countBadge = pending.length > 0
    ? h("span", { class: "badge badge-neutral" }, String(pending.length))
    : null;
  section.appendChild(h("div", { class: "panel-head" },
    h("h2", {}, "Ожидают проверки", countBadge),
    pending.length
      ? h("a", { class: "btn secondary", href: "#results" }, "Все результаты")
      : null
  ));

  if (!pending.length) {
    section.appendChild(h("div", { class: "panel-body" },
      h("p", { class: "muted" }, "Нет работ, ожидающих проверки.")
    ));
    return section;
  }

  // Загружаем имена для отображения
  const userIds = [...new Set(pending.map(a => a.userId).filter(Boolean))];
  let nameMap = new Map();
  try {
    const profiles = await loadPublicProfiles(userIds, State.profile.orgId);
    profiles.forEach(p => {
      nameMap.set(p.id, displayName(p, { viewerIsStaff: true, uid: p.id }));
    });
  } catch (nameErr) {
    console.warn("Не удалось загрузить имена:", nameErr);
  }

  const list = h("div", { class: "list" });
  pending.slice(0, 10).forEach(attempt => {
    const name = attempt.guest
      ? (attempt.userName || "Гость")
      : (nameMap.get(attempt.userId) || attempt.userName || attempt.userEmail?.split("@")[0] || "Участник");

    const row = h("div", { class: "list-row" },
      h("span", { class: "dot " + statusDot(attempt.status) }),
      h("div", { class: "list-row-main" },
        h("div", { class: "list-row-title" },
          name,
          attempt.guest ? h("span", { class: "badge badge-neutral", style: "margin-left:6px" }, "Гость") : null
        ),
        h("div", { class: "list-row-sub" },
          `${attempt.testTitle || "Тест"} · ${attempt.groupId || "—"} · ${formatDate(attempt.submittedAt || attempt.startedAt)}`
        )
      ),
      h("div", { class: "list-row-end" },
        h("span", { class: "badge " + statusBadge(attempt.status) }, statusLabel(attempt.status)),
        h("a", {
          class: "btn primary",
          href: `#review/${encodeURIComponent(attempt.id)}`
        }, "Проверить")
      )
    );
    list.appendChild(row);
  });

  section.appendChild(list);
  return section;
}

// Блок 2: Просроченные задания
function buildOverdueAssignmentsBlock(assignments, attempts) {
  const now = Date.now();
  const activeOverdue = assignments.filter(a => {
    if (a.status !== "active") return false;
    if (!a.deadline) return false;
    const deadlineMs = a.deadline.toMillis ? a.deadline.toMillis() : a.deadline.seconds * 1000;
    if (now <= deadlineMs) return false;

    // Проверяем, есть ли выполненные или отправленные работы
    const studentAttempts = attempts.filter(at =>
      at.assignmentId === a.id &&
      (at.status === "submitted" || at.status === "graded")
    );
    if (studentAttempts.length > 0) return false;

    // Проверяем, были ли незавершённые попытки
    const incompleteAttempts = attempts.filter(at =>
      at.assignmentId === a.id &&
      at.status === "in_progress"
    );
    if (incompleteAttempts.length > 0) return false;

    return true;
  });

  const section = h("section", { class: "panel panel-flush" });
  section.appendChild(h("div", { class: "panel-head" },
    h("h2", {}, "Просроченные задания"),
    h("a", { class: "btn secondary", href: "#assignments" }, "Управление")
  ));

  if (!activeOverdue.length) {
    section.appendChild(h("div", { class: "panel-body" },
      h("p", { class: "muted" }, "Нет просроченных активных заданий.")
    ));
    return section;
  }

  const list = h("div", { class: "list" });
  activeOverdue.slice(0, 10).forEach(assignment => {
    const deadlineDate = assignment.deadline?.toDate?.() || new Date(assignment.deadline?.seconds * 1000);
    const daysOverdue = Math.floor((now - deadlineDate.getTime()) / 86400000);

    const row = h("div", { class: "list-row" },
      h("span", { class: "dot warn" }),
      h("div", { class: "list-row-main" },
        h("div", { class: "list-row-title" }, assignment.testTitle || "Без названия"),
        h("div", { class: "list-row-sub" },
          `Группа: ${assignment.groupId || "—"} · Срок: ${formatDateShort(assignment.deadline)} · Просрочено ${daysOverdue} дн.`
        )
      ),
      h("div", { class: "list-row-end" },
        h("span", { class: "badge badge-danger" }, "Просрочено"),
        h("a", {
          class: "btn secondary",
          href: `#assignments`
        }, "Управлять")
      )
    );
    list.appendChild(row);
  });

  section.appendChild(list);
  return section;
}

// Блок 3: Быстрые действия, после overdue
function buildQuickActionsBlock() {
  const section = h("section", { class: "panel" });
  section.appendChild(h("div", { class: "panel-head" },
    h("h2", {}, "Быстрые действия")
  ));

  const actions = h("div", { class: "quick-actions" });

  actions.appendChild(h("a", {
    class: "quick-action",
    href: "#create-test"
  },
    h("span", { class: "icon" }),
    h("b", {}, "Создать тест"),
    h("span", {}, "Новый тест")
  ));

  actions.appendChild(h("a", {
    class: "quick-action",
    href: "#material-editor"
  },
    h("span", { class: "icon" }),
    h("b", {}, "Добавить материал"),
    h("span", {}, "Текст, страницы, PDF")
  ));

  actions.appendChild(h("a", {
    class: "quick-action",
    href: "#results"
  },
    h("span", { class: "icon" }),
    h("b", {}, "Журнал результатов"),
    h("span", {}, "Проверка и баллы")
  ));

  section.appendChild(actions);
  return section;
}

// Блок 4: Последняя активность
async function buildRecentActivityBlock(attempts) {
  // Фильтруем завершённые события (submitted и graded)
  const recentEvents = attempts
    .filter(a => a.status === "submitted" || a.status === "graded")
    .sort((a, b) => {
      const aTime = a.submittedAt?.seconds || a.startedAt?.seconds || 0;
      const bTime = b.submittedAt?.seconds || b.startedAt?.seconds || 0;
      return bTime - aTime;
    })
    .slice(0, 20);

  const section = h("section", { class: "panel panel-flush" });
  section.appendChild(h("div", { class: "panel-head" },
    h("h2", {}, "Последняя активность"),
    h("a", { class: "btn secondary", href: "#results" }, "Полная история")
  ));

  if (!recentEvents.length) {
    section.appendChild(h("div", { class: "panel-body" },
      h("p", { class: "muted" }, "Нет завершённых событий.")
    ));
    return section;
  }

  // Загружаем имена
  const userIds = [...new Set(recentEvents.map(a => a.userId).filter(Boolean))];
  let nameMap = new Map();
  try {
    const profiles = await loadPublicProfiles(userIds, State.profile.orgId);
    profiles.forEach(p => {
      nameMap.set(p.id, displayName(p, { viewerIsStaff: true, uid: p.id }));
    });
  } catch (nameErr) {
    console.warn("Не удалось загрузить имена:", nameErr);
  }

  const list = h("div", { class: "list" });
  recentEvents.forEach(attempt => {
    const name = attempt.guest
      ? (attempt.userName || "Гость")
      : (nameMap.get(attempt.userId) || attempt.userName || attempt.userEmail?.split("@")[0] || "Участник");

    const eventLabel = attempt.status === "graded"
      ? `Проверена · ${attempt.score ?? 0}/${attempt.total ?? 0}`
      : "Отправлена на проверку";

    const time = formatDate(attempt.submittedAt || attempt.startedAt);

    const row = h("div", { class: "list-row" },
      h("span", { class: "dot " + statusDot(attempt.status) }),
      h("div", { class: "list-row-main" },
        h("div", { class: "list-row-title" },
          `${name} — ${eventLabel}`
        ),
        h("div", { class: "list-row-sub" },
          `${attempt.testTitle || "Тест"} · ${attempt.groupId || "—"} · ${time}`
        )
      ),
      h("div", { class: "list-row-end" },
        h("a", {
          class: "btn secondary",
          href: `#test-history/${encodeURIComponent(attempt.testId)}`
        }, "История")
      )
    );
    list.appendChild(row);
  });

  section.appendChild(list);
  return section;
}

// Блок 5: Статистика групп
async function buildGroupStatsBlock(attempts, teacherGroups, isAdmin) {
  const section = h("section", { class: "panel panel-flush" });
  section.appendChild(h("div", { class: "panel-head" },
    h("h2", {}, "Статистика групп")
  ));

  if (!attempts.length) {
    section.appendChild(h("div", { class: "panel-body" },
      h("p", { class: "muted" }, "Нет данных для статистики.")
    ));
    return section;
  }

  // Группируем по groupId
  const groupMap = new Map();
  attempts.forEach(attempt => {
    const groupId = attempt.groupId || "—";
    if (!groupMap.has(groupId)) {
      groupMap.set(groupId, {
        groupId,
        attempts: 0,
        graded: 0,
        totalScore: 0,
        totalMax: 0,
        students: new Set()
      });
    }
    const group = groupMap.get(groupId);
    group.attempts++;
    if (attempt.status === "graded" && attempt.total) {
      group.graded++;
      group.totalScore += attempt.score || 0;
      group.totalMax += attempt.total || 0;
    }
    if (attempt.userId) {
      group.students.add(attempt.userId);
    }
  });

  const list = h("div", { class: "list" });
  [...groupMap.values()].sort((a, b) => b.attempts - a.attempts).forEach(group => {
    const avgPercent = group.graded > 0
      ? Math.round((group.totalScore / group.totalMax) * 100)
      : null;

    const row = h("div", { class: "list-row" },
      h("span", { class: "dot ok" }),
      h("div", { class: "list-row-main" },
        h("div", { class: "list-row-title" }, group.groupId),
        h("div", { class: "list-row-sub" },
          `Студентов: ${group.students.size} · Попыток: ${group.attempts} · Проверено: ${group.graded}` +
          (avgPercent !== null ? ` · Средний: ${avgPercent}%` : "")
        )
      )
    );
    list.appendChild(row);
  });

  section.appendChild(list);
  return section;
}