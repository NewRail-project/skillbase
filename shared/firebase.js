import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, signInAnonymously,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  linkWithCredential, fetchSignInMethodsForEmail
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import {
  getFirestore, initializeFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection,
  query, where, orderBy, getDocs, serverTimestamp,
  deleteDoc, onSnapshot, runTransaction, writeBatch, limit, startAfter, Timestamp, increment, arrayUnion, arrayRemove, documentId,
  getCountFromServer,
  persistentLocalCache, persistentMultipleTabManager, clearIndexedDbPersistence
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { firebaseConfig } from '../configs/firebase.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Автоопределение транспорта: если WebChannel/стриминг блокируется сетью,
// провайдером или прокси, Firestore переключается на long polling. Без этого
// записи (setDoc, batch.commit) и подписки молча висят — «бесконечная загрузка».
//
// experimentalForceLongPolling НЕ включаем принудительно: он снижает скорость
// в обычных сетях. Автоопределение само выбирает транспорт.
//
// Локальный кэш (persistentLocalCache): документы, прочитанные приложением,
// сохраняются в IndexedDB. Повторный запуск и навигация отдают данные
// мгновенно, а Firestore догружает только изменения. Мульти-табовый менеджер
// разрешает несколько вкладок без «Multiple tabs» ошибок.
let _db;
try {
  _db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (_) {
  _db = getFirestore(app);
}
export const db = _db;

// Очистка локального кэша Firestore. Вызывается при выходе из аккаунта:
// кэш общий на всё приложение (не на пользователя), и приватные документы
// предыдущего пользователя (попытки, профиль) не должны оставаться на диске.
// Требует отсутствия активных подписок — поэтому вызывается после signOut,
// когда страницы уже отключили свои onSnapshot. Ошибка не критична:
// кэш не служит источником данных, а только ускорением.
export async function clearLocalFirestoreCache() {
  try {
    await clearIndexedDbPersistence(db);
    return true;
  } catch (e) {
    console.warn("Локальный кэш Firestore не очищен:", e?.code || e);
    return false;
  }
}

// Единая точка входа в Firebase: остальные модули берут функции отсюда.
export {
  initializeApp, getAuth, getFirestore, initializeFirestore,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, signInAnonymously,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  linkWithCredential, fetchSignInMethodsForEmail,
  doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where, orderBy, getDocs, serverTimestamp,
  deleteDoc, onSnapshot, runTransaction, writeBatch, limit, startAfter, Timestamp, increment, arrayUnion, arrayRemove, documentId,
  getCountFromServer
};
