import { useState, useEffect } from 'https://unpkg.com/react@18/umd/react.development.js'
import { useNetworkState } from 'https://unpkg.com/react-network-state@1.0.0/dist/index.js';
import { useAuth } from '../authContext.js';
import { saveTest, parseQuizText, getCurrentTest, updateTest, publishTest, loadTest } from '../../core/editor.js';

// UI компонент редактора тестов
export default function EditorComponent() {
  const { user } = useAuth();
  const isOnline = useNetworkState();
  const [quizText, setQuizText] = useState('');
  const [questions, setQuestions] = useState([]);
  const [isParsed, setIsParsed] = useState(false);
  const [isEditingQuestion, setIsEditingQuestion] = useState(null);
  const [newQuestionText, setNewQuestionText] = useState('');
  const [newOptionText, setNewOptionText] = useState('');
  const [newQuestionType, setNewQuestionType] = useState('single');
  const [currentTest, setCurrentTest] = useState(null);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  // Загрузка текущего теста при монтировании компонента
  useEffect(() => {
    if (!user) return;
    
    const loadTestData = async () => {
      try {
        const testId = user.uid;
        const loadedTest = await loadTest(testId);
        if (loadedTest) {
          setCurrentTest(loadedTest);
          setQuestions(loadedTest.questions);
          setIsParsed(true);
        }
      } catch (err) {
        console.error('Ошибка загрузки теста:', err);
      }
    };
    loadTestData();
  }, [user]);

  // Обработка кнопки "Разобрать"
  const handleParseQuiz = async () => {
    if (!quizText.trim()) {
      setError('Пожалуйста, введите текст теста');
      return;
    }
    
    try {
      setIsSaving(true);
      const parsed = await parseQuizText(quizText);
      setQuestions(parsed.questions);
      setIsParsed(true);
      setError(null);
      setLastSaved(new Date());
    } catch (err) {
      setError('Ошибка разбора теста: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Обработка добавления вопроса
  const handleAddQuestion = () => {
    if (!newQuestionText.trim()) {
      setError('Вопрос не может быть пустым');
      return;
    }
    
    const newQuestion = {
      text: newQuestionText,
      options: [],
      type: newQuestionType,
      answer: null
    };
    
    setQuestions([...questions, newQuestion]);
    setNewQuestionText('');
    setNewQuestionType('single');
    setError(null);
    
    // Автосохранение после добавления вопроса
    if (currentTest?.id) {
      handleSave();
    }
  };

  // Обработка удаления вопроса
  const handleRemoveQuestion = (index) => {
    const updatedQuestions = questions.filter((_, i) => i !== index);
    setQuestions(updatedQuestions);
    
    // Автосохранение после удаления вопроса
    if (currentTest?.id) {
      handleSave();
    }
  };

  // Обработка редактирования вопроса
  const handleEditQuestion = (index) => {
    const question = questions[index];
    setNewQuestionText(question.text);
    setIsEditingQuestion(index);
    setNewQuestionType(question.type);
  };

  // Обработка сохранения редактирования вопроса
  const handleSaveEditedQuestion = (index) => {
    if (!newQuestionText.trim()) {
      setError('Вопрос не может быть пустым');
      return;
    }
    
    const updatedQuestions = questions.map((q, i) => {
      if (i === index) {
        return {
          ...q,
          text: newQuestionText,
          answer: q.answer
        };
      }
      return q;
    });
    
    setQuestions(updatedQuestions);
    setIsEditingQuestion(null);
    setNewQuestionText('');
    setError(null);
    
    // Автосохранение после редактирования вопроса
    if (currentTest?.id) {
      handleSave();
    }
  };
  // Обработка изменения вариантов ответа
  const handleAddOption = (index) => {
    if (!newOptionText.trim()) {
      setError('Вариант ответа не может быть пустым');
      return;
    }
    
    const updatedQuestions = questions.map((q, i) => {
      if (i === index) {
        const correct = q.options.some(opt => opt.correct);
        return {
          ...q,
          options: [...q.options, { text: newOptionText.trim(), correct }]
        };
      }
      return q;
    });
    
    setQuestions(updatedQuestions);
    setNewOptionText('');
    setError(null);
    
    // Автосохранение после добавления варианта
    if (currentTest?.id) {
      handleSave();
    }
  };
  // Обработка изменения правильного ответа
  const handleMarkCorrect = (questionIndex, optionIndex) => {
    const updatedQuestions = questions.map((q, i) => {
      if (i === questionIndex) {
        const updatedOptions = q.options.map((opt, optIndex) => {
          if (optIndex === optionIndex) {
            return { ...opt, correct: !opt.correct };
          }
          return opt;
        });
        return {
          ...q,
          options: updatedOptions
        };
      }
      return q;
    });
    
    setQuestions(updatedQuestions);
    
    // Автосохранение после изменения правильного ответа
    if (currentTest?.id) {
      handleSave();
    }
  };
  // Обработка сохранения теста
  const handleSave = async () => {
    if (!isOnline) {
      setError('Нет подключения к интернету. Данные будут сохранены локально.');
      return;
    }
    
    try {
      setIsSaving(true);
      if (!currentTest?.id) {
        // Создание нового теста
        const newTestId = user.uid + Date.now();
        const testData = {
          id: newTestId,
          questions: questions,
          timePerQuestion: currentTest?.timePerQuestion || 10,
          attempts: currentTest?.attempts || 3,
          shuffleOptions: currentTest?.shuffleOptions || true,
          shuffleQuestions: currentTest?.shuffleQuestions || true,
          status: 'draft',
          testKeys: []
        };
        
        await saveTest(newTestId);
        setCurrentTest(testData);
        setError(null);
      } else {
        // Обновление существующего теста
        await saveTest(currentTest.id);
        setError(null);
      }
      setLastSaved(new Date());
    } catch (err) {
      setError('Ошибка сохранения теста: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Обработка публикации теста
  const handlePublish = async () => {
    if (!currentTest?.id) {
      setError('Тест не сохранён');
      return;
    }
    
    if (!isOnline) {
      setError('Нет подключения к интернету. Публикация невозможна.');
      return;
    }
    
    try {
      setIsSaving(true);
      const versionId = await publishTest(currentTest.id);
      setError(null);
      alert('Тест успешно опубликован в версии ' + versionId);
      setLastSaved(new Date());
    } catch (err) {
      setError('Ошибка публикации теста: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Обработка изменения типа вопроса
  const handleQuestionTypeChange = (index, type) => {
    const updatedQuestions = questions.map((q, i) => {
      if (i === index) {
        return {
          ...q,
          type
        };
      }
      return q;
    });
    
    setQuestions(updatedQuestions);
    
    // Автосохранение после изменения типа вопроса
    if (currentTest?.id) {
      handleSave();
    }
  };
  // Обработка изменения времени на вопрос
  const handleTimeChange = (e) => {
    const time = parseInt(e.target.value) || 10;
    updateTest({ timePerQuestion: time });
    
    // Автосохранение после изменения времени
    if (currentTest?.id) {
      handleSave();
    }
  };
  // Обработка изменения количества попыток
  const handleAttemptsChange = (e) => {
    const attempts = parseInt(e.target.value) || 3;
    updateTest({ attempts });
    
    // Автосохранение после изменения количества попыток
    if (currentTest?.id) {
      handleSave();
    }
  };
  // Обработка переключения статуса
  const handleStatusChange = (e) => {
    updateTest({ status: e.target.value });
    
    // Автосохранение после изменения статуса
    if (currentTest?.id) {
      handleSave();
    }
  };
  return (
    <div className="editor-container">
      <h2>Создание теста</h2>
      {!isOnline && <div className="error-msg">Вы работаете в оффлайн-режиме. Изменения будут сохранены локально.</div>}
      {error && <div className="error-msg">{error}</div>}
      {lastSaved && <div className="success-msg">Последнее сохранение: {lastSaved.toLocaleTimeString()}</div>}
      {isSaving && <div className="info-msg">Сохранение...</div>}
      
      <div className="quiz-input">
        <textarea
          value={quizText}
          onChange={(e) => setQuizText(e.target.value)}
          placeholder="Введите текст теста..."
        />
        <button onClick={handleParseQuiz} disabled={isSaving}>Разобрать</button>
      </div>
      
      {isParsed && (
        <div className="questions-list">
          <h3>Вопросы:</h3>
          {questions.map((question, index) => (
            <div key={index} className="question">
              <div className="question-text">
                <input
                  type="text"
                  value={newQuestionText}
                  onChange={(e) => setNewQuestionText(e.target.value)}
                  placeholder="Редактировать вопрос..."
                  onFocus={() => handleEditQuestion(index)}
                />
                {isEditingQuestion === index && (
                  <button onClick={() => handleSaveEditedQuestion(index)}>Сохранить</button>
                )}
                <p>{question.text}</p>
              </div>
              <div className="question-actions">
                <button onClick={() => handleRemoveQuestion(index)}>Удалить</button>
                <select
                  value={question.type}
                  onChange={(e) => handleQuestionTypeChange(index, e.target.value)}
                >
                  <option value="single">Один правильный ответ</option>
                  <option value="multiple">Несколько правильных ответов</option>
                  <option value="short">Краткий ответ</option>
                </select>
              </div>
            </div>
          ))}
          
          {newQuestionText && (
            <div className="new-question">
              <input
                type="text"
                value={newQuestionText}
                onChange={(e) => setNewQuestionText(e.target.value)}
                placeholder="Введите новый вопрос..."
              />
              <select
                value={newQuestionType}
                onChange={(e) => setNewQuestionType(e.target.value)}
              >
                <option value="single">Один правильный ответ</option>
                <option value="multiple">Несколько правильных ответов</option>
                <option value="short">Краткий ответ</option>
              </select>
              <button onClick={handleAddQuestion}>Добавить</button>
            </div>
          )}
          
          {questions.map((question, index) => (
            <div key={index + 'options'} className="question-options">
              {question.options.map((option, optIndex) => (
                <div key={optIndex} className="option">
                  <input
                    type="text"
                    value={option.text}
                    onChange={(e) => {
                      const updatedQuestions = questions.map((q, i) => {
                        if (i === index) {
                          return {
                            ...q,
                            options: q.options.map((opt, oi) => {
                              if (oi === optIndex) {
                                return { ...opt, text: e.target.value };
                              }
                              return opt;
                            })
                          };
                        }
                        return q;
                      });
                      setQuestions(updatedQuestions);
                    }}
                    placeholder="Вариант ответа"
                  />
                  <button onClick={() => handleMarkCorrect(index, optIndex)}>
                    {option.correct ? '[+]' : '[']}
                  </button>
                </div>
              ))}
              <input
                type="text"
                value={newOptionText}
                onChange={(e) => setNewOptionText(e.target.value)}
                placeholder="Добавить вариант ответа"
                onFocus={() => setIsEditingQuestion(index)}
              />
              <button onClick={() => handleAddOption(index)}>Добавить вариант</button>
            </div>
          ))}
        </div>
      )}
      
      <div className="settings">
        <h3>Настройки:</h3>
        <div>
          <label>Время на вопрос (сек): <input type="number" value={currentTest?.timePerQuestion || 10} onChange={handleTimeChange} /></label>
        </div>
        <div>
          <label>Количество попыток: <input type="number" value={currentTest?.attempts || 3} onChange={handleAttemptsChange} /></label>
        </div>
        <div>
          <label>Перемешать варианты: <input type="checkbox" checked={currentTest?.shuffleOptions || true} onChange={(e) => updateTest({ shuffleOptions: e.target.checked })} /></label>
        </div>
        <div>
          <label>Перемешать вопросы: <input type="checkbox" checked={currentTest?.shuffleQuestions || true} onChange={(e) => updateTest({ shuffleQuestions: e.target.checked })} /></label>
        </div>
        <div>
          <label>Статус: <select value={currentTest?.status || 'draft'} onChange={handleStatusChange}>
            <option value="draft">Безопасность</option>
            <option value="published">Опубликовано</option>
          </select>
          </label>
        </div>
      </div>
      
      <div className="actions">
        <button onClick={handleSave} disabled={isSaving}>Сохранить</button>
        <button onClick={handlePublish} disabled={isSaving || currentTest?.status === 'published' || !isOnline}>Опубликовать</button>
      </div>
    </div>
  );
}