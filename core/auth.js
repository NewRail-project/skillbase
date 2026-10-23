import {
  auth, db, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, doc, getDoc, setDoc, updateDoc
} from "../shared/firebase.js";

export const State = {
  user: null,
  profile: null,
  registering: false,   // true, пока регистрация сама пишет профиль
  listeners: []
};

export function subscribe(listener) {
  State.listeners.push(listener);
  listener(State.user, State.profile);
  return () => {
    State.listeners = State.listeners.filter(l => l !== listener);
  };
}

function notify() {
  State.listeners.forEach(l => l(State.user, State.profile));
}

const DEFAULT_PROFILE = (email, ui = "education") =>
  ({ email, role: "student", orgId: "default-org", ui });

export async function initAuth() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      State.user = user;
      if (user) {
        try {
          const docRef = doc(db, "users", user.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            State.profile = docSnap.data();
          } else {
            State.profile = DEFAULT_PROFILE(user.email);
            if (!State.registering) await setDoc(docRef, State.profile);
          }
        } catch (e) {
          console.error("Ошибка загрузки профиля:", e);
          State.profile = DEFAULT_PROFILE(user.email);
        }
        applyTheme(State.profile.ui);
      } else {
        State.profile = null;
        applyTheme("education");
      }
      notify();
      resolve(user);
    });
  });
}

export function applyTheme(uiName) {
  const validUIs = ["education", "operations", "depot"];
  const theme = validUIs.includes(uiName) ? uiName : "education";
  document.documentElement.setAttribute("data-ui", theme);
}

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

// Роль и организация при регистрации всегда одни и те же: их выдаёт только администратор.
export async function register(email, password, _role, _orgId, ui = "education") {
  State.registering = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const profileData = {
      email,
      role: "student",
      orgId: "default-org",
      ui,
      createdAt: new Date().toISOString()
    };
    await setDoc(doc(db, "users", cred.user.uid), profileData);
    State.profile = profileData;
    applyTheme(ui);
    notify();
    return cred.user;
  } finally {
    State.registering = false;
  }
}

export async function logout() {
  await signOut(auth);
  State.user = null;
  State.profile = null;
  applyTheme("education");
  notify();
}

// С клиента меняется только тема. Роль и организацию правила Firestore менять не дают.
export async function updateProfileData(newData) {
  if (!State.user) return;
  const patch = {};
  if (newData && newData.ui) patch.ui = newData.ui;
  if (!patch.ui) return;
  await updateDoc(doc(db, "users", State.user.uid), patch);
  State.profile = { ...State.profile, ...patch };
  applyTheme(patch.ui);
  notify();
}
