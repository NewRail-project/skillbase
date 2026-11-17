// core/score-format.js — единое отображение оценок: в БАЛЛАХ, не в процентах.
// Оценка за работу — число 0–100 (формула учебной оценки не менялась); на
// экране она подписывается «б.». Процентами остаются только доли
// (активность, освоение, доля учеников в диапазоне, точность по вопросу).
const trim = n => String(Math.round(n * 100) / 100);

// Оценка в баллах: 80 → «80 б.»; нет данных (null/NaN) → «—», а не «0 б.».
export function gradeLabel(value) {
  return Number.isFinite(value) ? `${Math.round(value)} б.` : "—";
}

// Набранные баллы из максимума: «24 из 30». Нет данных → «—».
export function earnedLabel(earned, max) {
  return Number.isFinite(earned) && Number.isFinite(max) && max > 0
    ? `${trim(earned)} из ${trim(max)}` : "—";
}

// Результат попытки для таблицы: «80 б. (24 из 30)».
export function attemptResultLabel({ percent = null, score = null, total = null } = {}) {
  if (!Number.isFinite(percent)) return "—";
  const earned = earnedLabel(score, total);
  return earned === "—" ? gradeLabel(percent) : `${gradeLabel(percent)} (${earned})`;
}
