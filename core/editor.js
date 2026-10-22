import { db } from "../shared/firebase.js";
import { parseQuiz } from "./import/parser.js";

// Объект для хранения текущего состояния редактирования теста
let currentTest = {
  id: null,
  questions: [],
  timePerQuestion: 10,
  attempts: 3,
  shuffleOptions: true,
  shuffleQuestions: true,
  status: 'draft',
  testKeys: [],
};

// Хранение тестов в Firestore
const testRef = db.collection('tests');
const testKeysRef = db.collection('testKeys');
const versionsRef = db.collection('tests').collection('versions');

// Сохраняет текущий тест в Firestore
export async function saveTest(testId) {
  try {
    if (!navigator.onLine) {
      throw new Error('Нет подключения к интернету. Данные будут сохранены локально.');
    }
    const testDoc = testRef.doc(testId);
    await testDoc.set(currentTest, { merge: true });

    const testKeysDoc = testKeysRef.doc(testId);
    await testKeysDoc.set(currentTest.testKeys);
  } catch (error) {
    console.error('Ошибка сохранения теста:', error);
    if (error.message.includes('Нет подключения к интернету')) {
      localStorage.setItem(`test_${testId}`, JSON.stringify(currentTest));
    }
    throw error;
  }
}

export async function parseQuizText(quizText) {
  try {
    const result = parseQuiz(quizText);
    return result;
  } catch (error) {
    console.error('Ошибка разбора теста:', error);
    throw new Error('Ошибка разбора теста. Пожалуйста, проверьте формат.');
  }
}

export function getCurrentTest() {
  return { ...currentTest };
}

export function updateTest(updates) {
  Object.assign(currentTest, updates);
  localStorage.setItem(`test_${currentTest.id}`, JSON.stringify(currentTest));
}

export async function publishTest(testId) {
  try {
    if (!navigator.onLine) {
      throw new Error('Нет подключения к интернету. Публикация невозможна.');
    }
    const versionDoc = await versionsRef.doc(testId).collection('versions').add({
      ...currentTest,
      createdAt: new Date().toISOString(),
      status: 'published',
    });

    await testRef.doc(testId).update({
      status: 'published',
    });

    return versionDoc.id;
  } catch (error) {
    console.error('Ошибка публикации теста:', error);
    throw error;
  }
}

export async function loadTest(testId) {
  try {
    if (!navigator.onLine) {
      const localData = localStorage.getItem(`test_${testId}`);
      if (localData) {
        return JSON.parse(localData);
      }
      throw new Error('Нет подключения к интернету. Данные недоступны.');
    }

    const testDoc = await testRef.doc(testId).get();
    if (!testDoc.exists) return null;

    const testKeysDoc = await testKeysRef.doc(testId).get();
    const testKeys = testKeysDoc.exists ? testKeysDoc.data() : [];

    return {
      ...testDoc.data(),
      testKeys,
    };
  } catch (error) {
    console.error('Ошибка загрузки теста:', error);
    throw error;
  }
}

export async function getTestKeys(testId) {
  const testKeysDoc = await testKeysRef.doc(testId).get();
  return testKeysDoc.exists ? testKeysDoc.data() : [];
}