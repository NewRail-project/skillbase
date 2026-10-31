import {
  auth, db, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, signInAnonymously, doc, getDoc, setDoc, updateDoc, serverTimestamp,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  linkWithCredential
} from "../shared/firebase.js";
import { applyThemeMode, getThemeMode } from "../shared/theme.js";
import {
  DEFAULT_UI,
  VALID_UI,
  normalizeProfileData,
  buildRegistrationProfile,
  buildPublicProfile,
  safeUi,
  validateFullName
} from "./registration.js";
import { DEFAULT_ORG_ID } from "../configs/organization.js";
import { isValidAvatarValue } from "../shared/avatars.js";
import { validateGuestName, saveGuestName, clearGuestName } from "./guest.js";

export { DEFAULT_UI } from "./registration.js";

// Состояние приложения.
//
// profileStatus:
//   "idle"       — авторизация ещё не инициализирована
//   "loading"    — пользователь есть, документ профиля читается
//   "ready"      — документ профиля загружен
//   "missing"    — пользователь авторизован, но документа в users/{uid} нет
//   "error"      — не удалось прочитать профиль (сеть / правила доступа)
//   "signed-out" — пользователь не авторизован
export const State = {
  user: null,
  profile: null,
  profileStatus: "idle",
  profileError: null,
  registering: false,
  listeners: [],
  // Флаг для отслеживания начальной загрузки профиля
  initialProfileLoad: false
};

export const DEFAULT_ORG = DEFAULT_ORG_ID;

export function subscribe(listener) {
  State.listeners.push(listener);
  listener(State.user, State.profile);
  return () => {
    State.listeners = State.listeners.filter(l => l !== listener);
  };
}

function notify() {
  State.listeners.forEach(l => {
    try {
      l(State.user, State.profile);
    } catch (e) {
      console.error("listener error:", e);
    }
  });
}

// Документ Firestore не содержит собственного id: uid нужно добавлять явно.
// Без этого profile.uid === undefined, и страница профиля считала профиль отсутствующим.
function normalizeProfile(data, user) {
  return normalizeProfileData(data, user);
}

function fallbackProfile(user) {
  return normalizeProfile({}, user);
}

export function applyTheme(uiName) {
  const ui = safeUi(uiName);
  document.documentElement.setAttribute("data-ui", ui);
  // data-ui — это "скин" интерфейса; светлота/темнота живёт в data-theme
  // и не должна сбрасываться при смене скина.
  applyThemeMode(getThemeMode());
}

let loadToken = 0;

async function loadProfile(user) {
  const token = ++loadToken;
  State.profileStatus = "loading";
  State.profileError = null;
  State.user = user;
  State.initialProfileLoad = true;

  try {
    const docSnap = await getDoc(doc(db, "users", user.uid));
    if (token !== loadToken) return;
    
    if (docSnap.exists()) {
      State.profile = normalizeProfile(docSnap.data(), user);
      State.profileStatus = "ready";
      // Аватар и публичное имя хранятся отдельно (publicProfiles):
      // правило users не разрешает поле avatar. Ошибку чтения игнорируем —
      // без аватара профиль остаётся рабочим.
      let publicName = null;
      try {
        const pub = await getDoc(doc(db, "publicProfiles", user.uid));
        if (token !== loadToken) return;
        if (pub.exists()) {
          const pubData = pub.data();
          if (pubData.avatar) State.profile.avatar = pubData.avatar;
          if (pubData.displayName) {
            State.profile.publicDisplayName = pubData.displayName;
            publicName = pubData.displayName;
          }
        }
      } catch (pubErr) {
        if (pubErr.code !== "permission-denied") {
          console.warn("Публичный профиль недоступен:", pubErr);
        }
      }

      // Старые аккаунты могли не иметь publicProfiles или отставать от
      // users.fullName. Догружаем имя, чтобы оно было в журнале и проверке.
      const fullName = String(State.profile.fullName || "").trim();
      if (fullName && publicName !== fullName) {
        void writePublicProfile(user.uid, { fullName, orgId: State.profile.orgId });
      }
    } else {
      // Документа нет. Самовольно создавать его нельзя: правила Firestore
      // требуют fullName, а роль и организацию назначает администратор.
      // Страница профиля предложит пользователю заполнить ФИО.
      State.profile = fallbackProfile(user);
      State.profileStatus = "missing";
    }
  } catch (e) {
    if (token !== loadToken) return;
    console.error("Ошибка загрузки профиля:", e);
    State.profile = fallbackProfile(user);
    State.profileStatus = "error";
    State.profileError = e && e.code === "permission-denied"
      ? "Нет доступа к данным профиля."
      : "Не удалось загрузить профиль. Проверьте подключение к сети.";
  }

  // Apply theme if profile exists, otherwise use default
  if (State.profile?.ui) {
    applyTheme(State.profile.ui);
  }
  State.initialProfileLoad = false;
  notify();
}

export async function initAuth() {
  State.initialProfileLoad = true;
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    onAuthStateChanged(auth, async (user) => {
      const first = !resolved;
      State.user = user;

      if (!user) {
        loadToken++;
        State.profile = null;
        State.profileStatus = "signed-out";
        State.profileError = null;
        applyTheme(DEFAULT_UI);
        State.initialProfileLoad = false;
        if (!first) notify();
        finish(null);
        return;
      }

      // На первом запуске ждём профиль до resolve, чтобы роутер не успел
      // увести авторизованного пользователя обратно на #login.
      if (first) {
        await loadProfile(user);
        finish(user);
      } else {
        // При повторной авторизации ждем загрузки профиля,
        // чтобы роутер не сработал преждевременно
        await loadProfile(user);
      }
    });
  });
}

// Повторная загрузка профиля (кнопка «Повторить» при сетевой ошибке).
export async function refreshProfile() {
  if (!State.user) return null;
  State.initialProfileLoad = true;
  try {
    await loadProfile(State.user);
    return State.profile;
  } catch (e) {
    console.error("Ошибка при повторной загрузке профиля:", e);
    State.profileStatus = "error";
    State.profileError = e && e.code === "permission-denied"
      ? "Нет доступа к данным профиля."
      : "Не удалось загрузить профиль. Проверьте подключение к сети.";
    notify();
    return null;
  } finally {
    State.initialProfileLoad = false;
  }
}

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  // Загружаем профиль до возврата управления: иначе переход на #profile
  // срабатывает раньше, чем State.user/profile заполнены.
  await loadProfile(cred.user);
  return cred.user;
}

// ---------- Вход через Google ----------

// Имя и фото Google находятся в Firebase Authentication (user.displayName,
// user.photoURL, metadata.lastSignInTime) и переживают перезагрузку страницы.
// Firestore их не хранит: правило users create зафиксировано строгим
// hasOnly-списком, а расширять его ради копии данных, уже живущих в Auth,
// не требуется — параллельная система профилей не создаётся.

// Вход через Google одним потоком. Конфликт email (адрес уже занят
// password-аккаунтом) НЕ ошибка: возвращаем needsLink, чтобы страница
// входа предложила связать провайдеры без дубликата пользователя.
export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(auth, provider);
    await loadProfile(result.user);
    return { user: result.user };
  } catch (err) {
    if (err?.code === "auth/account-exists-with-different-credential") {
      const credential = err?.credential
        || GoogleAuthProvider.credentialFromError?.(err)
        || null;
      return {
        needsLink: true,
        email: err?.customData?.email || err?.credential?.email || credential?.email || "",
        credential
      };
    }
    // Окно Google заблокировано браузером или расширением — переключаемся
    // на redirect: надёжнее на мобильных. Возвращение обрабатывает
    // finishGoogleRedirect после перезагрузки страницы.
    if (err?.code === "auth/popup-blocked") {
      await signInWithRedirect(auth, provider);
      return { redirected: true };
    }
    throw err;
  }
}

// Обработка возврата с redirect-экрана Google (после reload страницы входа).
// null — обычный визит без redirect; прочие результаты как у loginWithGoogle.
export async function finishGoogleRedirect() {
  let result = null;
  try {
    result = await getRedirectResult(auth);
  } catch (err) {
    if (err?.code === "auth/account-exists-with-different-credential") {
      const credential = err?.credential
        || GoogleAuthProvider.credentialFromError?.(err)
        || null;
      return {
        needsLink: true,
        email: err?.customData?.email || err?.credential?.email || credential?.email || "",
        credential
      };
    }
    throw err;
  }
  if (result?.user) {
    await loadProfile(result.user);
    return { user: result.user };
  }
  return null;
}

// Связывание Google с существующим password-аккаунтом того же email:
// вход по паролю даёт прежний uid, linkWithCredential добавляет Google.
// Документ users/{uid} не изменяется — профиль, тесты и результаты остаются.
export async function linkGoogleAfterPasswordLogin(email, password, pendingCredential) {
  if (!pendingCredential) throw new Error("Приглашение Google не активно. Повторите вход через Google.");
  const cred = await signInWithEmailAndPassword(auth, email, password);
  try {
    if (!cred.user.providerData.some(p => p.providerId === "google.com")) {
      await linkWithCredential(cred.user, pendingCredential);
    }
  } catch (err) {
    // Google уже связан (или конфликт) — вход всё равно выполнен: не роняем.
    if (err?.code !== "auth/credential-already-in-use") throw err;
  }
  await loadProfile(cred.user);
  return cred.user;
}

// Публичный профиль нужен, чтобы ФИО видели журнал, проверка и списки.
// Ошибка записи не должна отменять регистрацию: профиль users уже создан.
async function writePublicProfile(uid, { fullName, orgId }) {
  try {
    await setDoc(doc(db, "publicProfiles", uid), {
      ...buildPublicProfile({ fullName, orgId }),
      updatedAt: serverTimestamp()
    }, { merge: true });
    return true;
  } catch (e) {
    if (e.code !== "permission-denied") {
      console.warn("Публичный профиль не сохранён:", e);
    }
    return false;
  }
}

// Регистрация: email, пароль и ФИО. Роль всегда student, организация и
// группа — из configs/organization.js. Клиент не может их переопределить.
export async function register({ email, password, fullName, position, department, ui } = {}) {
  const profileData = buildRegistrationProfile({
    email, fullName, position, department, ui
  });

  State.registering = true;
  let cred = null;
  try {
    cred = await createUserWithEmailAndPassword(auth, profileData.email, password);
    await setDoc(doc(db, "users", cred.user.uid), {
      ...profileData,
      createdAt: serverTimestamp()
    });
    await writePublicProfile(cred.user.uid, {
      fullName: profileData.fullName,
      orgId: profileData.orgId
    });

    State.user = cred.user;
    State.profile = normalizeProfile(profileData, cred.user);
    State.profile.publicDisplayName = profileData.fullName;
    State.profileStatus = "ready";
    State.profileError = null;
    applyTheme(State.profile.ui);
    notify();
    return cred.user;
  } catch (e) {
    // Если аккаунт уже создан, но профиль записать не удалось, не оставляем
    // пользователя в подвешенном состоянии без объяснения.
    if (cred && cred.user) {
      console.error("Аккаунт создан, профиль не сохранён:", e);
      State.user = cred.user;
      State.profile = fallbackProfile(cred.user);
      State.profileStatus = "error";
      State.profileError = e && e.code === "permission-denied"
        ? "Аккаунт создан, но профиль не сохранился: нет доступа."
        : "Аккаунт создан, но профиль не сохранился.";
      notify();
    }
    throw e;
  } finally {
    State.registering = false;
  }
}

// Вход анонимного гостя в комнату: имя и аватар вместо регистрации.
export async function signInAsGuest(roomId, displayName, avatarId) {
  // Данные проверяем ДО входа: не плодим анонимные аккаунты
  // из-за ошибок валидации.
  const nameCheck = validateFullName(displayName);
  if (!nameCheck.ok) throw new Error(nameCheck.error);
  if (!isValidAvatarValue(avatarId)) throw new Error("Некорректный аватар.");

  // Анонимная аутентификация Firebase. Требует включённого провайдера
  // Anonymous в Firebase Console (Authentication → Sign-in method).
  await signInAnonymously(auth);
  const user = auth.currentUser;
  if (!user?.uid) throw new Error("Не удалось войти как гость.");
  // Ждём загрузку профиля явно: иначе переход на #room может случиться
  // раньше, чем onAuthStateChanged заполнит State.user — и роутер
  // увёл бы гостя на #login.
  await loadProfile(user);

  // Комната должна существовать и быть активной. Документ комнаты не
  // содержит вопросов и ключей ответов, поэтому чтение безопасно.
  const roomRef = doc(db, "rooms", roomId);
  const roomSnap = await getDoc(roomRef);
  if (!roomSnap.exists() || roomSnap.data().status !== "active") {
    throw new Error("Комната не найдена или неактивна.");
  }

  // Создаём документ участника.
  await joinRoomAsGuest(roomId, nameCheck.value, avatarId);
}

// Добавление гостя в комнату. Повторный вход (восстановление страницы,
// повторное сканирование QR) не отклоняется: существующий документ
// обновляется по правилам update (имя, аватар, updatedAt — без joinedAt
// и без смены роли observer).
export async function joinRoomAsGuest(roomId, displayName, avatarId) {
  // Валидация данных.
  const nameCheck = validateFullName(displayName);
  if (!nameCheck.ok) throw new Error(nameCheck.error);
  if (!isValidAvatarValue(avatarId)) throw new Error("Некорректный аватар.");
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Нужно войти как гость.");

  // Свой документ читать можно (правила: request.auth.uid == playerId).
  const playerRef = doc(db, "rooms", roomId, "players", uid);
  const playerSnap = await getDoc(playerRef);
  const existing = playerSnap.exists() ? playerSnap.data() : null;

  // Создание документа участника для гостя. Аватар — только пресет
  // (isValidAvatarValue), ключи документа ограничены правилом.
  // Повторный вход: joinedAt и observer не переписываются — правила
  // запрещают их менять, а роль гостя всегда «участник».
  const playerData = existing
    ? {
        uid,
        playerId: uid,
        name: nameCheck.value,
        avatar: avatarId,
        updatedAt: serverTimestamp()
      }
    : {
        uid,
        playerId: uid,
        name: nameCheck.value,
        avatar: avatarId,
        observer: false,
        joinedAt: serverTimestamp()
      };
  await setDoc(playerRef, playerData, { merge: true });
}

// Гостевой вход для прохождения теста по прямой ссылке.
//
// Не создаёт полноценный аккаунт: используется анонимная аутентификация
// Firebase (как в Live-комнатах) — без email и пароля. Анонимная сессия
// переживает обновление страницы (SDK хранит её в localStorage), поэтому
// случайное обновление не сбрасывает гостя и не создаёт вторую попытку.
// ФИО проверяется и сохраняется ДО входа: не плодим анонимные аккаунты
// из-за ошибок валидации.
export async function signInGuestForTest(fullName) {
  const nameCheck = validateGuestName(fullName);
  if (!nameCheck.ok) throw new Error(nameCheck.error);

  if (State.user && State.user.isAnonymous !== true) {
    throw new Error("Вы уже вошли в аккаунт. Чтобы пройти тест гостем, выйдите из аккаунта.");
  }

  if (!State.user) {
    // Требует включённого провайдера Anonymous в Firebase Console.
    await signInAnonymously(auth);
  }
  const user = auth.currentUser;
  if (!user?.uid) throw new Error("Не удалось войти как гость.");

  // Ждём загрузку профиля: для гостя документ users/{uid} отсутствует —
  // loadProfile зафиксирует status "missing", и роутер не уведёт на #login.
  await loadProfile(user);

  saveGuestName(nameCheck.value);
  return user;
}

export async function logout() {
  await signOut(auth);
  // С гостевой сессией заканчивается и её ФИО: следующий гость на этом
  // устройстве вводит своё имя, а не наследует чужое.
  clearGuestName();
  loadToken++;
  State.user = null;
  State.profile = null;
  State.profileStatus = "signed-out";
  State.profileError = null;
  applyTheme(DEFAULT_UI);
  notify();
}

// С клиента меняется только тема/скин и личные поля. Роль и организацию
// правила Firestore менять не дают.
export async function getProfile(uid) {
  try {
    const docSnap = await getDoc(doc(db, "users", uid));
    return docSnap.exists() ? docSnap.data() : null;
  } catch (e) {
    console.error("getProfile error:", e);
    return null;
  }
}

export function isStaff() {
  return State.profile?.role === "teacher" || State.profile?.role === "admin";
}

export function isAdmin() {
  return State.profile?.role === "admin";
}

// Создание собственного профиля, если документа нет (старый аккаунт).
// Набор полей повторяет правило create в firestore.rules.
export async function createOwnProfile({ fullName, ui, position, department } = {}) {
  if (!State.user) throw new Error("Нужно войти в аккаунт.");
  const profileData = buildRegistrationProfile({
    email: State.user.email || "",
    fullName,
    position,
    department,
    ui
  });
  const uid = State.user.uid;
  await setDoc(doc(db, "users", uid), {
    ...profileData,
    createdAt: serverTimestamp()
  });
  await writePublicProfile(uid, {
    fullName: profileData.fullName,
    orgId: profileData.orgId
  });
  await loadProfile(State.user);
  return State.profile;
}

// Обновление разрешённых правилами полей профиля.
export async function saveOwnProfile(patch = {}) {
  if (!State.user) throw new Error("Нужно войти в аккаунт.");
  const allowed = ["fullName", "position", "department", "ui", "themeMode"];
  const clean = {};
  for (const key of allowed) {
    if (patch[key] !== undefined) clean[key] = patch[key];
  }
  if (clean.fullName !== undefined) {
    const check = validateFullName(clean.fullName);
    if (!check.ok) throw new Error(check.error);
    clean.fullName = check.value;
  }
  if (clean.ui !== undefined && !VALID_UI.includes(clean.ui)) delete clean.ui;
  if (!Object.keys(clean).length) return State.profile;

  await updateDoc(doc(db, "users", State.user.uid), clean);
  State.profile = { ...State.profile, ...clean };
  if (clean.fullName) {
    // Имя в журнале и на экране проверки берётся из publicProfiles.
    State.profile.publicDisplayName = clean.fullName;
    await writePublicProfile(State.user.uid, {
      fullName: clean.fullName,
      orgId: State.profile.orgId
    });
  }
  if (clean.ui) applyTheme(clean.ui);
  notify();
  return State.profile;
}
