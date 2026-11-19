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
