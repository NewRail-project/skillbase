// core/materials.js — Firestore-слой книг-материалов (materials/{testId}
// + pages/{n}) и прогресса чтения materialProgress/{uid}_{testId}.

import {
  db, collection, doc, getDoc, getDocs, setDoc, deleteDoc, serverTimestamp, Timestamp
} from "../shared/firebase.js";
import { State } from "./auth.js";
import { validateMaterial, validatePage } from "./material-logic.js";

function requireOnline(message) {
  if (!navigator.onLine) throw new Error(message || "Нет подключения к интернету.");
}

export function materialDocId(uid, testId) {
  return `${uid}_${testId}`;
}

// Все страницы материала (упорядоченно). Отсутствие книги — null.
export async function loadMaterial(testId) {
  const snap = await getDoc(doc(db, "materials", testId));
  if (!snap.exists()) return null;
  const meta = { id: snap.id, ...snap.data() };
  const pagesSnap = await getDocs(collection(db, "materials", testId, "pages"));
  const pages = pagesSnap.docs
    .map(item => ({ n: Number(item.id), blocks: item.data()?.blocks ?? [] }))
    .sort((a, b) => a.n - b.n)
    .map(item => item.blocks);
  return { ...meta, pageCount: meta.pageCount || pages.length, pages };
}

// Сохранить (создать или обновить) книгу целиком: перезаписывает страницы.
export async function saveMaterial(testId, { title, orgId, authorId, pages }) {
  requireOnline("Нет подключения к интернету. Материал не сохранён.");
  const errors = validateMaterial({ pageCount: pages.length, pages });
  if (errors.length) {
    const err = new Error(errors.join("\n"));
    err.fields = errors;
    throw err;
  }

  const materialsRef = doc(db, "materials", testId);
  const existing = await getDoc(materialsRef);
  await setDoc(materialsRef, {
    title: String(title || "").slice(0, 160),
    orgId,
    authorId,
    pageCount: pages.length,
    updatedAt: serverTimestamp(),
    createdAt: existing.exists() ? (existing.data().createdAt || serverTimestamp()) : serverTimestamp()
  }, { merge: true });

  const batchStatus = [];
  for (let n = 0; n < pages.length; n++) {
    batchStatus.push(setDoc(doc(db, "materials", testId, "pages", String(n)), {
      blocks: pages[n]
    }));
  }
  // Лишние страницы (при сокращении книги) удалить.
  const current = await getDocs(collection(db, "materials", testId, "pages"));
  current.docs.forEach(item => {
    if (Number(item.id) >= pages.length) batchStatus.push(deleteDoc(item.ref));
  });
  await Promise.all(batchStatus);
  return testId;
}

// Сохранить одну страницу; пустую страницу сохранить нельзя.
export async function savePage(testId, n, blocks) {
  requireOnline("Нет подключения к интернету. Страница не сохранена.");
  const errors = validatePage(blocks);
  if (errors.length) {
    const err = new Error(`Страница ${n + 1}: ${errors.join(" ")}`);
    err.fields = errors;
    throw err;
  }
  await setDoc(doc(db, "materials", testId, "pages", String(n)), { blocks });
}

export async function deletePage(testId, n) {
  requireOnline("Нет подключения к интернету. Страница не удалена.");
  await deleteDoc(doc(db, "materials", testId, "pages", String(n)));
}

// Заголовочная запись материала для страницы quiz/каталога.
export async function loadMaterialMeta(testId) {
  const snap = await getDoc(doc(db, "materials", testId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ---------- Прогресс чтения ----------

export async function loadMaterialProgress(uid, testId) {
  if (!uid || !testId) return { lastPage: 0, completed: false };
  try {
    const snap = await getDoc(doc(db, "materialProgress", materialDocId(uid, testId)));
    if (!snap.exists()) return { lastPage: 0, completed: false };
    const d = snap.data();
    return { lastPage: d.lastPage ?? 0, completed: d.completed === true };
  } catch (err) {
    // Нет доступа (идёт попытка — материал закрыт правилами): прогресс неважен.
    console.error("materialProgress:", err);
    return { lastPage: 0, completed: false };
  }
}

// Записывает прогресс { lastPage, completed }; правила пропускают только
// документы вида {uid}_{testId}.
export async function saveMaterialProgress(uid, testId, { lastPage, completed }) {
  requireOnline("Нет подключения к интернету. Прогресс не сохранён.");
  await setDoc(doc(db, "materialProgress", materialDocId(uid, testId)), {
    uid,
    testId,
    lastPage: Number(lastPage) || 0,
    completed: completed === true,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// Прогресс у collega студента только через materialCompleted метод
// экспортируем отдельно, потому что он нужен на странице задания.
export async function materialCompleted(uid, testId) {
  return (await loadMaterialProgress(uid, testId)).completed === true;
}
