import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, signInAnonymously
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection,
  query, where, orderBy, getDocs, serverTimestamp,
  deleteDoc, onSnapshot, runTransaction, writeBatch, limit, startAfter, Timestamp, increment, arrayUnion, arrayRemove, documentId
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { firebaseConfig } from '../configs/firebase.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Единая точка входа в Firebase: остальные модули берут функции отсюда.
export {
  initializeApp, getAuth, getFirestore,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, signInAnonymously,
  doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where, orderBy, getDocs, serverTimestamp,
  deleteDoc, onSnapshot, runTransaction, writeBatch, limit, startAfter, Timestamp, increment, arrayUnion, arrayRemove, documentId
};
