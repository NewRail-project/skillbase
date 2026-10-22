import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js'
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js'
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js'

// Проверка наличия и корректности конфигурации Firebase
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Инициализация Firebase App
const app = initializeApp(firebaseConfig);

// Импортируем Auth и Firestore
export const auth = getAuth(app);
export const db = getFirestore(app);

// Проверка состояния сети и обработка ошибок
export async function checkAuthState() {
  try {
    const user = await getCurrentUser();
    return user;
  } catch (error) {
    console.error("Ошибка проверки состояния аутентификации:", error);
    throw error;
  }
}

// Проверка текущего пользователя
export async function getCurrentUser() {
  const user = await onAuthStateChanged(auth, (user) => user);
  return user;
}