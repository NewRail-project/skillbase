// core/assign.js
import { db } from '../shared/firebase.js';
import { collection, doc, setDoc, query, where, getDocs, serverTimestamp, orderBy } from 'firebase/firestore';

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
