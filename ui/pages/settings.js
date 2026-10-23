import { h } from "../../shared/dom.js";
import { State, saveOwnProfile } from "../../core/auth.js";
import { validateFullName } from "../../core/profile.js";
import { getThemeMode, setThemeMode, subscribeTheme } from "../../shared/theme.js";
import { toast } from "../../ui/components/toast.js";

const MODES = [
  ["light", "Светлая", "Всегда светлая"],
  ["dark", "Тёмная", "Всегда тёмная"],
  ["system", "Как в системе", "Следует настройке устройства"]
];

const SKINS = [
  ["education", "Education", "Просторный базовый стиль"],
  ["operations", "Operations", "Плотнее, для работы"],
  ["depot", "Depot", "Индустриальный, строгий"]
];

export default function SettingsPage() {
  const page = h("div", { class: "page" });
  const profile = State.profile || {};

  page.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Аккаунт"),
      h("h1", {}, "Настройки"),
      h("p", { class: "page-sub" }, "Оформление и личные данные. Роль и организацию назначает администратор.")
    )
  ));

  /* ---------- Оформление ---------- */
  const themeGroup = h("div", { class: "segmented", role: "group", "aria-label": "Тема оформления" });
  const paintTheme = () => {
    themeGroup.textContent = "";
    for (const [mode, label] of MODES) {
      themeGroup.appendChild(h("button", {
        type: "button",
        "aria-pressed": String(getThemeMode() === mode),
        onclick: () => {
          setThemeMode(mode);
          paintTheme();
        }
      }, label));
    }
  };
  paintTheme();
  const unsub = subscribeTheme(paintTheme);
  if (typeof window !== "undefined") {
    window.addEventListener("hashchange", () => unsub(), { once: true });
  }

  const skinSelect = h("select", { id: "skin" },
    SKINS.map(([value, label, hint]) => h("option", { value }, `${label} — ${hint}`))
  );
  skinSelect.value = profile.ui || "education";
  skinSelect.addEventListener("change", async () => {
    try {
      await saveOwnProfile({ ui: skinSelect.value });
      toast("Скин применён", "success");
    } catch (e) {
      toast(e.message || "Не удалось применить скин", "error");
      skinSelect.value = profile.ui || "education";
    }
  });

  page.appendChild(h("section", { class: "panel" },
    h("div", { class: "section-title" }, h("h2", {}, "Оформление")),
    h("div", { class: "field-grid", style: "margin-top:16px" },
      h("div", { class: "field" },
        h("span", { class: "muted" }, "Тема"),
        themeGroup,
        h("span", { class: "muted", style: "font-size:.8125rem" }, "Выбор сохраняется в браузере и применяется на всех страницах.")
      ),
      h("div", { class: "field" },
        h("label", { for: "skin" }, "Скин интерфейса"),
        skinSelect,
        h("span", { class: "muted", style: "font-size:.8125rem" }, "Влияет на акценты и плотность, но не отменяет тему.")
      )
    )
  ));

  /* ---------- Личные данные ---------- */
  const errors = h("div", { class: "form-error", role: "alert" });
  const nameInput = h("input", { type: "text", id: "fullName", value: profile.fullName || "", autocomplete: "name" });
  const positionInput = h("input", { type: "text", id: "position", value: profile.position || "" });
  const departmentInput = h("input", { type: "text", id: "department", value: profile.department || "" });
  const submit = h("button", { type: "submit", class: "btn primary" }, "Сохранить");

  const form = h("form", { class: "panel" },
    h("div", { class: "section-title" }, h("h2", {}, "Личные данные")),
    errors,
    h("div", { class: "field-grid" },
      h("div", { class: "field" }, h("label", { for: "fullName" }, "ФИО"), nameInput),
      h("div", { class: "field" }, h("label", { for: "position" }, "Должность"), positionInput),
      h("div", { class: "field" }, h("label", { for: "department" }, "Подразделение"), departmentInput),
      h("div", { class: "field" },
        h("span", { class: "muted" }, "Электронная почта"),
        h("span", { class: "value" }, State.user.email || "—")
      )
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
        department: departmentInput.value.trim()
      });
      toast("Настройки сохранены", "success");
    } catch (err) {
      console.error(err);
      errors.textContent = err.message || "Не удалось сохранить настройки.";
    } finally {
      submit.disabled = false;
      submit.textContent = "Сохранить";
    }
  });
  page.appendChild(form);

  page.appendChild(h("section", { class: "panel" },
    h("div", { class: "section-title" }, h("h2", {}, "Доступ")),
    h("p", { class: "muted" }, "Роль и организация выдаются администратором и не меняются из интерфейса."),
    h("div", { class: "field-grid" },
      h("div", { class: "field" },
        h("span", { class: "muted" }, "Роль"),
        h("span", { class: "value" }, { student: "Студент", teacher: "Преподаватель", admin: "Администратор" }[profile.role] || "—")
      ),
      h("div", { class: "field" },
        h("span", { class: "muted" }, "Организация"),
        h("span", { class: "value" }, profile.orgId || "—")
      )
    )
  ));

  return page;
}
