import { h, esc } from "../../shared/dom.js";
import { State, logout } from "../../core/auth.js";
import { displayName, initialsAvatar, validateFullName, processAvatarFile, saveProfile } from "../../core/profile.js";
import { icons } from "../../shared/icons.js";
import { toast } from "../../ui/components/toast.js";
import { modal } from "../../ui/components/modal.js";

let currentAvatar = null;

function renderAvatar(profile) {
  const { initials, hue } = initialsAvatar(profile.fullName, profile.uid);
  return h("div", {
    class: "avatar avatar-lg",
    style: `background-color: hsl(${hue}, 70%, 80%)`,
    "aria-label": "Аватар"
  }, initials);
}

export default function ProfilePage() {
  const div = h("div", { class: "profile-page" });
  const profile = State.profile || {}
  if (!profile.uid) {
    div.append(h("div", { class: "error-state" }, "Профиль недоступен. Пожалуйста, обновите страницу."));
    return div;
  }
  const name = displayName(profile, { viewerIsStaff: true, uid: profile.uid });

  function render() {
    div.textContent = "";
    div.append(
      h("div", { class: "profile-header" },
        renderAvatar(profile),
        h("div", { class: "profile-info" },
          h("h2", {}, esc(name || "Не указано")),
          h("span", { class: "badge badge-neutral" }, profile.role || "student")
        )
      ),
      h("div", { class: "profile-section" },
        h("h3", {}, "Данные"),
        h("div", { class: "profile-data" },
          h("div", { class: "profile-item" },
            h("span", {}, "Электронная почта:"),
            h("span", {}, esc(profile.email || "Не указано"))
          ),
          h("div", { class: "profile-item" },
            h("span", {}, "Дата регистрации:"),
            h("span", {}, profile.createdAt ? new Date(profile.createdAt.seconds * 1000).toLocaleString() : "—")
          )
        )
      ),
      h("div", { class: "profile-section" },
        h("h3", {}, "Редактирование"),
        h("form", { id: "profile-form" },
          h("div", { class: "form-field" },
            h("label", { for: "fullName" }, "ФИО"),
            h("input", {
              type: "text",
              id: "fullName",
              value: esc(profile.fullName),
              oninput: (e) => updateField("fullName", e.target.value)
            }),
            state.errors.fullName ? h("div", { id: "fullName-error", class: "form-error" }, state.errors.fullName) : null
          ),
          h("div", { class: "form-field" },
            h("label", { for: "position" }, "Должность"),
            h("input", {
              type: "text",
              id: "position",
              value: esc(profile.position),
              oninput: (e) => updateField("position", e.target.value)
            }),
            h("div", { class: "form-hint" }, "Необязательно")
          ),
          h("div", { class: "form-field" },
            h("label", { for: "department" }, "Подразделение"),
            h("input", {
              type: "text",
              id: "department",
              value: esc(profile.department),
              oninput: (e) => updateField("department", e.target.value)
            }),
            h("div", { class: "form-hint" }, "Необязательно")
          )
        )
      ),
      h("div", { class: "profile-section" },
        h("h3", {}, "Оформление"),
        h("div", { class: "theme-selector" },
          h("label", { for: "theme" }, "Тема:"),
          h("select", {
            id: "theme",
            value: getThemeMode(),
            onchange: (e) => setThemeMode(e.target.value)
          }, 
            h("option", { value: "light" }, "Светлая"),
            h("option", { value: "dark" }, "Тёмная"),
            h("option", { value: "system" }, "Система")
          )
        ),
        h("div", { class: "ui-selector" },
          h("label", { for: "ui" }, "Стиль интерфейса:"),
          h("select", {
            id: "ui",
            value: profile.ui,
            onchange: (e) => updateField("ui", e.target.value)
          }, 
            h("option", { value: "education" }, "Образовательный"),
            h("option", { value: "operations" }, "Операционный"),
            h("option", { value: "depot" }, "Депо")
          )
        )
      ),
      h("div", { class: "profile-section" },
        h("h3", {}, "Аватар"),
        h("div", { class: "avatar-actions" },
          h("button", {
            class: "btn secondary",
            onclick: () => showAvatarModal()
          }, "Загрузить аватар")
        )
      ),
      h("div", { class: "profile-section" },
        h("h3", {}, "Статистика"),
        h("div", { class: "empty-state" },
          h("div", { class: "empty-state-icon", innerHTML: icons.trophy }),
          h("h2", {}, "Статистика не доступна"),
          h("p", {}, "Здесь появится статистика после первого пройденного теста.")
        )
      ),
      h("button", {
        class: "btn danger",
        onclick: async () => {
          await logout();
          window.location.hash = "#login";
        }
      }, "Выйти")
    );
  }

  let state = { fullName: profile.fullName, position: profile.position, department: profile.department, ui: profile.ui };

  function updateField(field, value) {
    state[field] = value;
    render();
  }

  async function saveProfileData() {
    const patch = { ...state };
    const publicPatch = { displayName: displayName(profile, { viewerIsStaff: true, uid: profile.uid }), updatedAt: serverTimestamp() };

    try {
      await saveProfile(profile.uid, patch, publicPatch, profile);
      toast("Профиль сохранён", "success");
    } catch (err) {
      console.error("Ошибка сохранения профиля:", err);
      toast("Ошибка сохранения: " + (err.message || "Неизвестная ошибка"), "error");
    }
  }

  async function showAvatarModal() {
    const modalDiv = modal();
    const fileInput = h("input", { type: "file", accept: "image/*", onchange: handleFileChange });
    const preview = h("div", { class: "avatar-preview" });
    const cancelBtn = h("button", { class: "btn secondary", onclick: () => modalDiv.close() }, "Отмена");
    const saveBtn = h("button", { class: "btn primary", onclick: () => saveAvatar() }, "Сохранить");

    modalDiv.append(
      h("div", { class: "modal-content" },
        h("h3", {}, "Загрузить аватар"),
        h("div", { class: "avatar-preview-container" },
          preview,
          h("div", { class: "avatar-error" }, "Некорректный формат или размер")
        ),
        h("input", { type: "file", accept: "image/*", onchange: handleFileChange }),
        h("div", { class: "file-hint" }, "Файл должен быть JPEG/PNG/WEBp ≤ 3 МБ")
      ),
      cancelBtn,
      saveBtn
    );

    modalDiv.show();
  }

  async function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const dataUrl = await processAvatarFile(file);
      preview.textContent = "";
      const img = document.createElement("img");
      img.src = dataUrl;
      img.alt = "Предпросмотр аватара";
      img.className = "avatar-preview-img";
      preview.appendChild(img);
    } catch (err) {
      preview.textContent = "";
      preview.appendChild(h("div", { class: "avatar-error" }, err.message || "Неизвестная ошибка"));
    }
  }

  async function saveAvatar() {
    const modalDiv = modal();
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      const dataUrl = await processAvatarFile(file);
      const patch = { avatar: dataUrl };
      await saveProfile(profile.uid, {}, { displayName: displayName(profile, { viewerIsStaff: true, uid: profile.uid }), avatar: dataUrl, updatedAt: serverTimestamp() }, profile);
      toast("Аватар сохранён", "success");
      modalDiv.close();
    };

    modalDiv.append(
      h("div", { class: "modal-content" },
        h("h3", {}, "Сохранить аватар"),
        h("input", { type: "file", accept: "image/*", ref: (el) => fileInput = el }),
        h("button", { class: "btn secondary", onclick: () => modalDiv.close() }, "Отмена")
      )
    );

    modalDiv.show();
  }

  render();
  return div;
}