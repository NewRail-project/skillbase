import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { listMyTests, listPublishedTests } from "../../core/editor.js";
import { icons } from "../../shared/icons.js";

function formatDate(value) {
  if (!value) return "—";
  const date = value.toDate ? value.toDate() : value.seconds ? new Date(value.seconds * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
}

function explainError(err) {
  const code = err && err.code;
  if (code === "permission-denied") {
    return "Нет доступа к каталогу: правила Firestore не разрешают чтение этих тестов.";
  }
  if (code === "failed-precondition") {
    return "Для каталога нужен составной индекс Firestore (orgId + status). Индекс описан в firestore.indexes.json.";
  }
  if (code === "unavailable") {
    return "Нет связи с Firestore. Проверьте подключение к интернету.";
  }
  return "Не удалось загрузить каталог тестов. Попробуйте ещё раз.";
}

function testCard(test, index, staff) {
  const tone = `cover-${(index % 4) + 1}`;
  const questions = (test.questions || []).length;
  const time = test.settings?.timePerQuestion
    ? `${test.settings.timePerQuestion} сек/вопрос`
    : test.settings?.totalTime
      ? `${Math.round(test.settings.totalTime / 60)} мин`
      : "без ограничения";

  const card = h("article", { class: "course-card" });
  const cover = h("div", { class: "course-cover " + tone });
  const mark = h("span", { class: "cover-mark" });
  mark.innerHTML = `<svg viewBox="0 0 32 32" width="96" height="96" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 27 L16 4.5 L24.5 27"/><path d="M6.86 25 H25.14"/><path d="M8.74 20 H23.26"/><path d="M10.63 15 H21.37"/><path d="M12.52 10 H19.48"/></svg>`;
  cover.appendChild(mark);
  card.appendChild(cover);

  const body = h("div", { class: "course-body" },
    h("h3", {}, test.title || "Без названия"),
    test.description ? h("p", { class: "muted", style: "margin:0" }, test.description) : null,
    h("div", { class: "course-meta" },
      h("span", {}, `${questions} ${questions === 1 ? "вопрос" : "вопросов"}`),
      h("span", {}, time),
      h("span", {}, formatDate(test.updatedAt || test.createdAt))
    )
  );

  const foot = h("div", { class: "course-foot", style: "flex-wrap:wrap" });
  const status = h("span", {
    class: "badge " + (test.status === "published" ? "badge-success" : "badge-warning")
  }, test.status === "published" ? "Опубликован" : "Черновик");

  if (staff) {
    foot.append(
      status,
      h("a", { class: "btn secondary", href: `#create-test/${encodeURIComponent(test.id)}` }, "Редактировать"),
      h("a", { class: "btn secondary", href: `#quiz/${encodeURIComponent(test.id)}` }, "Открыть")
    );
  } else {
    foot.append(status, h("a", {
      class: "btn primary",
      href: `#quiz/${encodeURIComponent(test.id)}`
    }, "Начать"));
  }
  body.appendChild(foot);
  card.appendChild(body);
  return card;
}

export default async function TestsPage() {
  const staff = isStaff();
  const page = h("div", { class: "page" });

  const head = h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Обучение"),
      h("h1", {}, staff ? "Мои тесты" : "Каталог тестов"),
      h("p", { class: "page-sub" }, staff
        ? "Тесты, которые вы создали. Черновики видны только вам."
        : "Опубликованные тесты вашей организации. Выберите тест, чтобы начать.")
    ),
    staff ? h("div", { class: "page-head-actions" },
      h("a", { class: "btn primary", href: "#create-test" }, "Создать тест")
    ) : null
  );
  page.appendChild(head);

  const search = h("input", { type: "search", placeholder: "Поиск по названию", "aria-label": "Поиск по названию" });
  const filters = h("div", { class: "filter-bar" }, search);
  let activeFilter = "all";
  if (staff) {
    for (const [value, label] of [["all", "Все"], ["published", "Опубликованные"], ["draft", "Черновики"]]) {
      const chip = h("button", {
        type: "button",
        class: "chip",
        "aria-pressed": String(value === "all"),
        onclick: () => {
          activeFilter = value;
          filters.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", String(c === chip)));
          draw();
        }
      }, label);
      filters.appendChild(chip);
    }
  }
  page.appendChild(filters);

  const grid = h("div", { class: "course-grid" });
  page.appendChild(grid);

  let tests = [];

  function draw() {
    const query = search.value.trim().toLowerCase();
    const visible = tests.filter(t => {
      const matchesText = !query || (t.title || "").toLowerCase().includes(query);
      const matchesStatus = activeFilter === "all" || t.status === activeFilter;
      return matchesText && matchesStatus;
    });

    grid.textContent = "";
    if (!visible.length) {
      grid.appendChild(h("div", { class: "panel", style: "grid-column:1/-1" },
        h("div", { class: "empty-state" },
          h("div", { class: "empty-state-icon", innerHTML: icons.book }),
          h("h2", {}, tests.length ? "Ничего не найдено" : (staff ? "Тестов пока нет" : "Опубликованных тестов нет")),
          h("p", { class: "muted" }, tests.length
            ? "Измените запрос или фильтр."
            : staff
              ? "Создайте первый тест — он появится в этом списке."
              : "Как только преподаватель опубликует тест, он появится здесь."),
          staff && !tests.length ? h("a", { class: "btn primary", href: "#create-test" }, "Создать тест") : null
        )
      ));
      return;
    }
    visible.forEach((t, i) => grid.appendChild(testCard(t, i, staff)));
  }

  search.addEventListener("input", draw);

  grid.appendChild(h("div", { class: "panel", style: "grid-column:1/-1" },
    h("div", { class: "spinner" })));

  try {
    tests = staff
      ? await listMyTests(State.user.uid)
      : await listPublishedTests(State.profile.orgId);
    draw();
  } catch (err) {
    console.error("Каталог тестов:", err);
    grid.textContent = "";
    grid.appendChild(h("div", { class: "panel", style: "grid-column:1/-1" },
      h("div", { class: "empty-state" },
        h("div", { class: "empty-state-icon", innerHTML: icons.book }),
        h("h2", {}, "Каталог недоступен"),
        h("p", { class: "muted" }, explainError(err)),
        h("button", {
          type: "button",
          class: "btn secondary",
          onclick: () => window.location.reload()
        }, "Повторить")
      )
    ));
  }

  return page;
}
