// ui/core/streak.js — расчёт серии занятий на основе завершённых попыток.
// Не использует Firestore для хранения: серия рассчитывается на лету из данных.
// Правила: серия считается по датам завершённых попыток (status === "graded").
// Серия не увеличивается несколько раз за один день, не сбрасывается при повторном входе.

export function calculateStreak(attempts) {
  // Фильтруем только завершённые попытки с датой
  const graded = attempts
    .filter(a => a.status === "graded" && a.submittedAt)
    .map(a => {
      const date = new Date(a.submittedAt);
      if (Number.isNaN(date.getTime())) return null;
      return date;
    })
    .filter(Boolean);

  if (graded.length === 0) return { current: 0, max: 0 };

  // Сортируем по дате (от новых к старым)
  graded.sort((a, b) => b - a);

  const now = new Date();
  now.setHours(0, 0, 0, 0); // Начало текущего дня

  let currentStreak = 0;
  let maxStreak = 1;
  let prevDate = now;
  const dates = new Set();

  // Добавляем все даты завершённых попыток в Set для быстрой проверки
  for (const date of graded) {
    const dateStr = date.toISOString().split('T')[0];
    dates.add(dateStr);
  }

  // Считаем серию, идя назад от сегодняшнего дня
  for (let i = 0; i < graded.length; i++) {
    const date = graded[i];
    const dateStr = date.toISOString().split('T')[0];
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      // Сегодня — начинаем серию
      currentStreak = i + 1;
      if (i > 0) {
        const prevDateStr = graded[i - 1].toISOString().split('T')[0];
        const prevDiffDays = Math.floor((now - graded[i - 1]) / (1000 * 60 * 60 * 24));
        if (prevDiffDays === 1) {
          currentStreak = i + 1;
        } else {
          break;
        }
      }
    } else if (diffDays === 1) {
      // Вчера — продолжаем серию
      currentStreak = i + 1;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else if (diffDays === 2) {
      // Два дня назад — проверяем, что вчера был занятие
      const yesterdayStr = dateStr;
      if (dates.has(yesterdayStr)) {
        currentStreak = i + 1;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        break;
      }
    } else {
      // Больше 2 дней назад — серия прервана
      break;
    }
  }

  // Считаем максимальную серию от начала истории
  for (let i = 0; i < graded.length; i++) {
    const date = graded[i];
    const dateStr = date.toISOString().split('T')[0];
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays <= 2) {
      maxStreak = Math.max(maxStreak, i + 1);
    } else {
      break;
    }
  }

  return { current: currentStreak, max: maxStreak };
}

// Текстовое описание серии занятий
export function streakDescription(streak) {
  if (streak.current === 0) return "Начните с первого пройденного теста";
  if (streak.current === 1) return "Первый день прогресса";
  if (streak.current === 3) return "Три дня — отличная регулярность!";
  if (streak.current === 7) return "Неделя обучения — держитесь!";
  if (streak.current === 14) return "Две недели подряд!";
  if (streak.current >= 21) return "Марафон! Вы настоящий фанат обучения.";
  return `${streak.current} дней регулярных занятий`;
}
