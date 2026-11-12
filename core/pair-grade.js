// core/pair-grade.js — оценка за пару по 100-балльной системе и журнал.
//
// Оценка = 90 × P/M + 10 × A/N, где
//   P — баллы за правильные ответы (по реальным весам вопросов),
//   M — максимум баллов за тест,
//   A — число вопросов, на которые участник ответил,
//   N — общее число вопросов.
// Скорость, серия и место в рейтинге на оценку НЕ влияют: она считается
// только по сохранённым ответам и ключам. Модуль без Firebase и DOM.

import { normalizeKeys, isCorrect, questionPoints } from "./scoring.js";

export const KNOWLEDGE_WEIGHT = 90;
export const PARTICIPATION_WEIGHT = 10;

export const GRADE_STATUS = Object.freeze({
  GRADED: "graded",          // оценка выставлена
  ZERO: "zero",              // присутствовал, но не ответил ни на один вопрос
  ABSENT: "absent"           // не участвовал — оценки нет
});

export const GRADE_STATUS_LABEL = Object.freeze({
  graded: "",
  zero: "Не ответил ни на один вопрос",
  absent: "Не участвовал"
});

// Чистая формула. Возвращает целое 0..100.
export function pairGradeValue({ earned = 0, max = 0, answered = 0, total = 0 } = {}) {
  const knowledge = max > 0 ? Math.min(1, Math.max(0, earned / max)) : 0;
  const participation = total > 0 ? Math.min(1, Math.max(0, answered / total)) : 0;
  return Math.round(KNOWLEDGE_WEIGHT * knowledge + PARTICIPATION_WEIGHT * participation);
}

// Оценка одного участника по его сохранённым ответам.
// keysByPos — массив ключей по позициям вопросов; positions — какие позиции
// считаются проведёнными (по умолчанию все).
// Возвращает разбор, из которого сложилась оценка (для проверки преподавателем).
export function gradePlayer(player, keysByPos, { positions = null } = {}) {
  const keys = normalizeKeys(keysByPos);
  const list = positions || keys.map((_, i) => i);
  let earned = 0;
  let max = 0;
  let answered = 0;
  let correctCount = 0;
  const breakdown = [];

  for (const position of list) {
    const key = keys[position];
    if (!key) continue;
    const points = questionPoints(key);
    max += points;
    const answer = player?.answers?.[String(position)];
    if (answer == null || answer === "" || (Array.isArray(answer) && !answer.length)) {
      breakdown.push({ position, answered: false, correct: false, points: 0, max: points });
      continue;
    }
    answered += 1;
    const correct = isCorrect(key, answer);
    if (correct) { earned += points; correctCount += 1; }
    breakdown.push({ position, answered: true, correct, points: correct ? points : 0, max: points });
  }

  const total = breakdown.length;
  let status = GRADE_STATUS.GRADED;
  let grade = pairGradeValue({ earned, max, answered, total });
  if (answered === 0) { status = GRADE_STATUS.ZERO; grade = 0; }

  return { uid: player?.uid, name: player?.name || "Участник", status, grade,
    earned: Math.round(earned * 100) / 100, max: Math.round(max * 100) / 100,
    answered, total, correctCount, breakdown };
}

// «Присутствовал» — вошёл в комнату как участник. Отсутствующим считается
// тот, кого нет среди участников (его в журнале показываем из списка группы).
export function gradeRoster({ players = [], keysByPos = [], positions = null, absent = [] } = {}) {
  const rows = players
    .filter(p => !p.observer && p.role !== "observer" && p.isAdminPlayer !== true)
    .map(p => gradePlayer(p, keysByPos, { positions }));
  for (const person of absent) {
    rows.push({ uid: person.uid || null, name: person.name || "Участник",
      status: GRADE_STATUS.ABSENT, grade: null, earned: 0, max: 0, answered: 0, total: 0,
      correctCount: 0, breakdown: [] });
  }
  return rows;
}

// Журнал: ФИО по алфавиту независимо от места в рейтинге.
export function journalRows(grades) {
  return [...(grades || [])]
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru", { sensitivity: "base" }))
    .map(row => ({
      uid: row.uid,
      name: row.name,
      status: row.status,
      grade: row.status === GRADE_STATUS.ABSENT ? null : row.grade,
      label: row.status === GRADE_STATUS.ABSENT ? GRADE_STATUS_LABEL.absent : String(row.grade)
    }));
}

// Ручная правка оценки: хранится отдельной записью, с причиной и автором.
// Возвращает запись для записи в журнал изменений либо ошибку.
export function buildGradeOverride({ uid, from, to, reason, authorUid, at = Date.now() } = {}) {
  const value = Number(to);
  if (!uid) return { error: "Не указан участник." };
  if (!Number.isInteger(value) || value < 0 || value > 100) return { error: "Оценка — целое число от 0 до 100." };
  if (!String(reason || "").trim()) return { error: "Укажите причину изменения оценки." };
  if (!authorUid) return { error: "Не указан автор изменения." };
  return { override: { uid, from: from ?? null, to: value, reason: String(reason).trim().slice(0, 300), authorUid, at } };
}

// Применяет записи правок поверх рассчитанных оценок (последняя запись выигрывает).
export function applyOverrides(grades, overrides = []) {
  const last = new Map();
  for (const o of overrides) {
    const prev = last.get(o.uid);
    if (!prev || (o.at || 0) >= (prev.at || 0)) last.set(o.uid, o);
  }
  return grades.map(row => last.has(row.uid)
    ? { ...row, calculated: row.grade, grade: last.get(row.uid).to, override: last.get(row.uid) }
    : row);
}
