import { auth, db, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  onAuthStateChanged, doc, getDoc, setDoc, updateDoc } from "../shared/firebase.js";

export const State = { user: null, profile: null, listeners: [] };

// Во время регистрации профиль создаёт register(), а не слушатель (иначе гонка записей)
let registering = false;

export function subscribe(listener) {
  State.listeners.push(listener);
  return () => { State.listeners = State.listeners.filter(l => l !== listener); };
}

function notify() {
  State.listeners.forEach(l => l(State.user, State.profile));
}

const defaultProfile = (email) => ({ email, role: "student", orgId: "default-org", ui: "education" });

async function loadProfile(user) {
  const ref = doc(db, "users", user.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data();
    const profile = defaultProfile(user.email);
    await setDoc(ref, { ...profile, createdAt: new Date().toISOString() });
    return profile;
  } catch (e) {
    console.error("Ошибка загрузки профиля:", e);
    return defaultProfile(user.email);
  }
}

export function initAuth() {
  return new Promise((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };
    // Если Firebase недоступен — не вешаем интерфейс навсегда
    setTimeout(done, 8000);

    onAuthStateChanged(auth, async (user) => {
      State.user = user;
      if (user) {
        if (!registering) State.profile = await loadProfile(user);
        applyTheme(State.profile?.ui);
      } else {
        State.profile = null;
        applyTheme("education");
      }
      notify();
      done();
    });
  });
}

export function applyTheme(uiName) {
  const validUIs = ["education", "operations", "depot"];
  document.documentElement.setAttribute("data-ui", validUIs.includes(uiName) ? uiName : "education");
}

export async function login(email, password) {
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  State.user = user;
  State.profile = await loadProfile(user);
  applyTheme(State.profile.ui);
  notify();
  return user;
}

export async function register(email, password, ui = "education") {
  registering = true;
  try {
    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    // Роль и организацию клиент выбрать не может — это проверяют firestore.rules
    const profile = { email, role: "student", orgId: "default-org", ui, createdAt: new Date().toISOString() };
    await setDoc(doc(db, "users", user.uid), profile);
    State.user = user;
    State.profile = profile;
    applyTheme(ui);
    notify();
    return user;
  } finally {
    registering = false;
  }
}

export async function logout() {
  await signOut(auth);
  State.user = null;
  State.profile = null;
  applyTheme("education");
  notify();
}

// Пользователь может менять только тему (ui). Роль меняет админ на странице «Пользователи».
export async function updateProfileData(newData) {
  if (!State.user) return;
  await updateDoc(doc(db, "users", State.user.uid), newData);
  State.profile = { ...State.profile, ...newData };
  if (newData.ui) applyTheme(newData.ui);
  notify();
}

export const isStaff = () => ["teacher", "admin"].includes(State.profile?.role);
