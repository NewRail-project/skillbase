
export const TEST_BINDING_FIELDS = ["subjectId", "topicId", "materialId", "requireMaterial"];

export function normalizeTestBinding(binding) {
  return {
    subjectId: binding.subjectId || null,
    topicId: binding.topicId || null,
    materialId: binding.materialId || null,
    requireMaterial: !!binding.requireMaterial
  };
}

export function validateTestBinding(binding) {
  const errors = [];
  if (binding.subjectId && (typeof binding.subjectId !== "string" || binding.subjectId.length > 64)) errors.push("Некорректный ID предмета");
  if (binding.topicId && (typeof binding.topicId !== "string" || binding.topicId.length > 64)) errors.push("Некорректный ID темы");
  if (binding.materialId && (typeof binding.materialId !== "string" || binding.materialId.length > 64)) errors.push("Некорректный ID материала");
  if (typeof binding.requireMaterial !== "boolean") errors.push("Флаг обязательного прочтения должен быть логическим значением");
  return errors;
}

export function onSubjectChanged(oldSubjectId, newSubjectId, topicId) {
  if (oldSubjectId !== newSubjectId) return null;
  return topicId;
}

export function materialForTest(test) {
  return (test.materialId && typeof test.materialId === "string" && test.materialId.trim())
    ? test.materialId
    : test.id;
}
