// ui/core/achievements.js — локальная система достижений на основе попыток.
// Достижения не сохраняются в Firestore: они вычисляются при рендере на основе
// существующих данных (attempts, scores).
// Достижение выдается один раз при выполнении условия.

const ACHIEVEMENTS = [
  {
    id: "first-test",
    title: "Первый шаг",
    description: "Пройдите первый тест",
    icon: "🎯",
    condition: (attempts) => attempts.length >= 1 && attempts.some(a => a.status === "graded")
  },
  {
    id: "five-tests",
    title: "Начинающий",
    description: "Пройдите 5 тестов",
    icon: "📚",
    condition: (attempts) => attempts.length >= 5 && attempts.some(a => a.status === "graded")
  },
  {
    id: "ten-tests",
    title: "Ученик",
    description: "Пройдите 10 тестов",
    icon: "🎓",
    condition: (attempts) => attempts.length >= 10 && attempts.some(a => a.status === "graded")
  },
  {
    id: "ninety-percent",
    title: "Отличник",
    description: "Получите результат 90% и выше",
    icon: "⭐",
    condition: (attempts) => attempts.some(a =>
      a.status === "graded" && a.total &&
      (a.score / a.total) >= 0.9
    )
  },
  {
    id: "perfect-test",
    title: "Идеальный результат",
    description: "100% в любом тесте",
    icon: "🏆",
    condition: (attempts) => attempts.some(a =>
      a.status === "graded" && a.total &&
      (a.score / a.total) === 1
    )
  },
  {
    id: "streak-3",
    title: "Регулярный",
    description: "3 дня подряд",
    icon: "🔥",
    condition: (streak) => streak && streak.current >= 3
  },
  {
    id: "streak-7",
    title: "Стабильный",
    description: "7 дней подряд",
    icon: "⚡",
    condition: (streak) => streak && streak.current >= 7
  },
  {
    id: "streak-14",
    title: "Дисциплинированный",
    description: "14 дней подряд",
    icon: "🌟",
    condition: (streak) => streak && streak.current >= 14
  }
];

export function calculateAchievements(attempts, streak) {
  const earned = [];
  const earnedIds = new Set();

  for (const achievement of ACHIEVEMENTS) {
    // Проверяем только если достижение ещё не получено
    if (earnedIds.has(achievement.id)) continue;

    // Проверяем условие
    const condition = achievement.condition;
    const passed = typeof condition === 'function'
      ? condition(attempts, streak)
      : false;

    if (passed) {
      earned.push(achievement);
      earnedIds.add(achievement.id);
    }
  }

  return earned;
}

export function achievementsList(earned) {
  if (!earned.length) return null;

  return h("div", { class: "achievements-list" },
    h("div", { class: "section-title" }, "Ваши достижения"),
    earned.map(a => h("div", { class: "achievement" },
      h("div", { class: "achievement-icon" }, a.icon),
      h("div", { class: "achievement-info" },
        h("div", { class: "achievement-title" }, a.title),
        h("div", { class: "achievement-desc" }, a.description)
      )
    ))
  );
}
