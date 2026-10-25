// core/quiz.js — совместимость со старым API.
// Новая логика попыток живёт в core/attempts.js: создание, сохранение
// ответов, отправка и проверка преподавателем.
export {
  startAttempt,
  saveAttemptAnswers,
  submitAttemptById,
  getAttempt,
  listMyAttemptsForTest,
  getAttemptKeys,
  gradeAttempt
} from "./attempts.js";
