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
// Повторное подключение не создаёт вторую строку: в Live-комнате каждому
// участнику отвечает один документ players/{uid}; на случай сторонних
// источников (история попыток) одинаковые uid схлопываются — первый вход
// выигрывает.
export function gradeRoster({ players = [], keysByPos = [], positions = null, absent = [] } = {}) {
  const seen = new Set();
  const rows = players
    .filter(p => {
      if (p.observer || p.role === "observer" || p.isAdminPlayer === true) return false;
      if (p.uid == null) return true;
      if (seen.has(p.uid)) return false;
      seen.add(p.uid);
      return true;
    })
    .map(p => gradePlayer(p, keysByPos, { positions }));
  for (const person of absent) {
    rows.push({ uid: person.uid || null, name: person.name || "Участник",
      status: GRADE_STATUS.ABSENT, grade: null, earned: 0, max: 0, answered: 0, total: 0,
      correctCount: 0, breakdown: [] });
  }
  return rows;
}

// Журнал: ФИО по алфавиту независимо от места в рейтинге. Строка несёт
// все данные, которые требует журнал: порядковый номер, ФИО, статус
// участия, число верных/неверных/пропущенных ответов и итоговую оценку.
// Счётчики выводятся из разбора gradePlayer (breakdown) — новых источников
// данных нет: неверный ответ отличается от пропуска и от неучастия.
export function journalRows(grades) {
  return [...(grades || [])]
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru", { sensitivity: "base" }))
    .map((row, index) => {
      const breakdown = Array.isArray(row.breakdown) ? row.breakdown : [];
      const wrong = breakdown.filter(b => b.answered && !b.correct).length;
      const skipped = breakdown.filter(b => !b.answered).length;
      return {
        n: index + 1,
        uid: row.uid,
        name: row.name,
        status: row.status,
        // Статус участия: был и отвечал / был без ответов / не участвовал.
        statusLabel: row.status === GRADE_STATUS.ABSENT ? GRADE_STATUS_LABEL.absent
          : row.status === GRADE_STATUS.ZERO ? GRADE_STATUS_LABEL.zero
          : "Участвовал",
        correct: row.correctCount ?? breakdown.filter(b => b.correct).length,
        wrong,
        skipped,
        total: row.total ?? breakdown.length,
        grade: row.status === GRADE_STATUS.ABSENT ? null : row.grade,
        label: row.status === GRADE_STATUS.ABSENT ? GRADE_STATUS_LABEL.absent : String(row.grade)
      };
    });
}

// Средний балл по журналу: только выставленные оценки (независимо от
// статуса graded/zero), «Не участвовал» в среднее не входит. Оценка —
// та же формула знаний (pairGradeValue), скорость и место не влияют.
// Пустой журнал → null (показывать среднее нечего).
export function journalAverage(grades) {
  const values = (grades || [])
    .filter(row => row.status !== GRADE_STATUS.ABSENT)
    .map(row => row.grade)
    .filter(v => typeof v === "number");
  if (!values.length) return null;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

// ---------- CSV журнала ----------
// Колонки промта и строки для экспорта. Данные — те же, что отображает
// вкладка «Журнал» (journalRows): отдельной формулы оценки и отдельной
// логики участников нет. «Не вошедшие» (status absent — из списка
// группы, не из players) в экспорт не попадают; вошедший без ответов
// остаётся со статусом «zero» и оценкой 0; наблюдателей в journalRows
// уже нет (gradeRoster их отфильтровал). Порядок строк — по ФИО,
// как на вкладке.
export const JOURNAL_CSV_COLUMNS = [
  "№", "ФИО", "Статус участия", "Правильные ответы", "Неправильные ответы",
  "Пропуски", "Итоговая оценка"
];

export function journalCsvRows(journal) {
  return (journal || [])
    .filter(row => row.status !== GRADE_STATUS.ABSENT)
    .map(row => ({
      "№": row.n ?? "",
      "ФИО": row.name ?? "",
      "Статус участия": row.statusLabel ?? "",
      "Правильные ответы": row.correct ?? 0,
      "Неправильные ответы": row.wrong ?? 0,
      "Пропуски": row.skipped ?? 0,
      "Итоговая оценка": row.status === GRADE_STATUS.ABSENT ? "" : (row.grade ?? 0)
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
