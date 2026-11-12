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
  deleteDoc, onSnapshot, runTransaction, writeBatch, limit, startAfter, Timestamp, increment, arrayUnion, arrayRemove, documentId
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { firebaseConfig } from '../configs/firebase.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Автоопределение транспорта: если WebChannel/стриминг блокируется сетью,
// провайдером или прокси, Firestore переключается на long polling. Без этого
// записи (setDoc, batch.commit) и подписки молча висят — «бесконечная загрузка».
let _db;
try {
  _db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
} catch (_) {
  _db = getFirestore(app);
}
export const db = _db;

// Единая точка входа в Firebase: остальные модули берут функции отсюда.
export {
  initializeApp, getAuth, getFirestore, initializeFirestore,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, signInAnonymously,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  linkWithCredential, fetchSignInMethodsForEmail,
  doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where, orderBy, getDocs, serverTimestamp,
  deleteDoc, onSnapshot, runTransaction, writeBatch, limit, startAfter, Timestamp, increment, arrayUnion, arrayRemove, documentId
};
