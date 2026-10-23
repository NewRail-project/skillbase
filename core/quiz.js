// core/quiz.js
import { db } from '../shared/firebase.js';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, collection } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

export async function startAttempt(userId, testId) {
  try {
    // Проверка состояния сети
    if (!navigator.onLine) {
      throw new Error('Нет подключения к интернету. Попытка не может быть начата.');
    }
    
    const attemptId = `${userId}_${testId}_${Date.now()}`;
    const attemptRef = doc(db, 'attempts', attemptId);
    
    await setDoc(attemptRef, {
      userId,
      testId,
      startedAt: serverTimestamp(),
      answers: {},
      status: 'active'
    });
    
    return attemptId;
  } catch (error) {
    console.error('Ошибка создания попытки:', error);
    throw error;
  }
}

export async function saveAnswer(attemptId, questionIndex, answer) {
  try {
    // Проверка состояния сети
    if (!navigator.onLine) {
      // Сохранение локально
      const attempts = JSON.parse(localStorage.getItem(`attempts_${attemptId}`)) || { answers: {}};
      attempts.answers[questionIndex] = answer;
      localStorage.setItem(`attempts_${attemptId}`, JSON.stringify(attempts));
      return;
    }
    
    const attemptRef = doc(db, 'attempts', attemptId);
    await updateDoc(attemptRef, {
      [`answers.${questionIndex}`]: answer,
      lastSaved: serverTimestamp()
    });
  } catch (error) {
    console.error('Ошибка сохранения ответа:', error);
    throw error;
  }
}

export async function finishAttempt(attemptId, testId) {
  try {
    // Проверка состояния сети
    if (!navigator.onLine) {
      throw new Error('Нет подключения к интернету. Попытка не может быть завершена.');
    }
    
    const attemptRef = doc(db, 'attempts', attemptId);
    const testKeysRef = doc(db, 'testKeys', testId);
    
    const attemptSnap = await getDoc(attemptRef);
    const keysSnap = await getDoc(testKeysRef);
    
    if (!attemptSnap.exists || !keysSnap.exists) {
      throw new Error('Документы попытки или ключи теста не найдены.');
    }
    
    const attempt = attemptSnap.data();
    const keys = keysSnap.data().keys || [];
    
    let score = 0;
    const results = [];
    
    // Проверка каждого ответа
    for (let i = 0; i < attempt.answers.length; i++) {
      const ans = attempt.answers[i];
      const key = keys[i];
      const isCorrect = JSON.stringify(ans) === JSON.stringify(key.answer);
      if (isCorrect) score++;
      results.push({ isCorrect, correct: key.answer });
    }
    
    await updateDoc(attemptRef, {
      status: 'finished',
      finishedAt: serverTimestamp(),
      score,
      results
    });
    
    return { score, results };
  } catch (error) {
    console.error('Ошибка завершения попытки:', error);
    throw error;
  }
}
