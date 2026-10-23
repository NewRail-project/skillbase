module.exports.emptyTest = function emptyTest() {
  return {
    id: null,
    title: "",
    description: "",
    instructions: "",
    category: "",
    color: "",
    authorId: "",
    orgId: "",
    status: "draft",
    mode: "self",
    questions: [],
    settings: {
      shuffleQuestions: true,
      shuffleOptions: true,
      timePerQuestion: null,
      totalTime: null,
      onQuestionTimeout: "skip",
      onTotalTimeout: "autosubmit",
      passScore: null,
      attemptsLimit: 3,
      allowRetake: false,
      answerPolicy: "never",
      showLeaderboard: false,
      showCorrectAfterQuestion: false
    },
    version: 1,
    createdAt: null,
    updatedAt: null,
    publishedAt: null
  };
}

module.exports.validateTest = function validateTest(test, { publishing } = {}) {
  const errors = [];
  const warnings = [];

  // Проверка на наличие названия
  if (!test.title || typeof test.title !== 'string') {
    errors.push("Тест должен иметь название");
  }

  // Проверка на наличие вопросов
  if (!test.questions || test.questions.length === 0) {
    errors.push("Тест должен содержать вопросы");
  }

  // Проверка на правильность вопросов
  test.questions.forEach((question, index) => {
    if (!question.text || typeof question.text !== 'string') {
      errors.push(`Вопрос ${index + 1}: отсутствует текст");
    }
    if (question.type === 'single' && question.options.length !== 1) {
      errors.push(`Вопрос ${index + 1}: тип single должен иметь ровно один вариант ответа");
    }
    if (question.type === 'multiple' && question.options.length < 2) {
      errors.push(`Вопрос ${index + 1}: тип multiple должен иметь хотя бы два варианта ответа");
    }
    if (question.type === 'short' && !question.answer) {
      errors.push(`Вопрос ${index + 1}: тип short должен иметь ответ");
    }
    if (question.points <= 0) {
      errors.push(`Вопрос ${index + 1}: баллы должны быть больше 0");
    }
  });

  // Проверка на правильность режима и настроек
  if (test.mode === 'self' && !test.settings.passScore) {
    errors.push("Для режима self должен быть задан проходной балл");
  }

  // Проверка на корректность времени
  if (test.settings.timePerQuestion || test.settings.totalTime) {
    if (!Number.isInteger(test.settings.timePerQuestion) || test.settings.timePerQuestion < 5 || test.settings.timePerQuestion > 3600) {
      errors.push("Время на вопрос должно быть целым числом от 5 до 3600 секунд");
    }
    if (!Number.isInteger(test.settings.totalTime) || test.settings.totalTime < 30 || test.settings.totalTime > 28800) {
      errors.push("Общее время теста должно быть целым числом от 30 до 28800 секунд");
    }
    if (test.settings.timePerQuestion && test.settings.totalTime) {
      const totalTime = test.questions.length * test.settings.timePerQuestion;
      if (totalTime > test.settings.totalTime) {
        warnings.push("Общее время теста меньше суммы времени на вопросы");
      }
    }
  }

  // Проверка на корректность проходного балла
  if (test.settings.passScore && (test.settings.passScore < 1 || test.settings.passScore > 100)) {
    errors.push("Проходной балл должен быть числом от 1 до 100");
  }

  // Проверка на ограничение количества попыток
  if (test.settings.attemptsLimit && (test.settings.attemptsLimit < 1 || test.settings.attemptsLimit > 50)) {
    errors.push("Количество попыток должно быть числом от 1 до 50");
  }

  // Проверка на ограничение размера документа
  const sizeLimit = 700; // КБ
  const jsonSize = JSON.stringify(test).length / 1024;
  if (jsonSize > sizeLimit) {
    warnings.push(`Тест превышает размер ${sizeLimit} КБ`);
  }

  return { errors, warnings };
};