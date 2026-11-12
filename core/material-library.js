// core/material-library.js — Firestore-слой библиотеки материалов:
// самостоятельные материалы (не привязанные к тесту) в существующей
// коллекции materials/{id} + pages/{n} (см. core/materials.js) и
// вложение PDF кусочками в materials/{id}/files/{n}.
//
// Проверки входных данных — core/material-library-logic.js (чистые
// функции, тестируются в Node). Основная граница безопасности —
// firestore.rules: они отклоняют некорректные записи независимо от
// клиента (организация, автор, статус, страницы).

import {
  db, collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  query, where, orderBy, serverTimestamp
} from "../shared/firebase.js";
import { State } from "./auth.js";
import { validateMaterial } from "./material-logic.js";
import {
  validateMaterialMeta, materialMetaPatch, normalizeStatus,
  MATERIAL_STATUS_DRAFT,
  PDF_MAX_BYTES, PDF_CHUNK_BIN, pdfChunkCount, isValidPdfName
} from "./material-library-logic.js";

function accessError(e, message) {
  if (e?.code === "permission-denied") return new Error(message);
  return e;
}

function requireOrg() {
  if (!State.user) throw new Error("Нужно войти в аккаунт.");
  if (!State.profile?.orgId) throw new Error("Организация не указана.");
  return State.profile.orgId;
}

// ---------- Чтение ----------

// Каталог организации. Студентам правила отдают только опубликованные
// документы; клиентская фильтрация visibleMaterials дублирует это для
// понятного пустого списка (правила остаются границей).
export async function listMaterials() {
  const orgId = requireOrg();
  try {
    const snap = await getDocs(query(
      collection(db, "materials"),
      where("orgId", "==", orgId),
      orderBy("updatedAt", "desc")
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    // Индекс updatedAt может отсутствовать до первого деплоя индексов —
    // повторяем без сортировки (правила те же, порядок на клиенте).
    if (err?.code !== "failed-precondition") throw accessError(err, "Каталог материалов недоступен.");
    const snap = await getDocs(query(
      collection(db, "materials"),
      where("orgId", "==", orgId)
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
}

// Карточка + страницы (как loadMaterial в core/materials.js, но вместе
// с полями карточки самостоятельного материала).
export async function loadLibraryMaterial(id) {
  const snap = await getDoc(doc(db, "materials", id));
  if (!snap.exists()) return null;
  const meta = { id: snap.id, ...snap.data() };
  const pagesSnap = await getDocs(collection(db, "materials", id, "pages"));
  const pages = pagesSnap.docs
    .map(item => ({ n: Number(item.id), blocks: item.data()?.blocks ?? [] }))
    .sort((a, b) => a.n - b.n)
    .map(item => item.blocks);
  return { ...meta, pageCount: meta.pageCount || pages.length, pages };
}

// ---------- Создание и изменение ----------

// Создание: правила требуют pageCount >= 1 и authorId == uid, поэтому
// страница (хотя бы одна) пишется той же операцией сохранения.
export async function createLibraryMaterial({ title, description, subjectId, topicId, order, status, pages }) {
  requireOrg();
  const meta = {
    title: String(title || ""),
    description: String(description || ""),
    subjectId: subjectId ? String(subjectId) : null,
    topicId: topicId ? String(topicId) : null,
    order: Number.isInteger(Number(order)) ? Number(order) : null,
    status: normalizeStatus(status, MATERIAL_STATUS_DRAFT),
    pages
  };
  const errors = validateMaterialMeta(meta, true);
  validateMaterial({ pageCount: pages.length, pages }).forEach(err => errors.push(err));
  if (errors.length) {
    const err = new Error(errors.join("\n"));
    err.fields = errors;
    throw err;
  }

  const ref = doc(collection(db, "materials"));
  const patch = materialMetaPatch(meta);
  await setDoc(ref, {
    ...patch,
    orgId: State.profile.orgId,
    authorId: State.user.uid,
    pageCount: pages.length,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  const writes = pages.map((blocks, n) =>
    setDoc(doc(db, "materials", ref.id, "pages", String(n)), { blocks }));
  await Promise.all(writes);
  return ref.id;
}

// Изменение карточки (название, описание, предмет/тема, порядок, статус).
// Обновлять может только автор (правила: authorId == request.auth.uid).
export async function updateLibraryMaterial(id, patch = {}) {
  const data = { ...patch };
  const errors = validateMaterialMeta(data, false);
  if (errors.length) {
    const err = new Error(errors.join("\n"));
    err.fields = errors;
    throw err;
  }
  await setDoc(doc(db, "materials", id), {
    ...materialMetaPatch(data),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// Публикация/архив — это изменение статуса тем же правилом materials.
export async function publishLibraryMaterial(id) {
  await updateLibraryMaterial(id, { status: "published" });
}

export async function archiveLibraryMaterial(id) {
  await updateLibraryMaterial(id, { status: "archived" });
}

// Сохранение книги целиком: перезаписывает страницы (core/materials.js).
export async function saveLibraryMaterialPages(id, pages) {
  const errors = validateMaterial({ pageCount: pages.length, pages });
  if (errors.length) {
    const err = new Error(errors.join("\n"));
    err.fields = errors;
    throw err;
  }
  await setDoc(doc(db, "materials", id), {
    pageCount: pages.length,
    updatedAt: serverTimestamp()
  }, { merge: true });

  const writes = [];
  for (let n = 0; n < pages.length; n++) {
    writes.push(setDoc(doc(db, "materials", id, "pages", String(n)), { blocks: pages[n] }));
  }
  // Лишние страницы (при сокращении книги) удалить.
  const current = await getDocs(collection(db, "materials", id, "pages"));
  current.docs.forEach(item => {
    if (Number(item.id) >= pages.length) writes.push(deleteDoc(item.ref));
  });
  await Promise.all(writes);
}

// ---------- Вложение PDF ----------

// Считывает файл кусочками base64. Ограничение 4 МБ: PDF — учебное
// приложение к материалу, документ Firestore не может быть больше 1 МБ.
export async function readPdfFile(file) {
  if (!isValidPdfName(file?.name)) {
    throw new Error("Выберите файл PDF (имя без символов / \\, до 120 символов).");
  }
  if (file.size > PDF_MAX_BYTES) {
    throw new Error(`Файл больше 4 МБ (${(file.size / 1024 / 1024).toFixed(1)} МБ). Сожмите PDF.`);
  }
  const buffer = await file.arrayBuffer();
  return { name: file.name, size: file.size, bytes: new Uint8Array(buffer) };
}

// Uint8Array → кусочки base64 по PDF_CHUNK_BIN байт. В браузере — через
// btoa (бинарная строка строится порциями, чтобы не упасть на стеке).
function toBase64(bytes) {
  let binary = "";
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
  }
  return btoa(binary);
}

export async function saveLibraryPdf(id, { name, size, bytes }) {
  requireOrg();
  if (!isValidPdfName(name)) throw new Error("Некорректное имя файла.");
  if (size > PDF_MAX_BYTES) throw new Error("Файл больше 4 МБ.");
  const total = pdfChunkCount(size);
  if (!total) throw new Error("Файл пуст.");

  // Лишние кусочки предыдущего вложения удалить (файл мог стать меньше).
  const current = await getDocs(collection(db, "materials", id, "files"));
  const stale = current.docs.filter(d => Number(d.id) >= total);
  const writes = stale.map(d => deleteDoc(d.ref));

  for (let n = 0; n < total; n++) {
    const start = n * PDF_CHUNK_BIN;
    const piece = bytes.subarray(start, Math.min(bytes.length, start + PDF_CHUNK_BIN));
    writes.push(setDoc(doc(db, "materials", id, "files", String(n)), {
      data: toBase64(piece)
    }));
  }
  await Promise.all(writes);

  await setDoc(doc(db, "materials", id), {
    pdfName: String(name),
    pdfSize: Number(size),
    pdfTotal: total,
    updatedAt: serverTimestamp()
  }, { merge: true });
  return { name, size, total };
}

// Вложение удалённое (или его нет) → null.
export async function loadLibraryPdf(id) {
  const meta = await getDoc(doc(db, "materials", id));
  if (!meta.exists() || !meta.data()?.pdfTotal) return null;
  const d = meta.data();
  const filesSnap = await getDocs(collection(db, "materials", id, "files"));
  const byN = new Map(filesSnap.docs.map(item => [Number(item.id), item.data()?.data ?? ""]));
  const parts = [];
  for (let n = 0; n < d.pdfTotal; n++) {
    const part = byN.get(n);
    if (!part) throw new Error("Файл загружен не полностью. Попросите преподавателя загрузить его заново.");
    parts.push(part);
  }
  return { name: d.pdfName || "material.pdf", base64: parts.join("") };
}

// base64 → Blob (для скачивания и открытия системным просмотрщиком).
export function pdfBlob(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "application/pdf" });
}

export async function removeLibraryPdf(id) {
  const current = await getDocs(collection(db, "materials", id, "files"));
  const writes = current.docs.map(d => deleteDoc(d.ref));
  await Promise.all(writes);
  await setDoc(doc(db, "materials", id), {
    pdfName: "",
    pdfSize: 0,
    pdfTotal: 0,
    updatedAt: serverTimestamp()
  }, { merge: true });
}
