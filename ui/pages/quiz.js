// ui/pages/quiz.js
import { useState, useEffect } from 'https://unpkg.com/react@18/umd/react.development.js';
import { startAttempt, saveAnswer, finishAttempt } from '../../core/quiz.js';

export default function QuizComponent({ testId }) {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [attemptId, setAttemptId] = useState(null);
  const [timer, setTimer] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [questions, setQuestions] = useState([]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const loadQuestions = async () => {
      const test = await loadTest(testId);
      setQuestions(test.questions);
    };
    loadQuestions();
  }, [testId]);

  const startQuiz = async () => {
    const newAttemptId = await startAttempt(user.uid, testId);
    setAttemptId(newAttemptId);
    setTimer(10);
    setInterval(() => setTimer(t => t - 1), 1000);
  };

  const handleAnswer = (index, answer) => {
    if (!isOnline) {
      saveAnswer(attemptId, index, answer);
    } else {
      saveAnswer(attemptId, index, answer);
      setAnswers({...answers, [index]: answer});
    }
  };

  const nextQuestion = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else {
      finishAttempt(attemptId, testId);
      setIsFinished(true);
    }
  };

  if (!isFinished) {
    return (
      <div className="quiz-container">
        <div className="timer">{timer} сек.</div>
        <div className="question">
          <h2>{questions[currentQuestionIndex]?.text}</h2>
          <div className="options">
            {questions[currentQuestionIndex]?.options?.map((option, index) => (
              <div
                key={index}
                className={`option ${answers[currentQuestionIndex] === option.text ? 'selected' : ''}`}
                onClick={() => handleAnswer(currentQuestionIndex, option.text)}
              >
                {option.text}
              </div>
            ))}
          </div>
        </div>
        <button onClick={nextQuestion}>Следующий</button>
      </div>
    );
  } else {
    return (
      <div className="results">
        <h2>Результаты</h2>
        <p>Ваш результат: {results.score} из {questions.length}</p>
        <div className="errors">
          <h3>Разбор ошибок:</h3>
          {results.results?.map((result, i) => (
            <div key={i}>
              <p>Вопрос {i + 1}: {questions[i].text}</p>
              <p>Ваш ответ: {answers[i] || 'Не отвечено'}</p>
              <p>Правильный: {result.correct}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }
}