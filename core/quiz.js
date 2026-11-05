// core/quiz.js — совместимость со старым API.
// Новая логика попыток живёт в core/attempts.js: создание, сохранение
// ответов, отправка и проверка преподавателем.
// saveAnswer/finishAttempt — имена из старого контракта (ui/quiz.html):
// подписи совпадают один в один с saveAttemptAnswers/submitAttemptById,
// поэтому это честные алиасы, а не заглушки.
import { startAttempt, saveAttemptAnswers, submitAttemptById } from "./attempts.js";

export {
  startAttempt,
  saveAttemptAnswers,
  submitAttemptById,
  getAttempt,
  listMyAttemptsForTest,
  getAttemptKeys,
  gradeAttempt
} from "./attempts.js";

export const saveAnswer = saveAttemptAnswers;
export const finishAttempt = submitAttemptById;
