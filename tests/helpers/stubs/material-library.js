// Заглушка слоя доступа core/material-library.js для страницочного теста.
// Данные берутся из globalThis.__SB (как в других стабах): логика страницы
// настоящая, Firestore подменён. Валидация карточки — настоящая, как в
// core/material-library.js, чтобы тест ловил отказ записи до Firestore.
import { validateMaterialMeta, materialMetaPatch } from "../../../core/material-library-logic.js";

const sb = () => globalThis.__SB;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export async function listMaterials() {
  const s = sb();
  s.calls.push(["listMaterials"]);
  if (s.materialsError) throw s.materialsError;
  return clone(s.materials || []);
}

export async function loadLibraryMaterial(id) {
  const s = sb();
  s.calls.push(["loadLibraryMaterial", id]);
  if (s.loadError) throw s.loadError;
  const found = (s.materials || []).find(m => m.id === id);
  if (!found) return null;
  return { ...clone(found), pages: clone(found.pages || []) };
}

export async function createLibraryMaterial(data) {
  const s = sb();
  s.calls.push(["createLibraryMaterial", clone(data)]);
  if (s.saveError) throw s.saveError;
  return "new-id";
}

// Как в боевом слое: валидация до записи, затем ровно тот мета-патч,
// который ушёл бы в setDoc(..., {merge:true}).
export async function updateLibraryMaterial(id, patch = {}) {
  const s = sb();
  const errors = validateMaterialMeta(patch, false);
  if (errors.length) {
    const err = new Error(errors.join("\n"));
    err.fields = errors;
    throw err;
  }
  s.calls.push(["updateLibraryMaterial", id, { ...materialMetaPatch(patch), updatedAt: "<serverTimestamp>" }]);
  if (s.saveError) throw s.saveError;
}

export async function saveLibraryMaterialPages(id, pages) {
  const s = sb();
  s.calls.push(["saveLibraryMaterialPages", id, clone(pages)]);
  if (s.saveError) throw s.saveError;
}

export async function saveLibraryPagesDiff(id, pages, { signatures = null } = {}) {
  const s = sb();
  s.calls.push(["saveLibraryPagesDiff", id, clone(pages)]);
  if (s.saveError) throw s.saveError;
  return { signatures: pages.map(() => "stub"), written: signatures === null ? pages.length : 0 };
}

export async function deleteLibraryMaterial(id) {
  const s = sb();
  s.calls.push(["deleteLibraryMaterial", id]);
  if (s.deleteMaterialError) throw s.deleteMaterialError;
  (s.deleted ||= []).push(id);
}

export async function saveLibraryPdf() { /* не проверяем */ }
export async function removeLibraryPdf() { /* не проверяем */ }
export async function readPdfFile() { /* не проверяем */ }
