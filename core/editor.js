// core/editor.js
import { db } from '../auth.js';
import { parseQuiz } from '../import/parser.js';

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
    // Проверка состояния сети
    if (!navigator.onLine) {
      throw new Error('Нет подключения к интернету. Данные будут сохранены локально.');
    }
    
    const testDoc = testRef.doc(testId);
    await testDoc.set(currentTest, { merge: true });
    
    // Хранение только ответов в отдельном документе
    const testKeysDoc = testKeysRef.doc(testId);
    await testKeysDoc.set(currentTest.testKeys);
  } catch (error) {
    console.error('Ошибка сохранения теста:', error);
    // Автосохранение данных при отключении интернета
    if (error.message.includes('Нет подключения к интернету')) {
      localStorage.setItem(`test_${testId}`, JSON.stringify(currentTest));
    }
    throw error;
  }
}

// Разбирает текст теста
export async function parseQuizText(quizText) {
  try {
    const result = parseQuiz(quizText);
    return result;
  } catch (error) {
    console.error('Ошибка разбора теста:', error);
    throw new Error('Ошибка разбора теста. Пожалуйста, попробуйте снова.');
  }
}

// Возвращает текущее состояние редактирования
export function getCurrentTest() {
  return { ...currentTest };
}

// Обновляет текущее состояние редактирования
export function updateTest(updates) {
  Object.assign(currentTest, updates);
  
  // Сохранение локального состояния
  localStorage.setItem(`test_${currentTest.id}`, JSON.stringify(currentTest));
}

// Создаёт новую версию теста при публикации
export async function publishTest(testId) {
  try {
    // Проверка состояния сети
    if (!navigator.onLine) {
      throw new Error('Нет подключения к интернету. Публикация невозможна.');
    }
    
    // Создание версии в папке versions
    const versionDoc = await versionsRef.doc(testId).collection('versions').add({
      ...currentTest,
      createdAt: new Date().toISOString(),
      status: 'published',
    });
    
    // Обновление статуса теста
    await testRef.doc(testId).update({
      status: 'published',
    });
    
    return versionDoc.id;
  } catch (error) {
    console.error('Ошибка публикации теста:', error);
    throw error;
  }
}

// Загрузка теста по ID
export async function loadTest(testId) {
  try {
    // Проверка состояния сети
    if (!navigator.onLine) {
      // Попытка загрузки из локального хранилища
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