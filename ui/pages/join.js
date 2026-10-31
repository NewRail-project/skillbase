// ui/pages/join.js — вход в Live-комнату по коду: #join и #join/<код>.
// #join/<код> — это ссылка приглашения из QR. И по коду, и по QR
// пользователь сначала видит экран «Как вы хотите войти?» и выбирает роль:
//   • Участник  — вводит ФИО (если его нет в профиле), ждёт старта, сам
//     проходит вопросы, получает баллы и попадает в общий рейтинг;
//   • Наблюдатель — вводит имя для комнаты, видит рейтинг и ход теста,
//     но не отвечает и не получает баллов.
// Уже вошедший (players/{uid} существует) сразу возвращается в комнату со
// своей ПРЕЖНЕЙ ролью: наблюдатель не превращается в участника, а выбор
// роли пережившей перезагрузку сессии восстанавливается из sessionStorage.
import { h } from "../../shared/dom.js";
import { State, signInAsGuest, isStaff } from "../../core/auth.js";
import { getRoom, joinRoom, getMyRoomRole } from "../../core/rooms.js";
import { normalizeRoomCode } from "../../core/rooms-logic.js";
import {
  ROLE_PLAYER, ROLE_OBSERVER, nameForJoin, resolveRequestedRole, isRegistrationOpen
} from "../../core/live-auto.js";
import { getGuestName } from "../../core/guest.js";
import { saveReturnTo } from "../../shared/return-to.js";
import { AVATAR_PRESETS } from "../../shared/avatars.js";
import { toast } from "../components/toast.js";

const ROLE_LABEL = { [ROLE_PLAYER]: "Участник", [ROLE_OBSERVER]: "Наблюдатель" };

function errorBody(err) {
  if (err?.code === "permission-denied") {
    return "Правила Firestore не разрешают вход в эту комнату (возможно, регистрация закрыта).";
  }
  if (err?.code === "unavailable") {
    return "Нет связи с сервером. Проверьте подключение к сети.";
  }
  return err?.message || "Не удалось войти в комнату.";
}

// Выбор роли переживает перезагрузку страницы в рамках сессии вкладки.
function roleKey(code) { return `sb:liveRole:${code}`; }
function rememberRole(code, role) {
  try { sessionStorage.setItem(roleKey(code), role); } catch { /* приватный режим */ }
}
function recallRole(code) {
  try {
    const value = sessionStorage.getItem(roleKey(code));
    return value === ROLE_OBSERVER || value === ROLE_PLAYER ? value : null;
  } catch { return null; }
}

export default async function JoinPage() {
  const page = h("div", { class: "page" });
  const codeRaw = (State.routeParam || "").split("/")[0] || "";
  const codeFromRoute = normalizeRoomCode(codeRaw) || "";
  const signedIn = Boolean(State.user);
  const guestMode = !State.user || State.user.isAnonymous === true;

  // Уже в комнате (в том числе после перезагрузки): возвращаем в неё с
  // прежней ролью. Роль не меняется — её защищают правила Firestore.
  if (codeFromRoute && signedIn) {
    try {
      const existing = await getMyRoomRole(codeFromRoute);
      if (existing) {
        rememberRole(codeFromRoute, existing);
        toast(`Вы уже в комнате как «${ROLE_LABEL[existing]}»`, "info");
        window.location.hash = `#room/${codeFromRoute}`;
        return page;
      }
    } catch (err) {
      // Не смогли прочитать документ — покажем обычный экран входа.
      console.warn("Проверка членства:", err?.code || err);
    }
  }

  let room = null;
  let roomError = "";
  if (codeFromRoute && signedIn) {
    try {
      room = await getRoom(codeFromRoute);
      if (!room) roomError = "Комната с таким кодом не найдена.";
      else if (room.status !== "active") roomError = "Комната уже закрыта.";
      else if (room.hostId === State.user.uid) {
        window.location.hash = `#room/${codeFromRoute}`;
        return page;
      }
    } catch (err) {
      console.warn("Чтение комнаты:", err?.code || err);
    }
  }

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
    value: codeFromRoute
  });

  displayCodeInput.addEventListener("input", () => {
    displayCodeInput.value = displayCodeInput.value.toUpperCase().replace(/\s+/g, "");
    const normalized = normalizeRoomCode(displayCodeInput.value);
    displayCodeInput.classList.toggle("is-valid", !!normalized);
    displayCodeInput.classList.toggle("is-invalid", !normalized && displayCodeInput.value.length === 6);
  });

  const message = h("div", { class: "form-hint", role: "status" });
  const setMessage = (text, isError = true) => {
    message.textContent = text;
    message.className = isError && text ? "form-error" : "form-hint";
  };

  // ---------- Выбор роли ----------

  // Преподаватель, не ведущий комнаты, входит только наблюдателем.
  const staffObserverOnly = signedIn && !guestMode && isStaff();
  let selectedRole = recallRole(codeFromRoute) || (staffObserverOnly ? ROLE_OBSERVER : null);
  if (staffObserverOnly) selectedRole = ROLE_OBSERVER;

  const cards = [];
  const nameInput = h("input", {
    id: "join-name",
    type: "text",
    autocomplete: "name",
    maxlength: "120",
    placeholder: "Фамилия Имя Отчество"
  });
  const nameLabel = h("label", { for: "join-name" }, "ФИО");
  const nameHint = h("p", { class: "form-hint muted" }, "");
  const profileName = signedIn && !guestMode
    ? String(State.profile?.fullName || "").trim()
    : getGuestName();
  nameInput.value = profileName;

  const joinBtn = h("button", { type: "button", class: "btn primary btn-block", disabled: true },
    "Выберите роль");

  function roleCard(role, title, bullets, disabledReason) {
    const card = h("button", {
      type: "button",
      class: "role-card",
      role: "radio",
      "aria-checked": "false",
      "data-role": role,
      disabled: Boolean(disabledReason)
    },
      h("span", { class: "role-card-title" }, title),
      h("ul", { class: "role-card-list" }, bullets.map(item => h("li", {}, item))),
      disabledReason ? h("span", { class: "role-card-note" }, disabledReason) : null
    );
    card.addEventListener("click", () => selectRole(role));
    cards.push(card);
    return card;
  }

  const cardsBox = h("div", {
    class: "role-cards", role: "radiogroup", "aria-label": "Как вы хотите войти?"
  },
    roleCard(ROLE_PLAYER, "Участник", [
      "Сами проходите вопросы теста",
      "Получаете баллы и место в общем рейтинге",
      "Ждёте старта — вопросы идут автоматически"
    ], staffObserverOnly ? "Преподаватель входит только наблюдателем" : ""),
    roleCard(ROLE_OBSERVER, "Наблюдатель", [
      "Видите общий рейтинг и ход теста",
      "Видите число участников и прогресс",
      "Отвечать и получать баллы нельзя"
    ])
  );

  function selectRole(role) {
    selectedRole = role;
    if (codeFromRoute || normalizeRoomCode(displayCodeInput.value)) {
      rememberRole(normalizeRoomCode(displayCodeInput.value) || codeFromRoute, role);
    }
    syncRoleUi();
  }

  function syncRoleUi() {
    cards.forEach(card => {
      const on = card.getAttribute("data-role") === selectedRole;
      card.classList.toggle("is-selected", on);
      card.setAttribute("aria-checked", String(on));
    });
    const observer = selectedRole === ROLE_OBSERVER;
    nameLabel.textContent = observer ? "Имя или ФИО (увидят в комнате)" : "ФИО";
    nameInput.placeholder = observer ? "Как вас показывать" : "Фамилия Имя Отчество";
    nameHint.textContent = !selectedRole ? ""
      : observer
        ? "Наблюдатель не отвечает на вопросы и не получает баллов."
        : profileName
          ? "ФИО подставлено из профиля — при необходимости исправьте."
          : "ФИО не указано в профиле — введите фамилию и имя.";
    joinBtn.disabled = !selectedRole;
    joinBtn.textContent = !selectedRole
      ? "Выберите роль"
      : observer ? "Войти наблюдателем" : "Войти участником";
  }

  // ---------- Гость: аватар ----------

  const avatarSelect = h("select", { id: "guest-avatar", "aria-label": "Аватар" },
    AVATAR_PRESETS.map(preset =>
      h("option", { value: `preset:${preset.id}` }, `${preset.emoji} ${preset.id}`)
    ));

  // ---------- Вход ----------

  joinBtn.addEventListener("click", async () => {
    setMessage("");
    const code = normalizeRoomCode(displayCodeInput.value);
    if (!code) {
      setMessage("Код комнаты — 6 символов, без 0, O, 1 и I.");
      displayCodeInput.focus();
      return;
    }
    if (!selectedRole) {
      setMessage("Выберите, как вы хотите войти: участником или наблюдателем.");
      return;
    }
    const role = selectedRole;
    const nameCheck = nameForJoin({
      typed: nameInput.value,
      profileName: guestMode ? "" : profileName,
      role
    });
    if (!nameCheck.ok) {
      setMessage(nameCheck.error);
      nameInput.focus();
      return;
    }

    joinBtn.disabled = true;
    joinBtn.textContent = "Подключаемся…";
    try {
      if (guestMode) {
        await signInAsGuest(code, nameCheck.value, avatarSelect.value, role);
      } else {
        const found = await getRoom(code);
        if (!found) { setMessage("Комната с таким кодом не найдена."); return; }
        if (found.status !== "active") { setMessage("Комната уже закрыта."); return; }
        const effective = resolveRequestedRole({
          requested: role, isStaffUser: isStaff(), isHost: found.hostId === State.user.uid
        });
        if (!isRegistrationOpen(found)) {
          // Вернувшийся участник входит и при закрытой регистрации
          // (joinRoom сам проверит, есть ли у него документ).
          const mine = await getMyRoomRole(code);
          if (!mine) { setMessage("Регистрация участников закрыта."); return; }
        }
        await joinRoom(code, {
          displayName: nameCheck.value,
          role: effective,
          profile: State.profile
        });
      }
      // Фактическая роль — из документа комнаты (она могла быть выбрана
      // раньше и не меняется при повторном входе).
      let finalRole = role;
      try { finalRole = (await getMyRoomRole(code)) || role; } catch { /* оставляем выбранную */ }
      rememberRole(code, finalRole);
      if (finalRole !== role) {
        toast(`Вы уже были в комнате как «${ROLE_LABEL[finalRole]}» — роль не меняется`, "info");
      } else {
        toast(`Вы вошли как «${ROLE_LABEL[finalRole]}»`, "success");
      }
      window.location.hash = `#room/${code}`;
    } catch (err) {
      console.error("Вход в комнату:", err);
      setMessage(errorBody(err));
    } finally {
      joinBtn.disabled = !selectedRole;
      syncRoleUi();
    }
  });

  // ---------- Сборка страницы ----------

  page.appendChild(hero());

  if (roomError) {
    page.append(h("div", { class: "panel panel-narrow" },
      h("div", { class: "panel-body" },
        h("p", { class: "form-error" }, roomError),
        h("a", { class: "btn secondary btn-block", href: "#join" }, "Ввести другой код"))));
    return page;
  }

  // Неавторизованный по QR: запоминаем приглашение для входа/регистрации;
  // гостевой вход (имя + аватар) доступен ниже.
  if (codeFromRoute && !State.user) {
    saveReturnTo(`#join/${codeFromRoute}`);
    page.append(
      h("div", { class: "panel panel-narrow" },
        h("div", { class: "panel-head" }, h("h2", {}, "Вы приглашены в Live-комнату")),
        h("div", { class: "panel-body" },
          h("p", { class: "muted" },
            `Комната ${codeFromRoute}. Войдите в аккаунт — или выберите роль ниже и войдите как гость.`),
          h("div", { class: "btn-row" },
            h("a", { class: "btn secondary", href: "#login" }, "Войти"),
            h("a", { class: "btn secondary", href: "#register" }, "Создать аккаунт")
          )
        )
      )
    );
  }

  page.append(
    h("div", { class: "panel panel-narrow" },
      h("div", { class: "panel-head" }, h("h2", {}, "Как вы хотите войти?")),
      h("div", { class: "panel-body" },
        h("div", { class: "field" },
          h("label", { for: "room-code-input" }, "Код комнаты"),
          displayCodeInput
        ),
        cardsBox,
        h("div", { class: "field" }, nameLabel, nameInput, nameHint),
        guestMode
          ? h("div", { class: "field" },
              h("label", { for: "guest-avatar" }, "Аватар"), avatarSelect)
          : null,
        joinBtn,
        message
      )
    )
  );
  syncRoleUi();
  if (!codeFromRoute) setTimeout(() => displayCodeInput.focus(), 50);
  return page;
}

function hero() {
  return h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Live-комната"),
      h("h1", {}, "Войти по коду"),
      h("p", { class: "page-sub" }, "Введите код из шести символов, который показал ведущий, или откройте ссылку из QR. Затем выберите роль. Код не содержит похожих символов 0, O, 1 и I.")
    )
  );
}
