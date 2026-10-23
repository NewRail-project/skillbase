import {
  auth, db, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, doc, getDoc, setDoc, updateDoc, serverTimestamp
} from "../shared/firebase.js";
import { applyThemeMode, getThemeMode } from "../shared/theme.js";

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
  listeners: []
};

export const DEFAULT_ORG = "default-org";
export const DEFAULT_UI = "education";
const VALID_UI = ["education", "operations", "depot"];

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
  const src = data || {};
  return {
    ...src,
    uid: user.uid,
    email: src.email || user.email || "",
    role: src.role || "student",
    orgId: src.orgId || DEFAULT_ORG,
    ui: VALID_UI.includes(src.ui) ? src.ui : DEFAULT_UI
  };
}

function fallbackProfile(user) {
  return normalizeProfile({}, user);
}

export function applyTheme(uiName) {
  const ui = VALID_UI.includes(uiName) ? uiName : DEFAULT_UI;
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

  try {
    const docSnap = await getDoc(doc(db, "users", user.uid));
    if (token !== loadToken) return;
    if (docSnap.exists()) {
      State.profile = normalizeProfile(docSnap.data(), user);
      State.profileStatus = "ready";
      // Аватар и публичное имя хранятся отдельно (publicProfiles):
      // правило users не разрешает поле avatar. Ошибку чтения игнорируем —
      // без аватара профиль остаётся рабочим.
      try {
        const pub = await getDoc(doc(db, "publicProfiles", user.uid));
        if (token !== loadToken) return;
        if (pub.exists()) {
          const pubData = pub.data();
          if (pubData.avatar) State.profile.avatar = pubData.avatar;
          if (pubData.displayName) State.profile.publicDisplayName = pubData.displayName;
        }
      } catch (pubErr) {
        console.warn("Публичный профиль недоступен:", pubErr);
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

  applyTheme(State.profile.ui);
  notify();
}

export async function initAuth() {
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
        loadProfile(user);
      }
    });
  });
}

// Повторная загрузка профиля (кнопка «Повторить» при сетевой ошибке).
export async function refreshProfile() {
  if (!State.user) return null;
  await loadProfile(State.user);
  return State.profile;
}

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  // Загружаем профиль до возврата управления: иначе переход на #profile
  // срабатывает раньше, чем State.user/profile заполнены.
  await loadProfile(cred.user);
  return cred.user;
}

// Роль и организация при регистрации всегда одни и те же: их выдаёт только администратор.
// fullName обязателен — этого требует правило create для users/{uid}.
export async function register(email, password, fullName, ui = DEFAULT_UI) {
  const name = String(fullName || "").trim();
  if (name.length < 2 || name.length > 120) {
    throw new Error("Укажите ФИО (от 2 до 120 символов).");
  }

  State.registering = true;
  let cred = null;
  try {
    cred = await createUserWithEmailAndPassword(auth, email, password);
    const profileData = {
      email,
      role: "student",
      orgId: DEFAULT_ORG,
      fullName: name,
      ui: VALID_UI.includes(ui) ? ui : DEFAULT_UI,
      createdAt: serverTimestamp()
    };
    await setDoc(doc(db, "users", cred.user.uid), profileData);

    State.user = cred.user;
    State.profile = normalizeProfile(profileData, cred.user);
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

// Создание собственного профиля, если документа нет.
// Набор полей повторяет правило create в firestore.rules.
export async function createOwnProfile({ fullName, ui }) {
  if (!State.user) throw new Error("Нужно войти в аккаунт.");
  const name = String(fullName || "").trim();
  if (name.length < 2 || name.length > 120) {
    throw new Error("Укажите ФИО (от 2 до 120 символов).");
  }
  const uid = State.user.uid;
  await setDoc(doc(db, "users", uid), {
    email: State.user.email || "",
    role: "student",
    orgId: DEFAULT_ORG,
    fullName: name,
    ui: VALID_UI.includes(ui) ? ui : DEFAULT_UI,
    createdAt: serverTimestamp()
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
    clean.fullName = String(clean.fullName).trim();
    if (clean.fullName.length < 2 || clean.fullName.length > 120) {
      throw new Error("Укажите ФИО (от 2 до 120 символов).");
    }
  }
  if (clean.ui !== undefined && !VALID_UI.includes(clean.ui)) delete clean.ui;
  if (!Object.keys(clean).length) return State.profile;

  await updateDoc(doc(db, "users", State.user.uid), clean);
  State.profile = { ...State.profile, ...clean };
  if (clean.ui) applyTheme(clean.ui);
  notify();
  return State.profile;
}
