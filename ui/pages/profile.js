import { h } from "../../shared/dom.js";
import { State, logout, refreshProfile, createOwnProfile, saveOwnProfile } from "../../core/auth.js";
import { displayName, initialsAvatar, validateFullName, processAvatarFile, saveProfile, computeProfileStats } from "../../core/profile.js";
import { listMyAttempts } from "../../core/attempts.js";
import { icons } from "../../shared/icons.js";
import { getThemeMode, setThemeMode, subscribeTheme } from "../../shared/theme.js";
import { toast } from "../../ui/components/toast.js";
import { modal } from "../../ui/components/modal.js";
import { brandLockup } from "../../ui/components/brand.js";
import { authErrorMessage } from "../../shared/errors.js";

const ROLE_LABEL = { student: "Студент", teacher: "Преподаватель", admin: "Администратор" };
const MODE_LABEL = { light: "Светлая", dark: "Тёмная", system: "Как в системе" };

function formatDate(value) {
  if (!value) return "—";
  const date = typeof value.toDate === "function"
    ? value.toDate()
    : value.seconds
      ? new Date(value.seconds * 1000)
      : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
}

/* ---------- Состояния страницы ---------- */

function stateCard({ icon, title, text, actions = [], tone = "" }) {
  return h("div", { class: "panel" },
    h("div", { class: "empty-state" + (tone ? " " + tone : "") },
      h("div", { class: "empty-state-icon", innerHTML: icon || icons.users }),
      h("h2", {}, title),
      text ? h("p", { class: "muted" }, text) : null,
      actions.length ? h("div", { class: "btn-row" }, ...actions) : null
    )
  );
}

function loadingState() {
  return h("div", { class: "page" },
    h("div", { class: "panel" },
      h("div", { class: "skeleton-line", style: "height:28px;width:240px;margin-bottom:16px" }),
      h("div", { class: "skeleton-line", style: "height:84px;width:84px;border-radius:50%;margin-bottom:16px" }),
      h("div", { class: "skeleton-line", style: "height:16px;width:70%;margin-bottom:8px" }),
      h("div", { class: "skeleton-line", style: "height:16px;width:45%" })
    ),
    h("p", { class: "muted", role: "status" }, "Загружаем профиль…")
  );
}

function signedOutState() {
  return h("div", { class: "page" },
    stateCard({
      icon: icons.users,
      title: "Вы не вошли в аккаунт",
      text: "Войдите, чтобы открыть профиль, историю обучения и настройки.",
      actions: [
        h("a", { class: "btn primary", href: "#login" }, "Войти"),
        h("a", { class: "btn secondary", href: "#register" }, "Создать аккаунт")
      ]
    })
  );
}

function errorState() {
  const retry = h("button", {
    type: "button",
    class: "btn primary",
    onclick: async () => {
      retry.disabled = true;
      retry.textContent = "Повторяем…";
      try {
        await refreshProfile();
      } catch (e) {
        console.error("Повторная загрузка профиля не удалась:", e);
        retry.disabled = false;
        retry.textContent = "Повторить";
      }
    }
  }, "Повторить");

  return h("div", { class: "page" },
    stateCard({
      icon: icons.users,
      title: "Не удалось загрузить профиль",
      text: State.profileError || "Проверьте подключение к интернету и попробуйте снова.",
      actions: [retry]
    })
  );
}

// Документа users/{uid} нет: предлагаем создать его самостоятельно.
// Роль и организацию назначает администратор, поэтому здесь только ФИО и скин.
function missingProfileState() {
  const errors = h("div", { class: "form-error", role: "alert" });
  const input = h("input", {
    type: "text",
    id: "fullName",
    autocomplete: "name",
    placeholder: "Иванов Иван Иванович",
    "aria-describedby": "fullName-hint"
  });
  const uiSelect = h("select", { id: "ui" },
    h("option", { value: "education" }, "Education — базовый"),
    h("option", { value: "operations" }, "Operations — операционный"),
    h("option", { value: "depot" }, "Depot — депо")
  );
  const submit = h("button", { type: "submit", class: "btn primary" }, "Создать профиль");

  const form = h("form", { class: "panel", novalidate: "novalidate" },
    h("div", { class: "eyebrow" }, "Профиль не создан"),
    h("h1", { style: "margin:0 0 8px" }, "Заполните профиль"),
    h("p", { class: "muted" }, "Аккаунт существует, но документа профиля ещё нет. Укажите ФИО — этого достаточно, чтобы начать обучение."),
    errors,
    h("div", { class: "form-field" },
      h("label", { for: "fullName" }, "ФИО"),
      input,
      h("div", { class: "form-hint", id: "fullName-hint" }, "От 2 до 120 символов")
    ),
    h("div", { class: "form-field" },
      h("label", { for: "ui" }, "Стиль интерфейса"),
      uiSelect,
      h("div", { class: "form-hint" }, "Можно изменить позже")
    ),
    h("div", { class: "btn-row" }, submit)
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errors.textContent = "";
    const check = validateFullName(input.value);
    if (!check.ok) {
      errors.textContent = check.error;
      input.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = "Создаём…";
    try {
      await createOwnProfile({ fullName: check.value, ui: uiSelect.value });
      toast("Профиль создан", "success");
    } catch (err) {
      console.error("Не удалось создать профиль:", err);
      errors.textContent = err && err.message ? err.message : authErrorMessage(err);
      submit.disabled = false;
      submit.textContent = "Создать профиль";
    }
  });

  return h("div", { class: "page" }, h("div", { class: "panel" }, brandLockup({ size: 34 })), form);
}

/* ---------- Основной профиль ---------- */

function avatarNode(profile, avatarUrl) {
  const node = h("div", { class: "profile-avatar", "aria-hidden": "true" });
  if (avatarUrl) {
    const img = h("img", { alt: "", src: avatarUrl });
    node.appendChild(img);
  } else {
    const { initials } = initialsAvatar(profile.fullName || profile.email, profile.uid);
    node.textContent = initials;
    node.style.background = "var(--accent)";
    node.style.color = "var(--on-accent)";
  }
  return node;
}

function themeControl() {
  const group = h("div", { class: "segmented", role: "group", "aria-label": "Тема оформления" });
  const render = () => {
    group.textContent = "";
    for (const mode of ["light", "dark", "system"]) {
      const btn = h("button", {
        type: "button",
        "aria-pressed": String(getThemeMode() === mode),
        onclick: () => {
          setThemeMode(mode);
          render();
        }
      }, MODE_LABEL[mode]);
      group.appendChild(btn);
    }
  };
  render();
  return group;
}

function attemptsBlock(profile) {
  const wrap = h("div", { class: "panel" },
    h("div", { class: "section-title" },
      h("h2", {}, "История тестов"),
      h("span", { class: "muted", id: "attempts-count" }, "")
    ),
    h("div", { id: "attempts-body" }, h("div", { class: "skeleton-line", style: "height:64px" }))
  );

  const body = wrap.querySelector("#attempts-body");
  const count = wrap.querySelector("#attempts-count");

  (async () => {
    let attempts = [];
    try {
      attempts = await listMyAttempts(profile.uid);
    } catch (e) {
      console.error("Не удалось загрузить попытки:", e);
      body.replaceChildren(h("p", { class: "muted" },
        "История пока недоступна: нет доступа к результатам или отсутствует подключение."));
      return;
    }

    if (!attempts.length) {
      body.replaceChildren(h("div", { class: "empty-state" },
        h("div", { class: "empty-state-icon", innerHTML: icons.trophy }),
        h("p", {}, "Пройденных тестов пока нет."),
        h("a", { class: "btn secondary", href: "#assignments" }, "Перейти к заданиям")
      ));
      return;
    }

    count.textContent = `${attempts.length} ${attempts.length === 1 ? "попытка" : "попыток"}`;
    const list = h("div", { class: "list" });
    attempts.slice(0, 8).forEach(a => {
      const graded = a.status === "graded";
      const percent = graded && a.total ? Math.round((a.score / a.total) * 100) : null;
      list.appendChild(h("div", { class: "list-row" },
        h("span", { class: "dot " + (graded ? (percent >= 60 ? "ok" : "warn") : "muted") }),
        h("div", { class: "list-row-main" },
          h("div", { class: "list-row-title" }, a.testTitle || "Тест"),
          h("div", { class: "list-row-sub" }, formatDate(a.submittedAt))
        ),
        h("div", { class: "list-row-end" },
          h("span", { class: "badge " + (graded ? "badge-success" : "badge-neutral") },
            graded ? `${percent}%` : "На проверке")
        )
      ));
    });
    body.replaceChildren(list);
  })();

  return wrap;
}

function statsBlock(profile) {
  const grid = h("div", { class: "stat-grid" });
  const block = h("div", { class: "panel" },
    h("div", { class: "section-title" }, h("h2", {}, "Статистика обучения")),
    grid
  );

  (async () => {
    let attempts = [];
    try {
      attempts = await listMyAttempts(profile.uid);
    } catch (e) {
      console.error("Статистика недоступна:", e);
      grid.replaceChildren(h("p", { class: "muted" }, "Данные статистики недоступны."));
      return;
    }
    const stats = computeProfileStats(attempts);
    grid.textContent = "";
    if (!stats) {
      grid.appendChild(h("p", { class: "muted" }, "Статистика появится после первого пройденного теста."));
      return;
    }
    const items = [
      { value: stats.total, label: "всего попыток", hint: "" },
      { value: stats.graded, label: "проверено", hint: "" },
      { value: stats.avg + "%", label: "средний результат", hint: "" },
      { value: stats.passed, label: "зачтено", hint: "" }
    ];
    items.forEach(item => grid.appendChild(h("div", { class: "stat" },
      h("div", { class: "stat-value" }, String(item.value)),
      h("div", { class: "stat-label" }, item.label)
    )));
  })();

  return block;
}

function editForm(profile) {
  const errors = h("div", { class: "form-error", role: "alert" });
  const nameInput = h("input", { type: "text", id: "edit-fullName", value: profile.fullName || "" });
  const positionInput = h("input", { type: "text", id: "edit-position", value: profile.position || "" });
  const departmentInput = h("input", { type: "text", id: "edit-department", value: profile.department || "" });
  const uiSelect = h("select", { id: "edit-ui" },
    h("option", { value: "education" }, "Education — базовый"),
    h("option", { value: "operations" }, "Operations — операционный"),
    h("option", { value: "depot" }, "Depot — депо")
  );
  uiSelect.value = profile.ui || "education";

  const submit = h("button", { type: "submit", class: "btn primary" }, "Сохранить");

  const form = h("form", { class: "panel" },
    h("div", { class: "section-title" }, h("h2", {}, "Личные данные")),
    errors,
    h("div", { class: "field-grid" },
      h("div", { class: "field" }, h("label", { for: "edit-fullName" }, "ФИО"), nameInput),
      h("div", { class: "field" }, h("label", { for: "edit-position" }, "Должность"), positionInput),
      h("div", { class: "field" }, h("label", { for: "edit-department" }, "Подразделение"), departmentInput),
      h("div", { class: "field" }, h("label", { for: "edit-ui" }, "Стиль интерфейса"), uiSelect)
    ),
    h("div", { class: "btn-row" }, submit)
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errors.textContent = "";
    const check = validateFullName(nameInput.value);
    if (!check.ok) {
      errors.textContent = check.error;
      nameInput.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = "Сохраняем…";
    try {
      await saveOwnProfile({
        fullName: check.value,
        position: positionInput.value.trim(),
        department: departmentInput.value.trim(),
        ui: uiSelect.value
      });
      // Публичный профиль нужен для отображения имени в результатах.
      try {
        await saveProfile(profile.uid, {}, {
          displayName: check.value,
          orgId: profile.orgId
        });
      } catch (pubErr) {
        console.warn("Публичный профиль не обновлён:", pubErr);
      }
      toast("Профиль сохранён", "success");
    } catch (err) {
      console.error("Ошибка сохранения профиля:", err);
      errors.textContent = err && err.message ? err.message : "Не удалось сохранить профиль.";
    } finally {
      submit.disabled = false;
      submit.textContent = "Сохранить";
    }
  });

  return form;
}

function avatarDialog(profile) {
  const dialog = modal();
  const preview = h("div", { class: "avatar-preview-container" });
  const errorBox = h("div", { class: "avatar-error", role: "alert" });
  let pending = null;

  const fileInput = h("input", {
    type: "file",
    accept: "image/jpeg,image/png,image/webp",
    onchange: async (e) => {
      errorBox.textContent = "";
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        pending = await processAvatarFile(file);
        preview.textContent = "";
        preview.appendChild(h("img", { src: pending, alt: "Предпросмотр аватара", class: "avatar-preview-img" }));
      } catch (err) {
        pending = null;
        errorBox.textContent = err.message || "Не удалось обработать файл.";
      }
    }
  });

  const saveBtn = h("button", {
    type: "button",
    class: "btn primary",
    onclick: async () => {
      if (!pending) {
        errorBox.textContent = "Сначала выберите изображение.";
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = "Сохраняем…";
      try {
        await saveProfile(profile.uid, {}, {
          displayName: profile.fullName || displayName(profile, { viewerIsStaff: true, uid: profile.uid }),
          avatar: pending,
          orgId: profile.orgId
        });
        toast("Аватар сохранён", "success");
        dialog.close();
      } catch (err) {
        console.error("Ошибка сохранения аватара:", err);
        errorBox.textContent = "Не удалось сохранить аватар. Проверьте формат и размер файла.";
        saveBtn.disabled = false;
        saveBtn.textContent = "Сохранить";
      }
    }
  }, "Сохранить");

  dialog.querySelector(".modal-content").append(
    h("h2", { style: "margin-top:0" }, "Аватар"),
    h("p", { class: "muted" }, "JPEG, PNG или WebP до 3 МБ. Изображение обрезается до квадрата."),
    preview,
    errorBox,
    fileInput,
    h("div", { class: "btn-row" },
      saveBtn,
      h("button", { type: "button", class: "btn secondary", onclick: () => dialog.close() }, "Отмена")
    )
  );
  dialog.show();
}

function renderReady(profile, avatarUrl) {
  const name = displayName(profile, { viewerIsStaff: true, uid: profile.uid });
  const role = ROLE_LABEL[profile.role] || "Студент";

  const header = h("section", { class: "profile-hero" },
    avatarNode(profile, avatarUrl),
    h("div", { class: "profile-hero-text" },
      h("div", { class: "eyebrow" }, "Профиль"),
      h("h1", {}, name),
      h("div", { class: "profile-hero-meta" },
        h("span", { class: "badge badge-info" }, role),
        profile.position ? h("span", {}, profile.position) : null,
        profile.department ? h("span", {}, "· " + profile.department) : null,
        profile.createdAt ? h("span", { class: "muted" }, "· в Skillbase с " + formatDate(profile.createdAt)) : null
      )
    ),
    h("div", { class: "page-head-actions" },
      h("button", { type: "button", class: "btn secondary", onclick: () => avatarDialog(profile) },
        "Сменить аватар"),
      h("button", {
        type: "button",
        class: "btn danger",
        onclick: async () => {
          await logout();
          window.location.hash = "#login";
        }
      }, "Выйти")
    )
  );

  const appearance = h("section", { class: "panel" },
    h("div", { class: "section-title" }, h("h2", {}, "Оформление")),
    h("p", { class: "muted" }, "Тема сохраняется в браузере и применяется на всех страницах."),
    h("div", { class: "field" },
      h("span", { class: "muted" }, "Тема"),
      themeControl()
    ),
    h("div", { class: "field-grid", style: "margin-top:16px" },
      h("div", { class: "field" },
        h("span", { class: "muted" }, "Электронная почта"),
        h("span", { class: "value" }, profile.email || "—")
      ),
      h("div", { class: "field" },
        h("span", { class: "muted" }, "Организация"),
        h("span", { class: "value" }, profile.orgId || "—")
      ),
      h("div", { class: "field" },
        h("span", { class: "muted" }, "Идентификатор"),
        h("span", { class: "value", style: "font-family:var(--mono);font-size:.8125rem" }, profile.uid)
      )
    )
  );

  return h("div", { class: "page" },
    header,
    statsBlock(profile),
    h("div", { class: "split" },
      editForm(profile),
      h("div", { class: "stack" },
        attemptsBlock(profile),
        appearance
      )
    )
  );
}

export default function ProfilePage() {
  switch (State.profileStatus) {
    case "loading":
    case "idle":
      return loadingState();
    case "signed-out":
      return signedOutState();
    case "missing":
      return missingProfileState();
    case "error":
      return errorState();
    case "ready":
    default:
      return State.profile
        ? renderReady(State.profile, State.profile.avatar)
        : errorState();
  }
}
