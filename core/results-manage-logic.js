// core/results-manage-logic.js — управление результатами тестирования:
// фильтры, права на удаление и описание последствий. Чистая логика без DOM и
// Firebase (проверяется в Node).
//
// Модель удаления (ТЗ §4.3):
//   · Физически удаляются только ЗАВЕРШЁННЫЕ попытки (submitted / graded).
//     Незавершённая попытка (in_progress) связана с маркером activeAttempts и
//     материалом — её удалять нельзя ни в интерфейсе, ни по правилам.
//   · Права зеркалят firestore.rules (allow delete на attempts):
//     администратор — любые попытки своей организации; преподаватель — только
//     попытки групп, которые ему доступны (teacherGroups; пусто или нет поля —
//     все группы, как в правиле чтения). Студент и гость удалять не могут.
//   · Восстановления нет: у платформы нет для него архитектуры (попытка —
//     единственная копия ответов). Поэтому подтверждение двойное, а массовое
//     удаление требует ввести слово «УДАЛИТЬ».
//   · Журнал оценок (journalEntries) — отдельная неизменяемая запись, она
//     остаётся; о последствиях пользователю говорится в окне подтверждения.

export const DELETE_PHRASE = "УДАЛИТЬ";
export const BULK_PHRASE_FROM = 2;          // с какого числа записей нужно вводить слово
export const DELETABLE_STATUSES = ["submitted", "graded"];

// Права преподавателя на группу — зеркало teacherCanSeeGroup из правил:
// нет поля / null / пустой список → все группы; иначе группа должна быть в списке.
export function teacherSeesGroup(profile, groupId) {
  const groups = profile?.teacherGroups;
  if (groups === undefined || groups === null) return true;
  if (!Array.isArray(groups)) return false;
  if (groups.length === 0) return true;
  return groupId != null && groupId !== "" && groups.includes(groupId);
}

// Можно ли пользователю удалить попытку. { allowed, reason }
export function canDeleteAttempt(attempt, profile) {
  if (!profile || !profile.orgId) return { allowed: false, reason: "Нет профиля организации." };
  if (!attempt) return { allowed: false, reason: "Попытка не найдена." };
  if (attempt.orgId !== profile.orgId) return { allowed: false, reason: "Чужая организация." };
  if (profile.role !== "admin" && profile.role !== "teacher") return { allowed: false, reason: "Удалять результаты могут администратор и преподаватель." };
  if (!DELETABLE_STATUSES.includes(attempt.status)) {
    return { allowed: false, reason: attempt.status === "in_progress" ? "Попытка не завершена — удалить её нельзя." : "Недопустимый статус попытки." };
  }
  if (profile.role === "teacher" && !teacherSeesGroup(profile, attempt.groupId || null)) {
    return { allowed: false, reason: "Эта группа вам не доступна." };
  }
  return { allowed: true, reason: "" };
}

// ---------- фильтры ----------

const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const endOfDay = (ms) => { const d = new Date(ms); d.setHours(23, 59, 59, 999); return d.getTime(); };

// "2026-11-23" → мс начала/конца дня по локальному времени; пусто → null.
export function parseDay(value, end = false) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!m) return null;
  const ms = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  if (Number.isNaN(ms)) return null;
  return end ? endOfDay(ms) : startOfDay(ms);
}

// rows: [{ student, email, test, testId, groupId, subjectId, status, ms }]
// filter: { query, groupId, testId, subjectId, status, from, to }
export function filterResultRows(rows, filter = {}) {
  const q = String(filter.query || "").trim().toLowerCase();
  const from = parseDay(filter.from, false);
  const to = parseDay(filter.to, true);
  return (rows || []).filter((r) => {
    if (q && !`${r.student} ${r.email} ${r.test}`.toLowerCase().includes(q)) return false;
    if (filter.groupId && (r.groupId || "") !== filter.groupId) return false;
    if (filter.testId && r.testId !== filter.testId) return false;
    if (filter.subjectId && (r.subjectId || "") !== filter.subjectId) return false;
    if (filter.status && r.status !== filter.status) return false;
    if (from !== null && !(r.ms >= from)) return false;
    if (to !== null && !(r.ms <= to)) return false;
    return true;
  });
}

// Варианты выпадающих списков из самих данных (только то, что реально есть).
export function filterOptions(rows) {
  const uniq = (key) => [...new Set((rows || []).map((r) => r[key]).filter(Boolean))];
  const tests = new Map();
  for (const r of rows || []) if (r.testId && !tests.has(r.testId)) tests.set(r.testId, r.test || r.testId);
  return {
    groups: uniq("groupId").sort((a, b) => String(a).localeCompare(String(b), "ru")),
    subjects: uniq("subjectId"),
    tests: [...tests].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title, "ru"))
  };
}

// ---------- выбор и последствия ----------

// Сколько из выбранных реально можно удалить и почему остальные нельзя.
export function planDeletion(rows, selectedIds, profile) {
  const byId = new Map((rows || []).map((r) => [r.id, r]));
  const allowed = [];
  const blocked = [];
  for (const id of selectedIds || []) {
    const row = byId.get(id);
    if (!row) continue;
    const verdict = canDeleteAttempt(row.raw || row, profile);
    (verdict.allowed ? allowed : blocked).push({ row, reason: verdict.reason });
  }
  return { allowed: allowed.map((x) => x.row), blocked, summary: describeImpact(allowed.map((x) => x.row)) };
}

// Что пропадёт: числа для окна подтверждения.
export function describeImpact(rows) {
  const list = rows || [];
  const students = new Set(list.map((r) => r.userId || r.student)).size;
  const tests = new Set(list.map((r) => r.testId || r.test)).size;
  return {
    count: list.length,
    graded: list.filter((r) => r.status === "graded").length,
    pending: list.filter((r) => r.status === "submitted").length,
    withAssignment: list.filter((r) => (r.assignmentId || r.raw?.assignmentId)).length,
    students,
    tests
  };
}

export const needsTypedConfirmation = (count) => count >= BULK_PHRASE_FROM;
export const phraseMatches = (input) => String(input || "").trim().toUpperCase() === DELETE_PHRASE;

export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Текст последствий для окна подтверждения.
export function impactLines(s) {
  const lines = [`Будет удалено попыток: ${s.count} (учеников: ${s.students}, тестов: ${s.tests}).`];
  if (s.graded) lines.push(`Из них проверенных: ${s.graded} — их баллы исчезнут из аналитики, рейтингов и истории тестов.`);
  if (s.pending) lines.push(`Ожидающих проверки: ${s.pending} — ученик останется без оценки за эти работы.`);
  if (s.withAssignment) lines.push(`По назначениям: ${s.withAssignment} — задание снова станет невыполненным, если нет другой сдачи.`);
  lines.push("Записи журнала оценок остаются, Live-результаты не затрагиваются. Восстановить удалённое нельзя.");
  return lines;
}
