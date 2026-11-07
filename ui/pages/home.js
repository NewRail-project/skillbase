import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { t, lt, roleLabel } from "../../core/i18n.js";
import { listMyAttempts, listOrgAttempts, countMyAttemptsByStatus, countOrgAttempts, countOrgAttemptsByStatus } from "../../core/attempts.js";
import { listMyTests, countPublishedTests, countMyTests, countMyTestsByStatus, deleteTest } from "../../core/editor.js";
import { canDeleteTest, deletionPlan, explainDeleteError } from "../../core/test-delete-logic.js";
import { getDocs, query, collection, db, where } from "../../shared/firebase.js";
import { confirmAction } from "../../ui/components/confirm.js";
import { toast } from "../../ui/components/toast.js";
import { getStudentAssignments, listAssignments } from "../../core/assign.js";
import { icons } from "../../shared/icons.js";
import { railScene } from "../../ui/components/brand.js";

// Тексты героя зависят от режима Education / Workforce: функции (lt) обновляются
// на месте при переключении, страница не перерисовывается.
const HERO = {
  guest: {
    eyebrow: lt("home.guest.eyebrow"),
    title: lt("home.guest.title"),
    lead: lt("home.guest.lead"),
    actions: [
      { href: "#login", label: lt("home.signIn"), cls: "btn primary" },
      { href: "#register", label: lt("home.signUp"), cls: "btn secondary" }
    ]
  }
};

function formatDate(value) {
  if (!value) return "—";
  const date = value.toDate ? value.toDate() : value.seconds ? new Date(value.seconds * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
}

function daysLeft(value) {
  if (!value) return null;
  const date = value.toDate ? value.toDate() : value.seconds ? new Date(value.seconds * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

function hero({ eyebrow, title, lead, actions, stats }) {
  const section = h("section", { class: "hero" });
  section.innerHTML = railScene();
  const inner = h("div", { class: "hero-inner" },
    h("div", { class: "eyebrow" }, eyebrow),
    h("h1", { class: "hero-title" }, title),
    h("p", { class: "hero-lead" }, lead)
  );
  if (actions && actions.length) {
    inner.appendChild(h("div", { class: "hero-actions" },
      actions.map(a => h("a", { class: a.cls, href: a.href }, a.label))
    ));
  }
  section.appendChild(inner);

  if (stats && stats.length) {
    section.appendChild(h("div", { class: "hero-stats" },
      stats.map(s => {
        const value = h("b", {}, String(s.value));
        // data-stat позволяет обновить цифру, когда данные догрузятся.
        if (s.key) value.dataset.stat = s.key;
        return h("div", { class: "hero-stat" }, value, h("span", {}, s.label));
      })
    ));
  }
  return section;
}

// Плитка статистики, заполняемая по мере загрузки своего блока.
// «—» означает «ещё считается», а не ноль: фиктивных цифр нет.
function statTile(label, hint) {
  const value = h("div", { class: "stat-value" }, "—");
  const hintEl = h("div", { class: "stat-hint" }, hint || "");
  const el = h("div", { class: "stat" },
    value,
    h("div", { class: "stat-label" }, label),
    hintEl
  );
  return {
    el,
    set(v, nextHint) {
      value.textContent = v === null ? "—" : String(v);
      if (nextHint !== undefined) hintEl.textContent = nextHint;
    }
  };
}

// Строки-скелеты внутри панели, пока данные блока не пришли.
function skeletonRows(n) {
  return Array.from({ length: n }, () => h("div", { class: "list-row" },
    h("div", { class: "list-row-main" },
      h("div", { class: "skeleton", style: "height:14px;width:70%;margin-bottom:6px" }),
      h("div", { class: "skeleton", style: "height:12px;width:40%" })
    )
  ));
}

// Заменяет скелет-строки панели на данные или empty-state.
function fillPanel(panel, items, { emptyText, emptyAction }) {
  panel.querySelector(".list")?.remove();
  panel.querySelector(".empty-state")?.remove();
  if (!items.length) {
    panel.appendChild(h("div", { class: "empty-state" },
      h("p", {}, emptyText),
      emptyAction ? h("a", { class: "btn secondary", href: emptyAction.href }, emptyAction.label) : null
    ));
    return;
  }
  const list = h("div", { class: "list" });
  items.forEach(item => list.appendChild(item));
  panel.appendChild(list);
}

// Панель графика: скелет до данных, потом график или удаление панели.
function chartPanelPlaceholder() {
  return h("section", { class: "panel" },
    h("div", { class: "section-title" }, h("h2", {}, lt("home.chartTitle"))),
    h("div", { class: "skeleton", style: "height:64px;margin-top:12px" })
  );
}

function fillChartPanel(placeholder, attempts) {
  const chart = resultChart(attempts);
  if (!chart) {
    placeholder.remove();
    return;
  }
  placeholder.replaceWith(chart);
}

// Единый индикатор ошибок независимых блоков: каждый блок честно сообщает
// о своей неудаче, не мешая остальным.
function errorNotice() {
  const failed = new Set();
  const el = h("div", { class: "notice", role: "status", style: "display:none" });
  return {
    el,
    fail(label) {
      failed.add(label);
      el.style.display = "";
      el.textContent = "Не удалось загрузить: " + [...failed].join(", ") + ". Проверьте подключение к сети.";
    }
  };
}

function quickActions(items) {
  return h("div", { class: "quick-actions" },
    items.map(item => {
      const a = h("a", { class: "quick-action", href: item.href });
      // item.icon — статичная SVG-константа из shared/icons.js.
      const ic = h("span", { class: "icon" });
      ic.innerHTML = item.icon;
      a.append(ic, h("b", {}, item.label), h("span", {}, item.hint));
      return a;
    })
  );
}

// Компактный график последних результатов: только реальные попытки.
function resultChart(attempts) {
  const graded = attempts.filter(a => a.status === "graded" && a.total)
    .slice(0, 8)
    .reverse();
  if (!graded.length) return null;

  const height = 64;
  const barWidth = 18;
  const gap = 8;
  const width = graded.length * (barWidth + gap) - gap;
  // График собирается через DOM (createElementNS): числа попадают в атрибуты,
  // а не в разметку строкой.
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", String(height));
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Проценты последних попыток");
  graded.forEach((a, i) => {
    const percent = Math.round((a.score / a.total) * 100);
    const barH = Math.max(4, Math.round((percent / 100) * (height - 8)));
    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", String(i * (barWidth + gap)));
    rect.setAttribute("y", String(height - barH));
    rect.setAttribute("width", String(barWidth));
    rect.setAttribute("height", String(barH));
    rect.setAttribute("rx", "3");
    rect.setAttribute("fill", percent >= 60 ? "var(--accent)" : "var(--signal)");
    const title = document.createElementNS(NS, "title");
    title.textContent = `${percent}%`;
    rect.appendChild(title);
    svg.appendChild(rect);
  });

  const wrap = h("div", { class: "panel" },
    h("div", { class: "section-title" },
      h("h2", {}, lt("home.chartTitle")),
      h("span", { class: "muted" }, "последние " + graded.length)
    )
  );
  const chart = h("div", { style: "margin-top:12px" });
  chart.appendChild(svg);
  wrap.appendChild(chart);
  return wrap;
}

function listPanel({ title, action, items, emptyText, emptyAction }) {
  const panel = h("section", { class: "panel panel-flush" });
  const head = h("div", { class: "panel-head" }, h("h2", {}, title));
  if (action) head.appendChild(h("a", { href: action.href, class: "muted" }, action.label));
  panel.appendChild(head);

  if (!items.length) {
    panel.appendChild(h("div", { class: "empty-state" },
      h("p", {}, emptyText),
      emptyAction ? h("a", { class: "btn secondary", href: emptyAction.href }, emptyAction.label) : null
    ));
    return panel;
  }
  const list = h("div", { class: "list" });
  items.forEach(item => list.appendChild(item));
  panel.appendChild(list);
  return panel;
}

function row({ dot, title, sub, end, href }) {
  const el = h(href ? "a" : "div", { class: "list-row", href });
  if (dot) el.appendChild(h("span", { class: "dot " + dot }));
  el.appendChild(h("div", { class: "list-row-main" },
    h("div", { class: "list-row-title" }, title),
    sub ? h("div", { class: "list-row-sub" }, sub) : null
  ));
  if (end) el.appendChild(h("div", { class: "list-row-end" }, end));
  return el;
}

// ---------- Главная ученика: каркас сразу, данные — по мере готовности ----------
//
// Блоки грузятся независимо: попытки, задания и счётчик тестов не ждут
// друг друга. Пока блок не готов, видны скелет и «—»; ошибки одного блока
// не ломают остальные.

function renderStudentHome(page, profile) {
  const firstName = profile.fullName ? profile.fullName.split(" ")[0] : null;
  const errors = errorNotice();
  const setHeroStat = (key, value) => {
    const el = page.querySelector(`[data-stat="${key}"]`);
    if (el) el.textContent = String(value);
  };

  const heroEl = hero({
    eyebrow: lt("home.learner.eyebrow"),
    title: () => t("home.learner.hello", { name: firstName || t("role.colleagueName") }),
    lead: lt("home.learner.lead"),
    actions: [{ href: "#assignments", label: lt("home.learner.myAssignments"), cls: "btn primary" }],
    stats: [
      { key: "tests", value: "—", label: lt("home.learner.statTests") },
      { key: "graded", value: "—", label: lt("home.learner.statDone") },
      { key: "avg", value: "—", label: lt("home.learner.statAvg") }
    ]
  });

  const tAssignments = statTile(lt("home.learner.tileActive"), "Загружаем…");
  const tGraded = statTile(lt("home.learner.tileGraded"), "Загружаем…");
  const tAvg = statTile(lt("home.learner.statAvg"), "Загружаем…");
  const tDeadlines = statTile(lt("home.learner.tileDeadlines"), "Загружаем…");

  const deadlinesPanel = listPanel({
    title: lt("home.learner.deadlinesTitle"),
    items: skeletonRows(2),
    emptyText: lt("home.learner.deadlinesEmpty"),
    emptyAction: { href: "#assignments", label: lt("home.learner.allAssignments") }
  });
  const chartPanel = chartPanelPlaceholder();
  const recentPanel = listPanel({
    title: lt("home.learner.recentTitle"),
    items: skeletonRows(3),
    emptyText: lt("home.learner.recentEmpty"),
    emptyAction: { href: "#assignments", label: lt("home.learner.toAssignments") }
  });

  page.append(
    heroEl,
    h("section", { class: "stat-grid" },
      tAssignments.el, tGraded.el, tAvg.el, tDeadlines.el
    ),
    h("div", { class: "split" },
      deadlinesPanel,
      quickActions([
        { icon: icons.clipboard, label: lt("nav.assignments"), hint: lt("home.quick.assignmentsHint"), href: "#assignments" },
        { icon: icons.book, label: lt("home.quick.catalog"), hint: lt("home.quick.catalogHint"), href: "#tests" },
        { icon: icons.qr, label: lt("nav.join"), hint: lt("home.quick.joinHint"), href: "#join" },
        { icon: icons.users, label: "Профиль", hint: "Данные и тема", href: "#profile" }
      ])
    ),
    chartPanel,
    recentPanel,
    errors.el
  );

  // --- Попытки: точные счётчики + последние 12 для графика и списка ---
  void (async () => {
    try {
      const [recent, gradedCount] = await Promise.all([
        listMyAttempts(profile.uid, { limit: 12 }),
        countMyAttemptsByStatus(profile.uid, "graded")
      ]);
      const graded = recent.filter(a => a.status === "graded" && a.total);
      const avg = graded.length
        ? Math.round(graded.reduce((sum, a) => sum + (a.score / a.total) * 100, 0) / graded.length)
        : null;

      setHeroStat("graded", gradedCount);
      setHeroStat("avg", avg === null ? "—" : avg + "%");
      tGraded.set(gradedCount, gradedCount ? "Продолжайте в том же ритме" : t("home.learner.startFirst"));
      tAvg.set(avg === null ? "—" : avg + "%",
        avg === null ? "Появится после проверки" : avg >= 60 ? "по последним проверенным" : "Есть над чем поработать");

      fillChartPanel(chartPanel, recent);
      fillPanel(recentPanel, recent.slice(0, 5).map(a => {
        const percent = a.status === "graded" && a.total ? Math.round((a.score / a.total) * 100) : null;
        const inProgress = a.status === "in_progress";
        return row({
          dot: percent === null ? (inProgress ? "muted" : "warn") : percent >= 60 ? "ok" : "warn",
          title: a.testTitle || lt("home.row.untitledTest"),
          sub: formatDate(a.submittedAt || a.startedAt),
          end: h("span", {
            class: "badge " + (percent === null
              ? (inProgress ? "badge-warning" : "badge-info")
              : "badge-success")
          }, percent === null ? (inProgress ? "Не завершена" : "На проверке") : percent + "%")
        });
      }), {
        emptyText: lt("home.learner.recentEmpty"),
        emptyAction: { href: "#assignments", label: lt("home.learner.toAssignments") }
      });
    } catch (e) {
      console.error("Попытки:", e);
      errors.fail("результаты");
      tGraded.set("—", "нет данных");
      tAvg.set("—", "нет данных");
      chartPanel.remove();
      fillPanel(recentPanel, [], {
        emptyText: "Результаты не загрузились. Проверьте подключение к сети.",
        emptyAction: { href: "#assignments", label: lt("home.learner.toAssignments") }
      });
    }
  })();

  // --- Задания и дедлайны ---
  void (async () => {
    try {
      const assignments = profile.groupId
        ? await getStudentAssignments(profile.groupId, profile.orgId)
        : [];
      const deadlines = assignments
        .filter(a => a.deadline)
        .map(a => ({ ...a, left: daysLeft(a.deadline) }))
        .filter(a => a.left !== null)
        .sort((a, b) => a.left - b.left)
        .slice(0, 4);

      tAssignments.set(assignments.length, assignments.length ? "Проверьте сроки" : "Пока нет назначений");
      tDeadlines.set(deadlines.length, deadlines.length ? "Не откладывайте" : "Свободный график");

      fillPanel(deadlinesPanel, deadlines.map(a => row({
        dot: a.left <= 2 ? "warn" : "ok",
        title: a.title || a.testTitle || lt("asg.assignedTest"),
        sub: `Срок: ${formatDate(a.deadline)} · ${a.left <= 0 ? "просрочено" : `осталось ${a.left} дн.`}`,
        end: h("a", { class: "btn secondary", href: `#quiz/${encodeURIComponent(a.testId)}/${encodeURIComponent(a.id)}` }, "Начать")
      })), {
        emptyText: lt("home.learner.deadlinesEmpty"),
        emptyAction: { href: "#assignments", label: lt("home.learner.allAssignments") }
      });
    } catch (e) {
      console.error("Задания:", e);
      errors.fail("задания");
      tAssignments.set("—", "нет данных");
      tDeadlines.set("—", "нет данных");
      fillPanel(deadlinesPanel, [], {
        emptyText: "Задания не загрузились. Проверьте подключение к сети.",
        emptyAction: { href: "#assignments", label: lt("home.learner.allAssignments") }
      });
    }
  })();

  // --- Каталог тестов: на главной нужен только точный счётчик ---
  void (async () => {
    try {
      const total = await countPublishedTests(profile.orgId);
      setHeroStat("tests", total);
    } catch (e) {
      console.error("Тесты:", e);
      errors.fail(t("home.learner.catalogError"));
    }
  })();
}

// ---------- Главная преподавателя/администратора ----------

function renderStaffHome(page, profile) {
  const errors = errorNotice();
  const setHeroStat = (key, value) => {
    const el = page.querySelector(`[data-stat="${key}"]`);
    if (el) el.textContent = String(value);
  };

  const heroEl = hero({
    eyebrow: profile.role === "admin" ? lt("home.staff.eyebrowAdmin") : lt("home.staff.eyebrowTeacher"),
    title: lt("home.staff.title"),
    lead: lt("home.staff.lead"),
    actions: [
      { href: "#create-test", label: lt("home.staff.heroCreate"), cls: "btn primary" },
      { href: "#results", label: lt("home.staff.heroResults"), cls: "btn secondary" }
    ],
    stats: [
      { key: "tests", value: "—", label: lt("home.staff.statTests") },
      { key: "published", value: "—", label: lt("home.staff.statPublished") },
      { key: "attempts", value: "—", label: lt("home.staff.statAttempts") }
    ]
  });

  const tTests = statTile(lt("home.staff.tileTests"), "Загружаем…");
  const tAttempts = statTile("попыток", "Загружаем…");
  const tPending = statTile("ожидают проверки", "Загружаем…");
  const tAvg = statTile("средний результат", "Загружаем…");

  const testsPanel = listPanel({
    title: lt("home.staff.myTests"),
    action: { href: "#create-test", label: "Создать" },
    items: skeletonRows(2),
    emptyText: lt("home.staff.myTestsEmpty"),
    emptyAction: { href: "#create-test", label: lt("home.staff.newBtn") }
  });
  const chartPanel = chartPanelPlaceholder();
  const recentPanel = listPanel({
    title: "Последние попытки",
    action: { href: "#results", label: "Все результаты" },
    items: skeletonRows(3),
    emptyText: lt("home.staff.recentEmpty"),
    emptyAction: { href: "#create-test", label: lt("home.staff.newBtn") }
  });

  page.append(
    heroEl,
    h("section", { class: "stat-grid" },
      tTests.el, tAttempts.el, tPending.el, tAvg.el
    ),
    h("div", { class: "split" },
      testsPanel,
      quickActions([
        { icon: icons.plus, label: lt("home.staff.quickNew"), hint: "Конструктор", href: "#create-test" },
        { icon: icons.chart, label: lt("nav.results"), hint: "Проверка и экспорт", href: "#results" },
        { icon: icons.qr, label: lt("nav.join"), hint: "Live-комната", href: "#join" },
        { icon: icons.users, label: lt("home.staff.quickUsers"), hint: lt("home.staff.quickUsersHint"), href: "#users" }
      ])
    ),
    chartPanel,
    recentPanel,
    errors.el
  );

  // --- Попытки организации: точные счётчики + последние 12 ---
  void (async () => {
    try {
      const [recent, total, pending] = await Promise.all([
        listOrgAttempts(profile.orgId, { limit: 12 }),
        countOrgAttempts(profile.orgId),
        countOrgAttemptsByStatus(profile.orgId, "submitted")
      ]);
      const graded = recent.filter(a => a.status === "graded" && a.total);
      const avg = graded.length
        ? Math.round(graded.reduce((sum, a) => sum + (a.score / a.total) * 100, 0) / graded.length)
        : null;

      setHeroStat("attempts", total);
      tAttempts.set(total, pending ? `ожидают проверки: ${pending}` : "все проверены");
      tPending.set(pending, pending ? "Проверьте в разделе «Результаты»" : "всё проверено");
      tAvg.set(avg === null ? "—" : avg + "%", graded.length ? "по последним проверенным" : "нет данных");

      fillChartPanel(chartPanel, recent);
      fillPanel(recentPanel, recent.slice(0, 5).map(a => {
        const percent = a.status === "graded" && a.total ? Math.round((a.score / a.total) * 100) : null;
        const inProgress = a.status === "in_progress";
        return row({
          dot: percent === null ? (inProgress ? "muted" : "warn") : percent >= 60 ? "ok" : "warn",
          title: a.testTitle || lt("home.row.untitledTest"),
          sub: (a.userEmail || "участник") + " · " + formatDate(a.submittedAt || a.startedAt),
          end: h("span", {
            class: "badge " + (percent === null
              ? (inProgress ? "badge-warning" : "badge-info")
              : "badge-success")
          }, percent === null ? (inProgress ? "Не завершена" : "На проверке") : percent + "%"),
          href: inProgress ? null : "#review/" + encodeURIComponent(a.id)
        });
      }), {
        emptyText: lt("home.staff.recentEmpty"),
        emptyAction: { href: "#create-test", label: lt("home.staff.newBtn") }
      });
    } catch (e) {
      console.error("Попытки организации:", e);
      errors.fail("результаты");
      tAttempts.set("—", "нет данных");
      tPending.set("—", "нет данных");
      tAvg.set("—", "нет данных");
      chartPanel.remove();
      fillPanel(recentPanel, [], {
        emptyText: "Попытки не загрузились. Проверьте подключение к сети.",
        emptyAction: { href: "#results", label: "Все результаты" }
      });
    }
  })();

  // --- Мои тесты: точные счётчики + последние 6 для списка ---
  void (async () => {
    try {
      const [tests, total, published] = await Promise.all([
        listMyTests(profile.uid, profile.orgId, profile.role, { limit: 6 }),
        countMyTests(profile.uid, profile.orgId, profile.role),
        profile.role === "admin"
          ? countPublishedTests(profile.orgId)
          : countMyTestsByStatus(profile.uid, profile.orgId, "published")
      ]);

      setHeroStat("tests", total);
      setHeroStat("published", published);
      tTests.set(total, `опубликовано: ${published}`);

      fillPanel(testsPanel, tests.map(test => {
        const onDelete = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const can = canDeleteTest(test, { uid: State.user.uid, role: State.profile.role, orgId: State.profile.orgId });
          if (!can.allowed) { toast(can.reason, "error"); return; }

          let assignments = [];
          try { assignments = await listAssignments(profile.orgId); } catch (_) {}

          let rooms = [];
          try {
            const rSnap = await getDocs(query(
              collection(db, "rooms"),
              where("testId", "==", test.id),
              where("hostId", "==", State.user.uid)
            ));
            rooms = rSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          } catch (_) {}

          const plan = deletionPlan({ test, session: { uid: State.user.uid, role: State.profile.role }, assignments, rooms });
          const details = [];
          if (plan.closeAssignmentIds.length) details.push(h("p", { class: "warning-msg" }, `Будет закрыто активных заданий: ${plan.closeAssignmentIds.length}`));
          if (plan.closeRoomCodes.length) details.push(h("p", { class: "warning-msg" }, `Будет закрыто активных Live-комнат: ${plan.closeRoomCodes.length}`));

          const ok = await confirmAction({
            title: t("tests.deleteConfirm", { title: test.title }),
            text: t("tests.deleteHint"),
            details,
            confirmLabel: "Удалить",
            tone: "danger"
          });

          if (ok) {
            try {
              await deleteTest(test.id, plan);
              toast(t("tests.deleted"), "success");
              window.location.reload();
            } catch (err) {
              toast(explainDeleteError(err), "error");
            }
          }
        };

        const delBtn = h("button", {
          type: "button",
          class: "btn-icon danger-text",
          title: t("tests.deleteTitle"),
          onclick: onDelete,
          style: "margin-left:var(--space-2);padding:0;min-height:0;border:0;background:transparent"
        }, h("span", { style: "font-size:1.2em" }, "×"));

        return row({
          dot: test.status === "published" ? "ok" : "muted",
          title: test.title || "Без названия",
          sub: `${(test.questions || []).length} вопросов · ${formatDate(test.updatedAt)}`,
          end: h("div", { style: "display:flex;align-items:center" },
            h("span", { class: "badge " + (test.status === "published" ? "badge-success" : "badge-warning") },
              test.status === "published" ? "Опубликован" : "Черновик"),
            delBtn
          ),
          href: "#create-test/" + encodeURIComponent(test.id)
        });
      }), {
        emptyText: lt("home.staff.myTestsEmpty"),
        emptyAction: { href: "#create-test", label: lt("home.staff.newBtn") }
      });
    } catch (e) {
      console.error("Мои тесты:", e);
      errors.fail(t("nav.testsStaff").toLowerCase());
      tTests.set("—", "нет данных");
      fillPanel(testsPanel, [], {
        emptyText: e?.code === "failed-precondition"
          ? "Запросу не хватает составного индекса Firestore (описан в firestore.indexes.json)."
          : e?.code === "permission-denied"
            ? "Нет доступа к списку тестов: правила Firestore запрещают чтение."
            : "Тесты не загрузились. Проверьте подключение к сети.",
        emptyAction: { href: "#create-test", label: lt("home.staff.newBtn") }
      });
    }
  })();
}

function guestView() {
  const { eyebrow, title, lead, actions } = HERO.guest;
  return [
    hero({ eyebrow, title, lead, actions }),
    h("section", { class: "grid grid-3" },
      h("div", { class: "panel" },
        h("div", { class: "eyebrow" }, lt("home.guest.p1.eyebrow")),
        h("h2", {}, lt("home.guest.p1.title")),
        h("p", { class: "muted" }, lt("home.guest.p1.text"))
      ),
      h("div", { class: "panel" },
        h("div", { class: "eyebrow" }, lt("home.guest.p2.eyebrow")),
        h("h2", {}, lt("home.guest.p2.title")),
        h("p", { class: "muted" }, lt("home.guest.p2.text"))
      ),
      h("div", { class: "panel" },
        h("div", { class: "eyebrow" }, lt("home.guest.p3.eyebrow")),
        h("h2", {}, lt("home.guest.p3.title")),
        h("p", { class: "muted" }, lt("home.guest.p3.text"))
      )
    ),
    h("section", { class: "panel" },
      h("div", { class: "section-title" }, h("h2", {}, "С чего начать")),
      h("div", { class: "quick-actions", style: "margin-top:16px" },
        h("a", { class: "quick-action", href: "#login" },
          h("b", {}, "Войти"), h("span", {}, "Если аккаунт уже выдан организацией")),
        h("a", { class: "quick-action", href: "#register" },
          h("b", {}, "Зарегистрироваться"), h("span", {}, lt("home.guest.registerHint")))
      )
    )
  ].filter(Boolean);
}

export default async function HomePage() {
  const page = h("div", { class: "page" });

  if (!State.user || !State.profile) {
    page.append(...guestView());
    return page;
  }

  if (State.profileStatus === "loading") {
    page.append(
      h("div", { class: "panel" },
        h("div", { class: "skeleton-line", style: "height:32px;width:280px;margin-bottom:12px" }),
        h("div", { class: "skeleton-line", style: "height:16px;width:60%" })
      ),
      h("p", { class: "muted", role: "status" }, "Загружаем данные…")
    );
    return page;
  }

  const profile = State.profile;

  if (State.profileStatus === "missing" || State.profileStatus === "error") {
    page.append(...guestView());
    page.appendChild(h("div", { class: "notice", role: "status" },
      h("p", {}, State.profileStatus === "missing"
        ? "Профиль ещё не создан. Откройте раздел «Профиль», чтобы указать ФИО."
        : (State.profileError || "Не удалось загрузить профиль.")),
      h("a", { class: "btn primary", href: "#profile" }, "Перейти в профиль")
    ));
    return page;
  }

  if (isStaff()) {
    renderStaffHome(page, profile);
  } else {
    renderStudentHome(page, profile);
  }

  return page;
}
