import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { listMyTests, listPublishedTests, deleteTest } from "../../core/editor.js";
import { canDeleteTest, deletionPlan, explainDeleteError } from "../../core/test-delete-logic.js";
import { listAssignments } from "../../core/assign.js";
import { getDocs, query, collection, db, where } from "../../shared/firebase.js";
import { confirmAction } from "../../ui/components/confirm.js";
import { toast } from "../../ui/components/toast.js";
import { icons } from "../../shared/icons.js";
import { t as tr, lt } from "../../core/i18n.js";

function formatDate(value) {
  if (!value) return "—";
  const date = value.toDate ? value.toDate() : value.seconds ? new Date(value.seconds * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
}

function explainError(err) {
  const code = err && err.code;
  if (code === "permission-denied") {
    return tr("tests.catalogDenied");
  }
  if (code === "failed-precondition") {
    // failed-precondition означает и «индекса нет», и «индекс ещё строится» —
    // различить их на клиенте нельзя, поэтому сообщение честно описывает оба случая.
    return "Запросу каталога не хватает составного индекса Firestore (индексы описаны в firestore.indexes.json). Если индекс только что добавлен, его построение может занять несколько минут — попробуйте позже.";
  }
  if (code === "unavailable") {
    return "Нет связи с Firestore. Проверьте подключение к интернету.";
  }
  return tr("tests.catalogError");
}

function testCard(test, staff) {
  // Цвет карточки из настроек теста: 1..4 — палитры cover-1..cover-4.
  const colorIndex = Number(test.color);
  const tone = colorIndex >= 1 && colorIndex <= 4
    ? `cover-${colorIndex}`
    : `cover-${(test.title?.length ?? 0) % 4 + 1}`;
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
    const onDelete = async () => {
      const can = canDeleteTest(test, { uid: State.user.uid, role: State.profile.role, orgId: State.profile.orgId });
      if (!can.allowed) {
        toast(can.reason, "error");
        return;
      }

      // План удаления: нужно найти активные задания и комнаты теста.
      // Читаем задания организации; комнаты — только свои (правила не дадут читать чужие).
      let assignments = [];
      try {
        assignments = await listAssignments(State.profile.orgId);
      } catch (_) {}

      // Комнаты: ищем активные комнаты этого теста, где я ведущий.
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

      let warnText = tr("tests.deleteHint");
      const details = [];
      if (plan.closeAssignmentIds.length) {
        details.push(h("p", { class: "warning-msg" }, `Будет закрыто активных заданий: ${plan.closeAssignmentIds.length}`));
      }
      if (plan.closeRoomCodes.length) {
        details.push(h("p", { class: "warning-msg" }, `Будет закрыто активных Live-комнат: ${plan.closeRoomCodes.length}`));
      }
      if (plan.foreignAssignmentIds.length || plan.foreignRooms.length) {
        details.push(h("p", { class: "muted", style: "font-size:0.9em" }, tr("tests.deleteForeign")));
      }

      const ok = await confirmAction({
        title: tr("tests.deleteConfirm", { title: test.title }),
        text: warnText,
        details,
        confirmLabel: "Удалить",
        tone: "danger"
      });

      if (ok) {
        try {
          await deleteTest(test.id, plan);
          toast(tr("tests.deleted"), "success");
          // Перерисовываем страницу через роутер или находим и удаляем карточку.
          // Проще всего вызвать роутер, так как страница тестов асинхронная.
          window.location.reload();
        } catch (err) {
          toast(explainDeleteError(err), "error");
        }
      }
    };

    foot.append(
      status,
      h("a", { class: "btn secondary", href: `#create-test/${encodeURIComponent(test.id)}` }, "Редактировать"),
      test.status === "published"
        ? h("a", { class: "btn primary", href: `#launch/${encodeURIComponent(test.id)}` }, "Запустить")
        : null,
      h("a", { class: "btn secondary", href: `#quiz/${encodeURIComponent(test.id)}` }, "Открыть"),
      h("button", { type: "button", class: "btn secondary danger-text", onclick: onDelete, title: lt("tests.deleteTitle") }, "Удалить")
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
      h("div", { class: "eyebrow" }, lt("tests.eyebrow")),
      h("h1", {}, staff ? lt("tests.titleMine") : lt("tests.titleCatalog")),
      h("p", { class: "page-sub" }, staff ? lt("tests.subMine") : lt("tests.subCatalog"))
    ),
    staff ? h("div", { class: "page-head-actions" },
      h("a", { class: "btn primary", href: "#create-test" }, lt("tests.create"))
    ) : null
  );
  page.appendChild(head);

  const search = h("input", { type: "search", placeholder: "Поиск по названию", "aria-label": "Поиск по названию" });
  const filters = h("div", { class: "filter-bar" }, search);
  let activeFilter = staff ? "all" : "published";
  let activeCategory = "";
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

  // Фильтр по категории строится из того, что реально встречается в тестах.
  const categorySelect = h("select", { "aria-label": "Фильтр по категории", class: "chip", style: "width:auto" });
  filters.appendChild(categorySelect);

  const grid = h("div", { class: "course-grid" });
  page.appendChild(grid);

  let tests = [];

  function draw() {
    const query = search.value.trim().toLowerCase();
    const visible = tests.filter(t => {
      const matchesText = !query || (t.title || "").toLowerCase().includes(query);
      const matchesStatus = activeFilter === "all" || t.status === activeFilter;
      const matchesCategory = !activeCategory || (t.category || "") === activeCategory;
      return matchesText && matchesStatus && matchesCategory;
    });

    grid.textContent = "";
    if (!visible.length) {
      grid.appendChild(h("div", { class: "panel", style: "grid-column:1/-1" },
        h("div", { class: "empty-state" },
          h("div", { class: "empty-state-icon", innerHTML: icons.book }),
          h("h2", {}, tests.length ? "Ничего не найдено" : (staff ? lt("tests.emptyMine") : lt("tests.emptyCatalog"))),
          h("p", { class: "muted" }, tests.length
            ? "Измените запрос или фильтр."
            : staff
              ? lt("tests.emptyMineHint")
              : lt("tests.emptyCatalogHint")),
          staff && !tests.length ? h("a", { class: "btn primary", href: "#create-test" }, lt("tests.create")) : null
        )
      ));
      return;
    }
    visible.forEach(t => grid.appendChild(testCard(t, staff)));
  }

  search.addEventListener("input", draw);
  categorySelect.addEventListener("change", () => {
    activeCategory = categorySelect.value;
    draw();
  });

  function refreshCategoryFilter() {
    const categories = [...new Set(tests.map(t => (t.category || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
    categorySelect.textContent = "";
    categorySelect.appendChild(h("option", { value: "" }, "Все категории"));
    categories.forEach(cat => categorySelect.appendChild(h("option", { value: cat }, cat)));
    categorySelect.hidden = categories.length === 0;
  }

  // Загрузка каталога вынесена в отдельную функцию: кнопка «Повторить»
  // повторяет именно запрос, а не перезагружает всё приложение.
  async function loadCatalog() {
    grid.textContent = "";
    grid.appendChild(h("div", { class: "panel", style: "grid-column:1/-1" },
      h("div", { class: "spinner" })));

    try {
      tests = staff
        ? await listMyTests(State.user.uid, State.profile.orgId, State.profile.role)
        : await listPublishedTests(State.profile.orgId);
      refreshCategoryFilter();
      draw();
    } catch (err) {
      // Исходная ошибка всегда в консоли: код (failed-precondition /
      // permission-denied / unavailable) виден разработчику полностью.
      console.error("Каталог тестов:", err);
      grid.textContent = "";
      grid.appendChild(h("div", { class: "panel", style: "grid-column:1/-1" },
        h("div", { class: "empty-state" },
          h("div", { class: "empty-state-icon", innerHTML: icons.book }),
          h("h2", {}, "Каталог недоступен"),
          h("p", { class: "muted" }, () => explainError(err)),
          h("button", {
            type: "button",
            class: "btn secondary",
            onclick: loadCatalog
          }, "Повторить")
        )
      ));
    }
  }

  loadCatalog();

  return page;
}
