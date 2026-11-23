// core/scenario-sim.js — прогон сценария «боты отвечают на вопросы».
// Чистая логика: никакого Firestore, DOM и часов. Результат целиком
// определяется настройками и seed.
//
// runScenario({ botCount, questionCount, accuracy, seed }) →
//   { events, board, ties, totalAnswers }
//   events — по возрастанию t (мс от старта сценария):
//     { type: "answer", t, bot, question (с 1), correct, progress 0..1 }
//     { type: "finish", t, board: [{ name, score, correct, place }] }
//     { type: "tie",    t, members: [имена], places: [занимаемые места] }  (после finish)
//   board — итог: { uid, name, score, correctCount, place };
//           равные очки и верные ответы — одно место (1, 1, 3).
//   ties  — группы ничьих из tieGroups (core/duel-logic.js).
import { planBotAnswers, botNames, BOT_LIMITS } from "./bots-plan.js";
import { tieGroups } from "./duel-logic.js";

export const POINTS_PER_CORRECT = 100;
// Один вопрос занимает слот: на ответ уходит до maxDelayMs, затем пауза.
export const QUESTION_SLOT_MS = BOT_LIMITS.maxDelayMs + 3000;

export function botUid(name) {
  return `bot-${String(name).replace(/\D+/g, "") || name}`;
}

// Общее правило мест: очки ↓, верные ↓, затем имя (чтобы порядок был
// одинаков при любом числе запусков). Равные очки и верные — одно место.
// Принимает строки { name, score, correctCount }, возвращает новые строки с place.
export function rankBoard(rows) {
  const sorted = (rows || []).map(row => ({ ...row })).sort((a, b) =>
    (b.score - a.score)
    || (b.correctCount - a.correctCount)
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  let place = 0;
  sorted.forEach((row, index) => {
    const prev = sorted[index - 1];
    if (!prev || prev.score !== row.score || prev.correctCount !== row.correctCount) place = index + 1;
    row.place = place;
  });
  return sorted;
}

// Очки по уже наступившим событиям answer. names — все участники (боты без
// ответов тоже попадают в рейтинг с нулём). Используется и в runScenario,
// и живым рейтингом экрана — поэтому финал всегда совпадает.
export function boardFromEvents(events, names) {
  const stats = new Map((names || []).map(name => [name, { correctCount: 0 }]));
  for (const event of events || []) {
    if (event.type !== "answer") continue;
    if (!stats.has(event.bot)) stats.set(event.bot, { correctCount: 0 });
    if (event.correct) stats.get(event.bot).correctCount += 1;
  }
  return rankBoard([...stats.entries()].map(([name, s]) => ({
    uid: botUid(name),
    name,
    score: s.correctCount * POINTS_PER_CORRECT,
    correctCount: s.correctCount
  })));
}

export function runScenario({ botCount = 0, questionCount = 0, accuracy = 0.6, seed = 1 } = {}) {
  const plan = planBotAnswers({ botCount, questionCount, accuracy, seed });
  const names = botNames(botCount);
  const questions = plan.length ? plan[0].answers.length : 0;
  const finishT = questions * QUESTION_SLOT_MS;

  const events = [];
  for (const entry of plan) {
    for (const a of entry.answers) {
      const t = (a.question - 1) * QUESTION_SLOT_MS + a.delayMs;
      events.push({
        type: "answer", t, bot: entry.bot, question: a.question, correct: a.correct,
        progress: finishT ? Math.min(1, t / finishT) : 1
      });
    }
  }
  events.sort((x, y) => (x.t - y.t) || (x.question - y.question)
    || (x.bot < y.bot ? -1 : x.bot > y.bot ? 1 : 0));

  const board = boardFromEvents(events, names);
  const ties = tieGroups(board);
  events.push({
    type: "finish", t: finishT,
    board: board.map(r => ({ name: r.name, score: r.score, correct: r.correctCount, place: r.place }))
  });
  for (const group of ties) {
    const first = group.members[0].place;
    events.push({
      type: "tie", t: finishT,
      members: group.members.map(m => m.name),
      places: group.members.map((_, i) => first + i)
    });
  }
  return { events, board, ties, totalAnswers: events.filter(e => e.type === "answer").length };
}
