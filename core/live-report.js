// core/live-report.js — подробный отчёт по Live. Строится только по реальным
// сохранённым ответам участников и ключам теста, а не по строкам рейтинга.
// Модуль без Firebase и DOM: проверяется в Node.

import { normalizeKeys, isCorrect, questionPoints } from "./scoring.js";
import { gradePlayer, GRADE_STATUS } from "./pair-grade.js";

const isEmptyAnswer = (a) => a == null || a === "" || (Array.isArray(a) && a.length === 0);
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const avg = (list) => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : 0);
const round1 = (v) => Math.round(v * 10) / 10;

export const READY_GOOD = 75;   // тема усвоена
export const READY_WEAK = 50;   // ниже — нужно повторение
export const QUESTION_HARD = 50;     // вопрос, который группа чаще решает неверно
export const STUDENT_NEEDS_HELP = 50; // процент верных, ниже которого нужна помощь

const optionText = (question, index) => {
  const option = question?.options?.[index];
  return typeof option === "string" ? option : option?.text ?? `Вариант ${index + 1}`;
};

// Самый частый неверный вариант вопроса (для single/multiple — по выбранным
// индексам, для short — по нормализованному тексту).
function popularWrong(key, question, answers) {
  const counts = new Map();
  for (const answer of answers) {
    if (isEmptyAnswer(answer) || isCorrect(key, answer)) continue;
    const label = key.type === "short"
      ? String(answer).trim()
      : (Array.isArray(answer) ? answer : [answer])
        .map(Number).sort((a, b) => a - b).join(",");
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  let best = null;
  for (const [label, count] of counts) if (!best || count > best.count) best = { label, count };
  if (!best) return null;
  const text = key.type === "short"
    ? best.label
    : best.label.split(",").map(i => optionText(question, Number(i))).join("; ");
  return { text, count: best.count };
}

export function buildLiveReport({
  players = [], keysByPos = [], questions = [], positions = null
} = {}) {
  const keys = normalizeKeys(keysByPos);
  const list = positions || keys.map((_, i) => i);
  const roster = players.filter(p => !p.observer && p.role !== "observer" && p.isAdminPlayer !== true);

  const grades = roster.map(p => gradePlayer(p, keys, { positions: list }));
  const byUid = new Map(grades.map(g => [g.uid, g]));

  // ---- Общая статистика группы ----
  const finishedPlayers = grades.filter(g => g.total > 0 && g.answered === g.total);
  const participated = grades.filter(g => g.answered > 0);
  const percents = grades.map(g => pct(g.earned, g.max));
  const gradeValues = grades.map(g => g.grade).filter(v => typeof v === "number");
  const buckets = [
    { label: "90–100", min: 90, max: 100, count: 0 },
    { label: "75–89", min: 75, max: 89, count: 0 },
    { label: "50–74", min: 50, max: 74, count: 0 },
    { label: "0–49", min: 0, max: 49, count: 0 }
  ];
  for (const v of gradeValues) {
    const bucket = buckets.find(b => v >= b.min && v <= b.max);
    if (bucket) bucket.count += 1;
  }
  const group = {
    participants: roster.length,
    participated: participated.length,
    finished: finishedPlayers.length,
    averageScore: round1(avg(grades.map(g => g.earned))),
    averagePercent: Math.round(avg(percents)),
    averageGrade: Math.round(avg(gradeValues)),
    maxGrade: gradeValues.length ? Math.max(...gradeValues) : 0,
    minGrade: gradeValues.length ? Math.min(...gradeValues) : 0,
    maxEarned: grades.length ? Math.max(...grades.map(g => g.earned)) : 0,
    minEarned: grades.length ? Math.min(...grades.map(g => g.earned)) : 0,
    distribution: buckets
  };

  // ---- Анализ каждого вопроса ----
  const questionStats = list.map(position => {
    const key = keys[position];
    if (!key) return null;
    const question = questions[position] || null;
    const answers = roster.map(p => p.answers?.[String(position)]);
    const given = answers.filter(a => !isEmptyAnswer(a));
    const correct = given.filter(a => isCorrect(key, a)).length;
    const skipped = answers.length - given.length;
    const times = roster
      .map(p => p.durations?.[String(position)])
      .filter(v => typeof v === "number" && v >= 0);
    return {
      position,
      text: question?.text || `Вопрос ${position + 1}`,
      points: questionPoints(key),
      participants: roster.length,
      correct,
      wrong: given.length - correct,
      skipped,
      correctPercent: pct(correct, roster.length),
      wrongPercent: pct(given.length - correct, roster.length),
      skippedPercent: pct(skipped, roster.length),
      averageTimeSec: times.length ? round1(avg(times) / 1000) : null,
      popularWrong: popularWrong(key, question, given),
      needsReview: roster.length > 0 && pct(correct, roster.length) < QUESTION_HARD
    };
  }).filter(Boolean);

  // ---- Анализ учеников ----
  const topicOf = (position) => (questions[position]?.topic || "").trim() || null;
  const students = grades.map(g => {
    const missed = g.breakdown.filter(b => !b.answered).length;
    const wrong = g.breakdown.filter(b => b.answered && !b.correct);
    const weakTopics = [...new Set(wrong.map(b => topicOf(b.position)).filter(Boolean))];
    const percent = pct(g.earned, g.max);
    let level = "ok";
    if (g.status === GRADE_STATUS.ZERO) level = "no_answers";
    else if (g.answered < g.total) level = "unfinished";
    else if (percent < STUDENT_NEEDS_HELP) level = "needs_help";
    else if (percent >= 85) level = "strong";
    return { uid: g.uid, name: g.name, grade: g.grade, percent, correct: g.correctCount,
      wrong: wrong.length, skipped: missed, answered: g.answered, total: g.total,
      finished: g.total > 0 && g.answered === g.total, level, weakTopics,
      wrongPositions: wrong.map(b => b.position) };
  }).sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name, "ru"));

  // ---- Готовность группы по темам (по вопросам с полем topic) ----
  const topicMap = new Map();
  for (const stat of questionStats) {
    const topic = topicOf(stat.position);
    if (!topic) continue;
    const entry = topicMap.get(topic) || { topic, questions: 0, correct: 0, possible: 0 };
    entry.questions += 1;
    entry.correct += stat.correct;
    entry.possible += stat.participants;
    topicMap.set(topic, entry);
  }
  const topics = [...topicMap.values()]
    .map(t => ({ topic: t.topic, questions: t.questions, percent: pct(t.correct, t.possible) }))
    .sort((a, b) => a.percent - b.percent);

  return { group, questions: questionStats, students, topics,
    verdict: lessonVerdict({ group, topics }),
    recommendations: buildRecommendations({ group, questions: questionStats, students, topics }),
    byUid };
}

// Итоговый вывод для преподавателя: стоит ли проводить ещё одно занятие.
export function lessonVerdict({ group, topics = [] } = {}) {
  if (!group || !group.participated) {
    return { level: "none", text: "Нет данных: ответов участников пока нет." };
  }
  const weakest = topics.length ? topics[0].percent : 100;
  const level = Math.min(group.averagePercent, weakest);
  if (level >= READY_GOOD) {
    return { level: "good", text: "Тема усвоена — дополнительное занятие не требуется, можно двигаться дальше." };
  }
  if (level >= READY_WEAK) {
    return { level: "mid", text: "Тема усвоена частично — стоит провести краткое повторение сложных вопросов." };
  }
  return { level: "low", text: "Тема усвоена слабо — стоит провести ещё одно занятие по этой теме." };
}

// Понятные рекомендации преподавателю.
export function buildRecommendations({ group, questions, students, topics }) {
  const out = [];
  if (!group.participated) {
    return [{ kind: "info", text: "Нет ответов участников — отчёт появится после проверки." }];
  }
  const weakTopics = topics.filter(t => t.percent < READY_WEAK);
  const mediumTopics = topics.filter(t => t.percent >= READY_WEAK && t.percent < READY_GOOD);
  if (!weakTopics.length && !mediumTopics.length && group.averagePercent >= READY_GOOD) {
    out.push({ kind: "good", text: "Группа хорошо усвоила тему — можно двигаться дальше." });
  }
  if (weakTopics.length || mediumTopics.length) {
    const names = [...weakTopics, ...mediumTopics].map(t => `«${t.topic}»`).join(", ");
    out.push({ kind: "warn", text: `Группе требуется повторение разделов: ${names}.` });
  } else if (group.averagePercent < READY_GOOD) {
    out.push({ kind: "warn", text: "Группе требуется повторение: средний процент верных ответов ниже нормы." });
  }
  const help = students.filter(s => s.level === "needs_help" || s.level === "no_answers");
  if (help.length) {
    out.push({ kind: "warn", text: `Ученикам нужна индивидуальная помощь: ${help.map(s => s.name).join(", ")}.` });
  }
  const unfinished = students.filter(s => s.level === "unfinished");
  if (unfinished.length) {
    out.push({ kind: "info", text: `Не завершили тест: ${unfinished.map(s => s.name).join(", ")}.` });
  }
  const review = questions.filter(q => q.needsReview);
  if (review.length) {
    out.push({ kind: "warn",
      text: `Разберите повторно на следующей паре вопросы: ${review.map(q => q.position + 1).join(", ")}.` });
  }
  return out;
}
