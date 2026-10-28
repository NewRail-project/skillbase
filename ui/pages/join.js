// ui/pages/join.js — вход в Live-комнату по коду: #join и #join/<код>.
import { h } from "../../shared/dom.js";
import { State, signInAsGuest } from "../../core/auth.js";
import { getRoom, joinRoom } from "../../core/rooms.js";
import { normalizeRoomCode } from "../../core/rooms-logic.js";
import { AVATAR_PRESETS } from "../../shared/avatars.js";
import { toast } from "../components/toast.js";

function errorBody(err) {
  if (err?.code === "permission-denied") {
    return "Правила Firestore не разрешают вход в эту комнату.";
  }
  if (err?.code === "unavailable") {
    return "Нет связи с сервером. Проверьте подключение к сети.";
  }
  return err?.message || "Не удалось войти в комнату.";
}

export default async function JoinPage() {
  const page = h("div", { class: "page" });
  const codeFromRoute = (State.routeParam || "").split("/")[0] || "";

  const displayCodeInput = h("input", {
    id: "room-code-input",
    class: "room-code-input",
    type: "text",
    inputmode: "text",
    autocapitalize: "characters",
    autocomplete: "off",
    spellcheck: "false",
    maxlength: "6",
    placeholder: "ABC123",
    "aria-label": "Код комнаты",
    value: codeFromRoute ? (normalizeRoomCode(codeFromRoute) || codeFromRoute.toUpperCase()) : ""
  });

  const roleOpen = h("input", { type: "radio", name: "join-role", value: "player", id: "join-role-player" });
  const roleObserver = h("input", { type: "radio", name: "join-role", value: "observer", id: "join-role-observer" });
  roleOpen.checked = true;

  const message = h("div", { class: "form-hint", role: "status" });

  // Подсветка валидности кода на вводе.
  displayCodeInput.addEventListener("input", () => {
    displayCodeInput.value = displayCodeInput.value.toUpperCase().replace(/\s+/g, "");
    const normalized = normalizeRoomCode(displayCodeInput.value);
    displayCodeInput.classList.toggle("is-valid", !!normalized);
    displayCodeInput.classList.toggle("is-invalid", !normalized && displayCodeInput.value.length === 6);
  });

  const joinBtn = h("button", { type: "button", class: "btn primary btn-block" }, "Войти в комнату");

  joinBtn.addEventListener("click", async () => {
    message.textContent = "";
    message.className = "form-hint";

    const code = normalizeRoomCode(displayCodeInput.value);
    if (!code) {
      message.textContent = "Код комнаты — 6 символов, без 0, O, 1 и I.";
      message.className = "form-error";
      displayCodeInput.focus();
      return;
    }

    const observer = roleObserver.checked;
    const role = observer ? "Наблюдатель" : "Участник";

    joinBtn.disabled = true;
    joinBtn.textContent = "Проверяем код…";
    try {
      const room = await getRoom(code);
      if (!room) {
        message.textContent = "Комната с таким кодом не найдена.";
        message.className = "form-error";
        return;
      }
      if (room.status !== "active") {
        message.textContent = "Комната уже закрыта.";
        message.className = "form-error";
        return;
      }
      await joinRoom(code, {
        displayName: (State.profile?.fullName || "").split(" ")[0] || State.user.email,
        observer,
        profile: State.profile
      });
      toast(`Вы вошли как «${role}»`, "success");
      window.location.hash = `#room/${code}`;
    } catch (err) {
      console.error("Вход в комнату:", err);
      message.textContent = errorBody(err);
      message.className = "form-error";
    } finally {
      joinBtn.disabled = false;
      joinBtn.textContent = "Войти в комнату";
    }
  });

  page.appendChild(hero());

  // Гостевой режим: неавторизованный пользователь или уже анонимный гость.
  // Обычный вход (email + роль) им недоступен — правила Firestore требуют
  // профиль, которого у гостя нет.
  const guestMode = !State.user || State.user.isAnonymous === true;

  page.append(
    h("div", { class: "panel panel-narrow" },
      h("div", { class: "panel-head" }, h("h2", {}, "Вход по коду")),
      h("div", { class: "panel-body" },
        h("div", { class: "field" },
          h("label", { for: "room-code-input" }, "Код комнаты"),
          displayCodeInput
        ),
        guestMode ? guestEntry() : h("fieldset", { class: "role-picker" },
          h("legend", { class: "muted" }, "Роль"),
          h("label", { class: "role-option", for: "join-role-player" },
            roleOpen,
            h("span", { class: "role-option-body" },
              h("b", {}, "Участник"),
              h("span", { class: "muted" }, "Отвечает на вопросы")
            )
          ),
          h("label", { class: "role-option", for: "join-role-observer" },
            roleObserver,
            h("span", { class: "role-option-body" },
              h("b", {}, "Наблюдатель"),
              h("span", { class: "muted" }, "Смотрит и не отвечает")
            )
          )
        ),
        guestMode ? null : joinBtn,
        message
      )
    )
  );

  // Автофокус: если код не пришёл из маршрута, сразу вводим.
  if (!codeFromRoute) {
    setTimeout(() => displayCodeInput.focus(), 50);
  }

  return page;

  // Гостевой блок: имя и аватар вместо регистрации.
  // Замыкание над displayCodeInput и message — код читается из поля
  // в момент нажатия, без document.getElementById и внешних стейтов.
  function guestEntry() {
    const nameInput = h("input", {
      id: "guest-name",
      type: "text",
      autocomplete: "name",
      maxlength: "120",
      placeholder: "Имя Фамилия",
      "aria-label": "Ваше имя"
    });

    const avatarSelect = h("select", {
      id: "guest-avatar",
      "aria-label": "Аватар"
    }, AVATAR_PRESETS.map(preset =>
      h("option", { value: `preset:${preset.id}` }, `${preset.emoji} ${preset.id}`)
    ));

    const guestBtn = h("button", { type: "button", class: "btn primary btn-block", id: "guest-enter" }, "Войти как гость");

    guestBtn.addEventListener("click", async () => {
      message.textContent = "";
      message.className = "form-hint";

      const code = normalizeRoomCode(displayCodeInput.value);
      if (!code) {
        message.textContent = "Код комнаты — 6 символов, без 0, O, 1 и I.";
        message.className = "form-error";
        displayCodeInput.focus();
        return;
      }

      const name = nameInput.value;
      const avatar = avatarSelect.value;
      if (!name.trim()) {
        message.textContent = "Укажите имя.";
        message.className = "form-error";
        nameInput.focus();
        return;
      }

      guestBtn.disabled = true;
      guestBtn.textContent = "Входим…";
      try {
        await signInAsGuest(code, name, avatar);
        toast(`Вы вошли как гость «${name.trim()}»`, "success");
        window.location.hash = `#room/${code}`;
      } catch (err) {
        console.error("Гостевой вход:", err);
        message.textContent = errorBody(err);
        message.className = "form-error";
      } finally {
        guestBtn.disabled = false;
        guestBtn.textContent = "Войти как гость";
      }
    });

    return h("div", { class: "guest-entry" },
      h("p", { class: "form-hint muted" }, "Нет аккаунта? Введите код комнаты и войдите как гость."),
      h("div", { class: "field" },
        h("label", { for: "guest-name" }, "Ваше имя"),
        nameInput
      ),
      h("div", { class: "field" },
        h("label", { for: "guest-avatar" }, "Аватар"),
        avatarSelect
      ),
      guestBtn
    );
  }
}

function hero() {
  return h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Live-комната"),
      h("h1", {}, "Войти по коду"),
      h("p", { class: "page-sub" }, "Введите код из шести символов, который показал ведущий. Код не содержит похожих символов 0, O, 1 и I.")
    )
  );
}
