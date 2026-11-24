// Заглушка core/materials.js (материал-книга в редакторе теста).
// Файл в AGENTS.md помечен как «не ломать» — в тестах он подменяется,
// чтобы страница не тянула Firebase; логика книги здесь не проверяется.
export async function loadMaterial(testId) {
  const sb = globalThis.__SB;
  sb.calls.push(["loadMaterial", testId]);
  if (sb.loadMaterialError) throw sb.loadMaterialError;
  const book = (sb.materials || []).find(m => m.id === testId);
  return book ? JSON.parse(JSON.stringify(book)) : null;
}

export async function saveMaterial(testId, data) {
  const sb = globalThis.__SB;
  sb.calls.push(["saveMaterial", testId, JSON.parse(JSON.stringify(data || {}))]);
  if (sb.saveMaterialError) throw sb.saveMaterialError;
}

// Чтение прогресса и проверка наличия книги: нужны страницам занятия.
// Значения задаются в globalThis.__SB (materialProgress: { "uid_testId": true }).
export async function hasMaterial(testId) {
  const sb = globalThis.__SB;
  return (sb.materials || []).some(m => m.id === testId);
}
export async function loadMaterialProgress(uid, testId) {
  const sb = globalThis.__SB;
  const done = Boolean(sb.materialProgress?.[`${uid}_${testId}`]);
  return { lastPage: 0, completed: done, exists: done };
}
export async function saveMaterialProgress() {}
export async function materialCompleted(uid, testId) { return (await loadMaterialProgress(uid, testId)).completed; }
export async function loadMaterialMeta(testId) {
  const book = (globalThis.__SB.materials || []).find(m => m.id === testId);
  return book ? { id: testId, ...book } : null;
}
