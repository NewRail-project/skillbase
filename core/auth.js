import {
  auth, db, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, doc, getDoc, setDoc, updateDoc, serverTimestamp
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

export async function logout() {
  await signOut(auth);
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

export function isAdmin() {
  return State.profile?.role === "admin";
}
