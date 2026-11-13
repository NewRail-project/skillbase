// Никакого DOM — проверяется юнит-тестами в Node.
// Firebase импорты убраны для совместимости с тестами.

// Время попытки для сортировки по хронологии (Timestamp | ms | ISO).
function attemptTimeMs(value) {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// Динамика результатов: хронологический ряд процентов завершённых попыток
// и сдвиг последнего результата относительно предыдущего. Незавершённые
// попытки и попытки без процента в динамику не попадают.
export function resultDynamics(attempts) {
  const completed = (attempts || [])
    .filter(a => a.status === "graded" && typeof a.percent === "number")
    .sort((a, b) => attemptTimeMs(a.finishedAt) - attemptTimeMs(b.finishedAt));
  const series = completed.map(a => a.percent);
  if (!series.length) return { series, delta: null, direction: "none" };
  if (series.length === 1) return { series, delta: null, direction: "single" };
  const delta = series[series.length - 1] - series[series.length - 2];
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return { series, delta, direction };
}

export function computeStudentProgress(attempts, subjects = [], topics = [], materialProgressMap = new Map()) {
  const completedAttempts = (attempts || []).filter(a => a.status === "graded" && typeof a.percent === "number");

  // 1. Статистика тестов
  const totalAttempts = attempts.length;
  const gradedAttempts = completedAttempts.length;
  const bestScore = gradedAttempts ? Math.max(...completedAttempts.map(a => a.percent)) : 0;
  const averageScore = gradedAttempts ? Math.round(completedAttempts.reduce((sum, a) => sum + a.percent, 0) / gradedAttempts) : 0;

  // 2. Предметы и темы
  const subjectMap = new Map();
  subjects.forEach(s => subjectMap.set(s.id, { ...s, topics: [], completedCount: 0 }));

  const topicToSubject = new Map();
  topics.forEach(t => {
    topicToSubject.set(t.id, t.subjectId);
    if (subjectMap.has(t.subjectId)) {
      subjectMap.get(t.subjectId).topics.push(t);
    }
  });

  // Группировка попыток по предмету/теме
  const subjectStats = new Map();
  completedAttempts.forEach(a => {
    const sId = a.subjectId;
    if (!sId) return;
    if (!subjectStats.has(sId)) subjectStats.set(sId, { scores: [], count: 0 });
    const st = subjectStats.get(sId);
    st.scores.push(a.percent);
    st.count += 1;
  });

  const subjectsProgress = subjects.map(s => {
    const st = subjectStats.get(s.id);
    const avg = st && st.scores.length ? Math.round(st.scores.reduce((a, b) => a + b, 0) / st.scores.length) : null;
    return {
      subjectId: s.id,
      title: s.title,
      attemptsCount: st ? st.count : 0,
      averageScore: avg
    };
  });

  // 3. Прогресс по темам и слабые темы (средний балл < 60 — требует повторения)
  // Название темы берём из справочника тем; старые попытки без topicId
  // в темах не участвуют, но остаются в общей статистике тестов.
  const topicTitle = new Map(topics.map(t => [t.id, t.title || t.id]));
  const topicStats = new Map();
  completedAttempts.forEach(a => {
    const tId = a.topicId;
    if (!tId) return;
    if (!topicStats.has(tId)) topicStats.set(tId, { scores: [], title: topicTitle.get(tId) || a.testTitle || tId });
    topicStats.get(tId).scores.push(a.percent);
  });

  const topicsProgress = [];
  const weakTopics = [];
  topicStats.forEach((data, topicId) => {
    const avg = Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length);
    const row = { topicId, title: data.title, averageScore: avg, attemptsCount: data.scores.length };
    topicsProgress.push(row);
    if (avg < 60) weakTopics.push({ topicId, title: data.title, averageScore: avg });
  });
  topicsProgress.sort((a, b) =>
    a.averageScore - b.averageScore || String(a.title).localeCompare(String(b.title), "ru", { sensitivity: "base" }));
  weakTopics.sort((a, b) => a.averageScore - b.averageScore || String(a.title).localeCompare(String(b.title), "ru", { sensitivity: "base" }));

  // 4. Достижения (Achievements)
  const achievements = [];

  // Первый завершённый тест
  if (gradedAttempts > 0) {
    achievements.push({ id: "first_test", title: "Первый шаг", description: "Завершён первый тест", icon: "🏆" });
  }

  // Первое изученное пособие (materialProgress завершён)
  let studiedMaterialsCount = 0;
  materialProgressMap.forEach((p) => {
    if (p.completed) studiedMaterialsCount += 1;
  });

  if (studiedMaterialsCount > 0) {
    achievements.push({ id: "first_material", title: "Книга знаний", description: "Изучено первое учебное пособие", icon: "📖" });
  }

  // Серия успешных тестов (например, 3 теста подряд >= 75%)
  let currentStreak = 0;
  let maxStreak = 0;
  const sortedAttempts = [...completedAttempts].sort((a, b) => (a.finishedAt?.toMillis() || 0) - (b.finishedAt?.toMillis() || 0));
  sortedAttempts.forEach(a => {
    if (a.percent >= 75) {
      currentStreak += 1;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
  });

  if (maxStreak >= 3) {
    achievements.push({ id: "success_streak", title: "Серия побед", description: `3 успешных теста подряд (от 75%)`, icon: "🔥" });
  }

  // Улучшение среднего результата (если попыток >= 5 и последние лучше первых)
  if (completedAttempts.length >= 5) {
    const firstHalf = completedAttempts.slice(0, Math.floor(completedAttempts.length / 2));
    const secondHalf = completedAttempts.slice(Math.floor(completedAttempts.length / 2));
    const avg1 = firstHalf.reduce((s, a) => s + a.percent, 0) / firstHalf.length;
    const avg2 = secondHalf.reduce((s, a) => s + a.percent, 0) / secondHalf.length;
    if (avg2 > avg1) {
      achievements.push({ id: "improving", title: "Рост мастерства", description: "Средний балл во второй половине попыток вырос", icon: "📈" });
    }
  }

  // Динамика результатов — по всем завершённым попыткам по хронологии.
  const dynamics = resultDynamics(attempts);

  return {
    totalAttempts,
    gradedAttempts,
    bestScore,
    averageScore,
    subjectsProgress,
    topicsProgress,
    weakTopics,
    dynamics,
    studiedMaterialsCount,
    achievements
  };
}
