import { auth, db, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, doc, getDoc, setDoc, updateDoc } from "../shared/firebase.js";

export const State = {
  user: null,
  profile: null,
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

export function initAuth() {
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
            // Default profile if missing
            State.profile = {
              email: user.email,
              role: "student",
              orgId: "default-org",
              ui: "education"
            };
            await setDoc(docRef, State.profile);
          }
        } catch (e) {
          console.error("Error fetching user profile:", e);
          State.profile = { email: user.email, role: "student", orgId: "default-org", ui: "education" };
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

export async function register(email, password, role = "student", orgId = "default-org", ui = "education") {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const user = cred.user;
  const profileData = {
    email,
    role,
    orgId,
    ui,
    createdAt: new Date().toISOString()
  };
  await setDoc(doc(db, "users", user.uid), profileData);
  State.profile = profileData;
  applyTheme(ui);
  notify();
  return user;
}

export async function logout() {
  await signOut(auth);
  State.user = null;
  State.profile = null;
  applyTheme("education");
  notify();
}

export async function updateProfileData(newData) {
  if (!State.user) return;
  const docRef = doc(db, "users", State.user.uid);
  await updateDoc(docRef, newData);
  State.profile = { ...State.profile, ...newData };
  if (newData.ui) {
    applyTheme(newData.ui);
  }
  notify();
}
