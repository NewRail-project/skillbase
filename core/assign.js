import { db } from "../shared/firebase.js";
import { collection, doc, getDoc, setDoc, query, where, getDocs, serverTimestamp, orderBy, addDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// Назначение теста: создание документа assignment
export async function assignTest(testId, teacherId, groupId, deadline, attemptsLimit) {
  const assignmentId = `${testId}_${groupId}_${Date.now()}`;
  const assignRef = doc(db, 'assignments', assignmentId);

  await setDoc(assignRef, {
    testId,
    teacherId,
    groupId,
    deadline,
    attemptsLimit,
    createdAt: serverTimestamp(),
    status: 'active'
  });

  return assignmentId;
}

// Получение заданий для ученика (по его группе)
export async function getStudentAssignments(groupId) {
  const q = query(
    collection(db, 'assignments'),
    where('groupId', '==', groupId),
    where('status', '==', 'active')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// Получение результатов теста для преподавателя
export async function getTeacherResults(testId) {
  const q = query(
    collection(db, 'attempts'),
    where('testId', '==', testId),
    orderBy('finishedAt', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// Создание попытки тестирования
export async function createAttempt(testId, userId) {
  const attemptRef = await addDoc(collection(db, 'attempts'), {
    testId,
    userId,
    status: 'in-progress',
    score: 0,
    startedAt: serverTimestamp(),
    finishedAt: null
  });
  return attemptRef.id;
}

// Обновление попытки тестирования
export async function updateAttempt(attemptId, questionIndex, answer, testId) {
  const attemptRef = doc(db, 'attempts', attemptId);
  const attemptData = await getDoc(attemptRef);
  if (!attemptData.exists()) return null;

  const currentData = attemptData.data();
  const testRef = doc(db, 'tests', testId);
  const testData = await getDoc(testRef);
  if (!testData.exists()) return null;

  const testQuestions = testData.data().questions || [];
  const correctAnswers = testQuestions[questionIndex]?.options?.filter((option, index) => option.correct).map((_, index) => index) || [];

  const updatedScore = currentData.score + (correctAnswers.includes(answer) ? 1 : 0);
  await updateDoc(attemptRef, {
    score: updatedScore,
    answers: currentData.answers || {}
  });
  return updatedScore;
}

// Завершение попытки тестирования
export async function finishAttempt(attemptId, testId) {
  const attemptRef = doc(db, 'attempts', attemptId);
  await updateDoc(attemptRef, {
    status: 'completed',
    finishedAt: serverTimestamp()
  });
}