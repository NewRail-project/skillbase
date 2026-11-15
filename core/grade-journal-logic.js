// core/grade-journal-logic.js — чистая логика записей журнала (без Firebase).
// Проверка входа и детерминированный id записи: повторная запись той же
// оценки того же источника не создаёт дубль.

export const JOURNAL_SOURCES = Object.freeze(["test", "live", "manual"]);

function safeId(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
}

// Чистая проверка входа (тестируется без Firebase).
export function validateJournalEntry(entry = {}) {
  const grade = Number(entry.grade);
  if (typeof entry.studentId !== "string" || !entry.studentId) return "Не указан ученик.";
  if (!Number.isFinite(grade) || grade < 0 || grade > 100) return "Оценка — число от 0 до 100.";
  if (!JOURNAL_SOURCES.includes(entry.source)) return "Неизвестный источник оценки.";
  return null;
}

// Детерминированный id записи: ученик + источник + идентификатор источника
// (попытка, комната). Без sourceId дублей не предотвратить — запись
// получает уникальный id.
export function journalEntryId({ studentId, source, sourceId } = {}) {
  if (!sourceId) return null;
  return `${safeId(studentId)}_${safeId(source)}_${safeId(sourceId)}`;
}
