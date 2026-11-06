import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { listMyAttempts, listOrgAttempts, countMyAttemptsByStatus, countOrgAttempts, countOrgAttemptsByStatus } from "../../core/attempts.js";
import { listMyTests, countPublishedTests, countMyTests, countMyTestsByStatus, deleteTest } from "../../core/editor.js";
import { canDeleteTest, deletionPlan, explainDeleteError } from "../../core/test-delete-logic.js";
import { getDocs, query, collection, db, where } from "../../shared/firebase.js";
import { confirmAction } from "../../ui/components/confirm.js";
import { toast } from "../../ui/components/toast.js";
import { getStudentAssignments, listAssignments } from "../../core/assign.js";
import { icons } from "../../shared/icons.js";
import { railScene } from "../../ui/components/brand.js";

const HERO = {
  guest: {
    eyebrow: "Корпоративная платформа обучения",
    title: "Знания, которые держат движение",
    lead: "Skillbase — учебная среда для железнодорожных предприятий: курсы, проверка знаний и прозрачная аналитика результатов.",
    actions: [
      { href: "#login", label: "Войти", cls: "btn primary" },
      { href: "#register", label: "Создать аккаунт", cls: "btn secondary" }
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
    h("div", { class: "section-title" }, h("h2", {}, "Динамика результатов")),
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
      a.innerHTML = `<span class="icon">${item.icon}</span>`;
      a.append(h("b", {}, item.label), h("span", {}, item.hint));
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
  const bars = graded.map((a, i) => {
    const percent = Math.round((a.score / a.total) * 100);
    const barH = Math.max(4, Math.round((percent / 100) * (height - 8)));
    const x = i * (barWidth + gap);
    const y = height - barH;
    const fill = percent >= 60 ? "var(--accent)" : "var(--signal)";
    return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" rx="3" fill="${fill}">
      <title>${percent}%</title>
    </rect>`;
  }).join("");

  const wrap = h("div", { class: "panel" },
    h("div", { class: "section-title" },
      h("h2", {}, "Динамика результатов"),
      h("span", { class: "muted" }, "последние " + graded.length)
    )
  );
  const chart = h("div", { style: "margin-top:12px" });
  chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}"
    preserveAspectRatio="none" role="img" aria-label="Проценты последних попыток">${bars}</svg>`;
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
  const name = profile.fullName ? profile.fullName.split(" ")[0] : "коллега";
  const errors = errorNotice();
  const setHeroStat = (key, value) => {
    const el = page.querySelector(`[data-stat="${key}"]`);
    if (el) el.textContent = String(value);
  };

  const heroEl = hero({
    eyebrow: "Личный кабинет",
    title: `Здравствуйте, ${name}`,
    lead: "Продолжайте обучение с того места, где остановились. Ниже — задания, дедлайны и последние результаты.",
    actions: [{ href: "#assignments", label: "Мои задания", cls: "btn primary" }],
    stats: [
      { key: "tests", value: "—", label: "доступных тестов" },
      { key: "graded", value: "—", label: "пройдено" },
      { key: "avg", value: "—", label: "средний результат" }
    ]
  });

  const tAssignments = statTile("активных заданий", "Загружаем…");
  const tGraded = statTile("проверенных попыток", "Загружаем…");
  const tAvg = statTile("средний результат", "Загружаем…");
  const tDeadlines = statTile("ближайших дедлайнов", "Загружаем…");

  const deadlinesPanel = listPanel({
    title: "Ближайшие дедлайны",
    items: skeletonRows(2),
    emptyText: "Активных дедлайнов нет.",
    emptyAction: { href: "#assignments", label: "Все задания" }
  });
  const chartPanel = chartPanelPlaceholder();
  const recentPanel = listPanel({
    title: "Недавние результаты",
    items: skeletonRows(3),
    emptyText: "Результатов пока нет. Первый пройденный тест появится здесь.",
    emptyAction: { href: "#assignments", label: "К заданиям" }
  });

  page.append(
    heroEl,
    h("section", { class: "stat-grid" },
      tAssignments.el, tGraded.el, tAvg.el, tDeadlines.el
    ),
    h("div", { class: "split" },
      deadlinesPanel,
      quickActions([
        { icon: icons.clipboard, label: "Задания", hint: "Назначенные тесты", href: "#assignments" },
        { icon: icons.book, label: "Каталог", hint: "Доступные тесты", href: "#tests" },
        { icon: icons.qr, label: "Войти по коду", hint: "Комната или тест", href: "#join" },
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
      tGraded.set(gradedCount, gradedCount ? "Продолжайте в том же ритме" : "Начните с первого теста");
      tAvg.set(avg === null ? "—" : avg + "%",
        avg === null ? "Появится после проверки" : avg >= 60 ? "по последним проверенным" : "Есть над чем поработать");

      fillChartPanel(chartPanel, recent);
      fillPanel(recentPanel, recent.slice(0, 5).map(a => {
        const percent = a.status === "graded" && a.total ? Math.round((a.score / a.total) * 100) : null;
        const inProgress = a.status === "in_progress";
        return row({
          dot: percent === null ? (inProgress ? "muted" : "warn") : percent >= 60 ? "ok" : "warn",
          title: a.testTitle || "Тест",
          sub: formatDate(a.submittedAt || a.startedAt),
          end: h("span", {
            class: "badge " + (percent === null
              ? (inProgress ? "badge-warning" : "badge-info")
              : "badge-success")
          }, percent === null ? (inProgress ? "Не завершена" : "На проверке") : percent + "%")
        });
      }), {
        emptyText: "Результатов пока нет. Первый пройденный тест появится здесь.",
        emptyAction: { href: "#assignments", label: "К заданиям" }
      });
    } catch (e) {
      console.error("Попытки:", e);
      errors.fail("результаты");
      tGraded.set("—", "нет данных");
      tAvg.set("—", "нет данных");
      chartPanel.remove();
      fillPanel(recentPanel, [], {
        emptyText: "Результаты не загрузились. Проверьте подключение к сети.",
        emptyAction: { href: "#assignments", label: "К заданиям" }
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
        title: a.title || a.testTitle || "Назначенный тест",
        sub: `Срок: ${formatDate(a.deadline)} · ${a.left <= 0 ? "просрочено" : `осталось ${a.left} дн.`}`,
        end: h("a", { class: "btn secondary", href: `#quiz/${encodeURIComponent(a.testId)}/${encodeURIComponent(a.id)}` }, "Начать")
      })), {
        emptyText: "Активных дедлайнов нет.",
        emptyAction: { href: "#assignments", label: "Все задания" }
      });
    } catch (e) {
      console.error("Задания:", e);
      errors.fail("задания");
      tAssignments.set("—", "нет данных");
      tDeadlines.set("—", "нет данных");
      fillPanel(deadlinesPanel, [], {
        emptyText: "Задания не загрузились. Проверьте подключение к сети.",
        emptyAction: { href: "#assignments", label: "Все задания" }
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
      errors.fail("каталог тестов");
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
    eyebrow: profile.role === "admin" ? "Администрирование" : "Кабинет преподавателя",
    title: "Управление обучением",
    lead: "Тесты, проверка результатов и аналитика по вашей организации — в одном месте.",
    actions: [
      { href: "#create-test", label: "Создать тест", cls: "btn primary" },
      { href: "#results", label: "Результаты", cls: "btn secondary" }
    ],
    stats: [
      { key: "tests", value: "—", label: "ваших тестов" },
      { key: "published", value: "—", label: "опубликовано" },
      { key: "attempts", value: "—", label: "попыток в организации" }
    ]
  });

  const tTests = statTile("созданных тестов", "Загружаем…");
  const tAttempts = statTile("попыток", "Загружаем…");
  const tPending = statTile("ожидают проверки", "Загружаем…");
  const tAvg = statTile("средний результат", "Загружаем…");

  const testsPanel = listPanel({
    title: "Мои тесты",
    action: { href: "#create-test", label: "Создать" },
    items: skeletonRows(2),
    emptyText: "Вы ещё не создали ни одного теста.",
    emptyAction: { href: "#create-test", label: "Создать тест" }
  });
  const chartPanel = chartPanelPlaceholder();
  const recentPanel = listPanel({
    title: "Последние попытки",
    action: { href: "#results", label: "Все результаты" },
    items: skeletonRows(3),
    emptyText: "Попыток пока нет. Опубликуйте тест и назначьте его группе.",
    emptyAction: { href: "#create-test", label: "Создать тест" }
  });

  page.append(
    heroEl,
    h("section", { class: "stat-grid" },
      tTests.el, tAttempts.el, tPending.el, tAvg.el
    ),
    h("div", { class: "split" },
      testsPanel,
      quickActions([
        { icon: icons.plus, label: "Новый тест", hint: "Конструктор", href: "#create-test" },
        { icon: icons.chart, label: "Результаты", hint: "Проверка и экспорт", href: "#results" },
        { icon: icons.qr, label: "Войти по коду", hint: "Live-комната", href: "#join" },
        { icon: icons.users, label: "Пользователи", hint: "Роли и группы", href: "#users" }
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
          title: a.testTitle || "Тест",
          sub: (a.userEmail || "участник") + " · " + formatDate(a.submittedAt || a.startedAt),
          end: h("span", {
            class: "badge " + (percent === null
              ? (inProgress ? "badge-warning" : "badge-info")
              : "badge-success")
          }, percent === null ? (inProgress ? "Не завершена" : "На проверке") : percent + "%"),
          href: inProgress ? null : "#review/" + encodeURIComponent(a.id)
        });
      }), {
        emptyText: "Попыток пока нет. Опубликуйте тест и назначьте его группе.",
        emptyAction: { href: "#create-test", label: "Создать тест" }
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

      fillPanel(testsPanel, tests.map(t => {
        const onDelete = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const can = canDeleteTest(t, { uid: State.user.uid, role: State.profile.role, orgId: State.profile.orgId });
          if (!can.allowed) { toast(can.reason, "error"); return; }

          let assignments = [];
          try { assignments = await listAssignments(profile.orgId); } catch (_) {}

          let rooms = [];
          try {
            const rSnap = await getDocs(query(
              collection(db, "rooms"),
              where("testId", "==", t.id),
              where("hostId", "==", State.user.uid)
            ));
            rooms = rSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          } catch (_) {}

          const plan = deletionPlan({ test: t, session: { uid: State.user.uid, role: State.profile.role }, assignments, rooms });
          const details = [];
          if (plan.closeAssignmentIds.length) details.push(h("p", { class: "warning-msg" }, `Будет закрыто активных заданий: ${plan.closeAssignmentIds.length}`));
          if (plan.closeRoomCodes.length) details.push(h("p", { class: "warning-msg" }, `Будет закрыто активных Live-комнат: ${plan.closeRoomCodes.length}`));

          const ok = await confirmAction({
            title: `Удалить тест «${t.title}»?`,
            text: "Тест будет скрыт из каталога. Результаты сохранятся.",
            details,
            confirmLabel: "Удалить",
            tone: "danger"
          });

          if (ok) {
            try {
              await deleteTest(t.id, plan);
              toast("Тест удалён", "success");
              window.location.reload();
            } catch (err) {
              toast(explainDeleteError(err), "error");
            }
          }
        };

        const delBtn = h("button", {
          type: "button",
          class: "btn-icon danger-text",
          title: "Удалить тест",
          onclick: onDelete,
          style: "margin-left:var(--space-2);padding:0;min-height:0;border:0;background:transparent"
        }, h("span", { style: "font-size:1.2em" }, "×"));

        return row({
          dot: t.status === "published" ? "ok" : "muted",
          title: t.title || "Без названия",
          sub: `${(t.questions || []).length} вопросов · ${formatDate(t.updatedAt)}`,
          end: h("div", { style: "display:flex;align-items:center" },
            h("span", { class: "badge " + (t.status === "published" ? "badge-success" : "badge-warning") },
              t.status === "published" ? "Опубликован" : "Черновик"),
            delBtn
          ),
          href: "#create-test/" + encodeURIComponent(t.id)
        });
      }), {
        emptyText: "Вы ещё не создали ни одного теста.",
        emptyAction: { href: "#create-test", label: "Создать тест" }
      });
    } catch (e) {
      console.error("Мои тесты:", e);
      errors.fail("тесты");
      tTests.set("—", "нет данных");
      fillPanel(testsPanel, [], {
        emptyText: "Тесты не загрузились. Проверьте подключение к сети.",
        emptyAction: { href: "#create-test", label: "Создать тест" }
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
        h("div", { class: "eyebrow" }, "01 · Курсы"),
        h("h2", {}, "Обучение по стандартам отрасли"),
        h("p", { class: "muted" }, "Материалы и проверочные тесты собраны в одном кабинете.")
      ),
      h("div", { class: "panel" },
        h("div", { class: "eyebrow" }, "02 · Проверка"),
        h("h2", {}, "Объективная оценка знаний"),
        h("p", { class: "muted" }, "Автоматическая проверка, ручная оценка и прозрачные критерии.")
      ),
      h("div", { class: "panel" },
        h("div", { class: "eyebrow" }, "03 · Аналитика"),
        h("h2", {}, "Результаты по организации"),
        h("p", { class: "muted" }, "Сводка по тестам, вопросам и участникам — без ручных таблиц.")
      )
    ),
    h("section", { class: "panel" },
      h("div", { class: "section-title" }, h("h2", {}, "С чего начать")),
      h("div", { class: "quick-actions", style: "margin-top:16px" },
        h("a", { class: "quick-action", href: "#login" },
          h("b", {}, "Войти"), h("span", {}, "Если аккаунт уже выдан организацией")),
        h("a", { class: "quick-action", href: "#register" },
          h("b", {}, "Зарегистрироваться"), h("span", {}, "Самостоятельное обучение"))
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
