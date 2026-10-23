import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { listMyAttempts, listOrgAttempts } from "../../core/attempts.js";
import { listMyTests, listPublishedTests } from "../../core/editor.js";
import { getStudentAssignments } from "../../core/assign.js";
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
      stats.map(s => h("div", { class: "hero-stat" },
        h("b", {}, String(s.value)),
        h("span", {}, s.label)
      ))
    ));
  }
  return section;
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

async function loadStudentData(profile) {
  const data = { assignments: [], tests: [], attempts: [], errors: [] };

  const tasks = [
    (async () => {
      if (!profile.groupId) return;
      try { data.assignments = await getStudentAssignments(profile.groupId); }
      catch (e) { console.error("Задания:", e); data.errors.push("задания"); }
    })(),
    (async () => {
      try { data.tests = await listPublishedTests(profile.orgId); }
      catch (e) { console.error("Тесты:", e); data.errors.push("каталог тестов"); }
    })(),
    (async () => {
      try { data.attempts = await listMyAttempts(profile.uid); }
      catch (e) { console.error("Попытки:", e); data.errors.push("результаты"); }
    })()
  ];
  await Promise.all(tasks);
  return data;
}

async function loadStaffData(profile) {
  const data = { tests: [], attempts: [], errors: [] };
  await Promise.all([
    (async () => {
      try { data.tests = await listMyTests(profile.uid); }
      catch (e) { console.error("Мои тесты:", e); data.errors.push("тесты"); }
    })(),
    (async () => {
      try { data.attempts = await listOrgAttempts(profile.orgId); }
      catch (e) { console.error("Попытки организации:", e); data.errors.push("результаты"); }
    })()
  ]);
  return data;
}

function studentView(profile, data) {
  const graded = data.attempts.filter(a => a.status === "graded" && a.total);
  const avg = graded.length
    ? Math.round(graded.reduce((sum, a) => sum + (a.score / a.total) * 100, 0) / graded.length)
    : null;

  const deadlines = data.assignments
    .filter(a => a.deadline)
    .map(a => ({ ...a, left: daysLeft(a.deadline) }))
    .filter(a => a.left !== null)
    .sort((a, b) => a.left - b.left)
    .slice(0, 4);

  const name = profile.fullName ? profile.fullName.split(" ")[0] : "коллега";

  return [
    hero({
      eyebrow: "Личный кабинет",
      title: `Здравствуйте, ${name}`,
      lead: "Продолжайте обучение с того места, где остановились. Ниже — задания, дедлайны и последние результаты.",
      actions: [{ href: "#assignments", label: "Мои задания", cls: "btn primary" }],
      stats: [
        { value: data.tests.length, label: "доступных тестов" },
        { value: graded.length, label: "пройдено" },
        { value: avg === null ? "—" : avg + "%", label: "средний результат" }
      ]
    }),

    h("section", { class: "stat-grid" },
      h("div", { class: "stat" },
        h("div", { class: "stat-value" }, String(data.assignments.length)),
        h("div", { class: "stat-label" }, "активных заданий"),
        h("div", { class: "stat-hint" }, data.assignments.length ? "Проверьте сроки" : "Пока нет назначений")
      ),
      h("div", { class: "stat" },
        h("div", { class: "stat-value" }, String(graded.length)),
        h("div", { class: "stat-label" }, "проверенных попыток"),
        h("div", { class: "stat-hint" }, data.attempts.length ? `всего попыток: ${data.attempts.length}` : "Начните с первого теста")
      ),
      h("div", { class: "stat" },
        h("div", { class: "stat-value" }, avg === null ? "—" : avg + "%"),
        h("div", { class: "stat-label" }, "средний результат"),
        h("div", { class: "stat-hint" }, avg === null ? "Появится после проверки" : avg >= 60 ? "Выше проходного уровня" : "Есть над чем поработать")
      ),
      h("div", { class: "stat" },
        h("div", { class: "stat-value" }, String(deadlines.length)),
        h("div", { class: "stat-label" }, "ближайших дедлайнов"),
        h("div", { class: "stat-hint" }, deadlines.length ? "Не откладывайте" : "Свободный график")
      )
    ),

    h("div", { class: "split" },
      listPanel({
        title: "Ближайшие дедлайны",
        items: deadlines.map(a => row({
          dot: a.left <= 2 ? "warn" : "ok",
          title: a.title || a.testTitle || "Назначенный тест",
          sub: `Срок: ${formatDate(a.deadline)} · ${a.left <= 0 ? "просрочено" : `осталось ${a.left} дн.`}`,
          end: h("a", { class: "btn secondary", href: `#quiz/${encodeURIComponent(a.testId)}` }, "Начать")
        })),
        emptyText: "Активных дедлайнов нет.",
        emptyAction: { href: "#assignments", label: "Все задания" }
      }),
      quickActions([
        { icon: icons.clipboard, label: "Задания", hint: "Назначенные тесты", href: "#assignments" },
        { icon: icons.book, label: "Каталог", hint: "Доступные тесты", href: "#tests" },
        { icon: icons.users, label: "Профиль", hint: "Данные и тема", href: "#profile" }
      ])
    ),

    resultChart(data.attempts),

    listPanel({
      title: "Недавние результаты",
      items: data.attempts.slice(0, 5).map(a => {
        const percent = a.status === "graded" && a.total ? Math.round((a.score / a.total) * 100) : null;
        return row({
          dot: percent === null ? "warn" : percent >= 60 ? "ok" : "warn",
          title: a.testTitle || "Тест",
          sub: formatDate(a.submittedAt),
          end: h("span", { class: "badge " + (percent === null ? "badge-neutral" : "badge-success") },
            percent === null ? "На проверке" : percent + "%")
        });
      }),
      emptyText: "Результатов пока нет. Первый пройденный тест появится здесь.",
      emptyAction: { href: "#assignments", label: "К заданиям" }
    }),

    data.errors.length
      ? h("div", { class: "notice", role: "status" },
          "Не удалось загрузить: " + data.errors.join(", ") + ". Проверьте подключение к сети.")
      : null
  ];
}

function staffView(profile, data) {
  const published = data.tests.filter(t => t.status === "published").length;
  const graded = data.attempts.filter(a => a.status === "graded" && a.total);
  const avg = graded.length
    ? Math.round(graded.reduce((sum, a) => sum + (a.score / a.total) * 100, 0) / graded.length)
    : null;
  const pending = data.attempts.filter(a => a.status !== "graded").length;

  return [
    hero({
      eyebrow: profile.role === "admin" ? "Администрирование" : "Кабинет преподавателя",
      title: "Управление обучением",
      lead: "Тесты, проверка результатов и аналитика по вашей организации — в одном месте.",
      actions: [
        { href: "#create-test", label: "Создать тест", cls: "btn primary" },
        { href: "#results", label: "Результаты", cls: "btn secondary" }
      ],
      stats: [
        { value: data.tests.length, label: "ваших тестов" },
        { value: published, label: "опубликовано" },
        { value: data.attempts.length, label: "попыток в организации" }
      ]
    }),

    h("section", { class: "stat-grid" },
      h("div", { class: "stat" },
        h("div", { class: "stat-value" }, String(data.tests.length)),
        h("div", { class: "stat-label" }, "созданных тестов"),
        h("div", { class: "stat-hint" }, `опубликовано: ${published}`)
      ),
      h("div", { class: "stat" },
        h("div", { class: "stat-value" }, String(data.attempts.length)),
        h("div", { class: "stat-label" }, "попыток"),
        h("div", { class: "stat-hint" }, pending ? `ожидают проверки: ${pending}` : "все проверены")
      ),
      h("div", { class: "stat" },
        h("div", { class: "stat-value" }, avg === null ? "—" : avg + "%"),
        h("div", { class: "stat-label" }, "средний результат"),
        h("div", { class: "stat-hint" }, graded.length ? `${graded.length} проверенных` : "нет данных")
      ),
      h("div", { class: "stat" },
        h("div", { class: "stat-value" }, String(new Set(data.attempts.map(a => a.userId)).size)),
        h("div", { class: "stat-label" }, "участников"),
        h("div", { class: "stat-hint" }, "уникальных авторов попыток")
      )
    ),

    h("div", { class: "split" },
      listPanel({
        title: "Мои тесты",
        action: { href: "#create-test", label: "Создать" },
        items: data.tests.slice(0, 5).map(t => row({
          dot: t.status === "published" ? "ok" : "muted",
          title: t.title || "Без названия",
          sub: `${(t.questions || []).length} вопросов · ${formatDate(t.updatedAt)}`,
          end: h("span", { class: "badge " + (t.status === "published" ? "badge-success" : "badge-warning") },
            t.status === "published" ? "Опубликован" : "Черновик"),
          href: "#create-test"
        })),
        emptyText: "Вы ещё не создали ни одного теста.",
        emptyAction: { href: "#create-test", label: "Создать тест" }
      }),
      quickActions([
        { icon: icons.plus, label: "Новый тест", hint: "Конструктор", href: "#create-test" },
        { icon: icons.chart, label: "Результаты", hint: "Проверка и экспорт", href: "#results" },
        { icon: icons.users, label: "Пользователи", hint: "Роли и группы", href: "#users" }
      ])
    ),

    resultChart(data.attempts),

    listPanel({
      title: "Последние попытки",
      action: { href: "#results", label: "Все результаты" },
      items: data.attempts.slice(0, 5).map(a => {
        const percent = a.status === "graded" && a.total ? Math.round((a.score / a.total) * 100) : null;
        return row({
          dot: percent === null ? "warn" : percent >= 60 ? "ok" : "warn",
          title: a.testTitle || "Тест",
          sub: (a.userEmail || "участник") + " · " + formatDate(a.submittedAt),
          end: h("span", { class: "badge " + (percent === null ? "badge-neutral" : "badge-success") },
            percent === null ? "На проверке" : percent + "%")
        });
      }),
      emptyText: "Попыток пока нет. Опубликуйте тест и назначьте его группе.",
      emptyAction: { href: "#create-test", label: "Создать тест" }
    }),

    data.errors.length
      ? h("div", { class: "notice", role: "status" },
          "Не удалось загрузить: " + data.errors.join(", ") + ". Проверьте подключение к сети.")
      : null
  ];
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
    const data = await loadStaffData(profile);
    page.append(...staffView(profile, data).filter(Boolean));
  } else {
    const data = await loadStudentData(profile);
    page.append(...studentView(profile, data).filter(Boolean));
  }

  return page;
}
