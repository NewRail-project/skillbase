import { State } from "../../core/auth.js";
import { loadTest, getTestKeys } from "../../core/editor.js";
import { createAttempt, updateAttempt, finishAttempt } from "../../core/assign.js";

// DOM-элемент для теста
export default function QuizPage() {
  const div = document.createElement("div");
  div.className = "quiz-container";
  const questions = [];
  let timer = 10;
  let currentQuestionIndex = 0;
  let answers = {};
  let isOnline = navigator.onLine;
  let attemptId = null;
  let isFinished = false;
  let testId = null;

  window.addEventListener("online", () => { isOnline = true; });
  window.addEventListener("offline", () => { isOnline = false; });

  // Загрузка теста и ключей
  const loadQuestions = async () => {
    const test = await loadTest(testId);
    questions.length = 0;
    questions.push(...(test.questions || []));
    timer = test.timePerQuestion || 10;
    renderQuestion();
  };

  // Начало попытки
  const startAttempt = async () => {
    if (!State.user) return;
    attemptId = await createAttempt(testId, State.user.uid);
    await loadQuestions();
  };

  // Сохранение ответа
  const saveAnswer = async (questionIndex, answer) => {
    if (!attemptId) return;
    answers[questionIndex] = answer;
    await updateAttempt(attemptId, questionIndex, answer, testId);
  };

  // Завершение попытки
  const finishQuiz = async () => {
    if (!attemptId) return;
    await finishAttempt(attemptId, testId);
    isFinished = true;
    renderResults();
  };

  // Рендеринг вопроса
  const renderQuestion = () => {
    if (isFinished) return;
    const question = questions[currentQuestionIndex];
    if (!question) return;

    div.innerHTML = `
      <div class="question">
        <h2>Вопрос ${currentQuestionIndex + 1} из ${questions.length}</h2>
        <p>${question.text}</p>
        <div class="options">
          ${question.options.map((option, index) => `
            <label>
              <input type="${question.type === 'multiple' ? 'checkbox' : 'radio'}" name="answer" value="${index}" ${answers[currentQuestionIndex] === index ? 'checked' : ''}> ${option.text}
            </label>
          `).join('')}
        </div>
        <div class="timer">Осталось: ${timer} сек</div>
        <div class="navigation">
          <button class="secondary" ${currentQuestionIndex === 0 ? 'disabled' : ''}>Назад</button>
          <button class="primary">${currentQuestionIndex === questions.length - 1 ? 'Завершить' : 'Далее'}</button>
        </div>
      </div>
    `;

    // Обработчики событий
    const nextBtn = div.querySelector('.navigation .primary');
    const prevBtn = div.querySelector('.navigation .secondary');

    nextBtn.addEventListener('click', async () => {
      const selected = div.querySelector('input[name="answer"]:checked');
      if (selected) {
        await saveAnswer(currentQuestionIndex, parseInt(selected.value));
      }
      if (currentQuestionIndex < questions.length - 1) {
        currentQuestionIndex++;
        renderQuestion();
      } else {
        await finishQuiz();
      }
    });

    prevBtn.addEventListener('click', () => {
      if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        renderQuestion();
      }
    });

    // Таймер
    const timerElement = div.querySelector('.timer');
    const interval = setInterval(() => {
      timer--;
      timerElement.textContent = `Осталось: ${timer} сек`;
      if (timer <= 0) {
        clearInterval(interval);
        nextBtn.click();
      }
    }, 1000);
  };

  // Рендеринг результатов
  const renderResults = async () => {
    const testKeys = await getTestKeys(testId);
    let score = 0;
    questions.forEach((question, index) => {
      const correctAnswers = question.options.filter(option => option.correct).map((_, i) => i);
      if (answers[index] === correctAnswers[0]) {
        score++;
      }
    });

    div.innerHTML = `
      <div class="results">
        <h2>Результаты</h2>
        <p>Вы набрали ${score} из ${questions.length} баллов.</p>
        <a href="#profile"><button class="primary">Вернуться в профиль</button></a>
      </div>
    `;
  };

  // Инициализация
  const init = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    testId = urlParams.get('testId');
    if (!testId) {
      div.innerHTML = '<div class="error">Тест не найден</div>';
      return;
    }

    if (!State.user) {
      div.innerHTML = '<div class="error">Нужно войти в аккаунт</div>';
      return;
    }

    await startAttempt();
  };

  init();
  return div;
}