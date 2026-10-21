// ui/pages/quiz.js

// Загрузка теста и логика теста
const loadTest = async (testId) => {
  // TODO: Заменить на Firestore-запрос
  return { questions: [] };
};

const startAttempt = async (userId, testId) => {
  // TODO: Заменить на Firestore-запрос
  return null;
};

const saveAnswer = async (attemptId, questionIndex, answer) => {
  // TODO: Заменить на Firestore-запрос
};

const finishAttempt = async (attemptId, testId) => {
  // TODO: Заменить на Firestore-запрос
};

// DOM-элемент для теста
function QuizPage() {
  const div = document.createElement("div");
  div.className = "quiz-container";
  const questions = [];
  let timer = 10;
  let currentQuestionIndex = 0;
  let answers = {};
  let isOnline = navigator.onLine;
  let attemptId = null;
  let isFinished = false;

  window.addEventListener("online", () => { isOnline = true; });
  window.addEventListener("offline", () => { isOnline = false; });

  const loadQuestions = async () => {
    const test = await loadTest();
    questions.length = 0;
    questions.push(...(test.questions || []));
  };

  return div;
}

export default QuizPage;