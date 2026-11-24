// Заглушка shared/firebase.js: боевой модуль тянет SDK по https-импортам,
// в Node он не подключается. Экспортируется только то, что просят страницы;
// значения-заглушки намеренно падают при вызове — страница обязана работать
// через слои-заглушки (core/*), а не через прямой запрос из UI.
// Вызовы записи считаются в globalThis.__FS_WRITES: тест может убедиться, что
// страница ничего не пишет в Firestore (ожидается пустой список).
const WRITE_NAMES = new Set(["setDoc", "updateDoc", "addDoc", "deleteDoc", "runTransaction", "writeBatch"]);
// Тест может подставить рабочую реализацию функции через globalThis.__FB[name]
// (например, Firestore в памяти): тогда вызов идёт в неё, а не падает.
function unavailable(name) {
  return (...args) => {
    const hook = globalThis.__FB?.[name];
    if (hook) return hook(...args);
    if (WRITE_NAMES.has(name)) (globalThis.__FS_WRITES ||= []).push(name);
    throw new Error(`shared/firebase.js: ${name} недоступен в тесте`);
  };
}

export const db = { __test: true };
export const getDocs = unavailable("getDocs");
export const getDoc = unavailable("getDoc");
export const setDoc = unavailable("setDoc");
export const updateDoc = unavailable("updateDoc");
export const addDoc = unavailable("addDoc");
export const deleteDoc = unavailable("deleteDoc");
export const onSnapshot = unavailable("onSnapshot");
export const runTransaction = unavailable("runTransaction");
export const writeBatch = unavailable("writeBatch");
export const getCountFromServer = unavailable("getCountFromServer");
export const query = (...args) => args;
export const collection = (...args) => (globalThis.__FB?.collection ? globalThis.__FB.collection(...args) : args);
export const where = (...args) => ({ __where: args });
export const orderBy = (...args) => ({ __orderBy: args });
export const limit = (...args) => ({ __limit: args });
export const doc = (...args) => (globalThis.__FB?.doc ? globalThis.__FB.doc(...args) : args);
export const serverTimestamp = () => (globalThis.__FB?.serverTimestamp ? globalThis.__FB.serverTimestamp() : null);
export const Timestamp = { now: () => 0 };
export const increment = v => v;
export const arrayUnion = (...v) => v;
export const arrayRemove = (...v) => v;
export const documentId = () => "__name__";
export const getAuth = () => ({ currentUser: null });
export const onAuthStateChanged = () => () => {};
export const signOut = unavailable("signOut");
export const signInWithEmailAndPassword = unavailable("signInWithEmailAndPassword");
export const createUserWithEmailAndPassword = unavailable("createUserWithEmailAndPassword");
export const signInAnonymously = unavailable("signInAnonymously");
export const GoogleAuthProvider = class {};
export const signInWithPopup = unavailable("signInWithPopup");
export const signInWithRedirect = unavailable("signInWithRedirect");
export const getRedirectResult = unavailable("getRedirectResult");
export const linkWithCredential = unavailable("linkWithCredential");
export const fetchSignInMethodsForEmail = unavailable("fetchSignInMethodsForEmail");
export const sendPasswordResetEmail = unavailable("sendPasswordResetEmail");
export const initializeApp = () => ({});
export const getFirestore = () => db;
export const initializeFirestore = () => db;
