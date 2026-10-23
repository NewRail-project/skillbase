export function emptyTest() {
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

// Единый источник правил для сохранения черновика и публикации.
// publishing=true включает требования, без которых тест нельзя публиковать.
export function validateTest(test, { publishing = false } = {}) {
  const errors = [];
  const warnings = [];

  if (!test || typeof test !== "object") {
    return { errors: ["Некорректные данные теста"], warnings };
  }

  const rawSettings = test.settings;
  let settings = {};
  if (rawSettings === undefined || rawSettings === null) {
    settings = {};
  } else if (typeof rawSettings !== "object" || Array.isArray(rawSettings)) {
    errors.push("Настройки теста должны быть объектом");
  } else {
    settings = rawSettings;
  }

  if (test.questions !== undefined && !Array.isArray(test.questions)) {
    errors.push("Список вопросов повреждён");
  }
  const questions = Array.isArray(test.questions) ? test.questions : [];

  if (typeof test.title !== "string" || !test.title.trim()) {
    errors.push("Тест должен иметь название");
  } else if (test.title.trim().length > 120) {
    errors.push("Название теста не должно превышать 120 символов");
  }

  if (!questions.length) {
    errors.push("Тест должен содержать вопросы");
  }

  questions.forEach((question, index) => {
    const n = index + 1;
    if (!question || typeof question !== "object") {
      errors.push(`Вопрос ${n}: некорректные данные`);
      return;
    }

    if (typeof question.text !== "string" || !question.text.trim()) {
      errors.push(`Вопрос ${n}: отсутствует текст`);
    }

    const options = Array.isArray(question.options) ? question.options : [];
    const correctCount = options.filter(option => option?.correct === true).length;

    if (question.type === "single") {
      if (options.length < 2) {
        errors.push(`Вопрос ${n}: добавьте минимум два варианта ответа`);
      }
      if (correctCount !== 1) {
        errors.push(`Вопрос ${n}: укажите ровно один правильный вариант`);
      }
    } else if (question.type === "multiple") {
      if (options.length < 2) {
        errors.push(`Вопрос ${n}: тип multiple должен иметь хотя бы два варианта ответа`);
      }
      if (correctCount < 2) {
        errors.push(`Вопрос ${n}: отметьте минимум два правильных варианта`);
      }
    } else if (question.type === "short") {
      if (typeof question.answer !== "string" || !question.answer.trim()) {
        errors.push(`Вопрос ${n}: тип short должен иметь ответ`);
      }
    } else {
      errors.push(`Вопрос ${n}: неизвестный тип вопроса`);
    }

    if (question.type !== "short") {
      options.forEach((option, optionIndex) => {
        if (typeof option?.text !== "string" || !option.text.trim()) {
          errors.push(`Вопрос ${n}: вариант ${optionIndex + 1} пуст`);
        }
      });
    }

    if (!Number.isFinite(question.points) || question.points <= 0) {
      errors.push(`Вопрос ${n}: баллы должны быть числом больше 0`);
    }
  });

  // Проходной балл необязателен: в emptyTest он по умолчанию null.
  // Если значение задано, оно должно быть корректным.
  if (settings.passScore != null &&
      (!Number.isFinite(settings.passScore) ||
       settings.passScore < 1 || settings.passScore > 100)) {
    errors.push("Проходной балл должен быть числом от 1 до 100");
  }

  const timePerQuestion = settings.timePerQuestion;
  const totalTime = settings.totalTime;

  if (timePerQuestion != null &&
      (!Number.isInteger(timePerQuestion) ||
       timePerQuestion < 5 || timePerQuestion > 3600)) {
    errors.push("Время на вопрос должно быть целым числом от 5 до 3600 секунд");
  }

  if (totalTime != null &&
      (!Number.isInteger(totalTime) ||
       totalTime < 30 || totalTime > 28800)) {
    errors.push("Общее время теста должно быть целым числом от 30 до 28800 секунд");
  }

  if (timePerQuestion != null && totalTime != null &&
      questions.length * timePerQuestion > totalTime) {
    warnings.push("Общее время теста меньше суммы времени на вопросы");
  }

  if (settings.attemptsLimit != null &&
      (!Number.isInteger(settings.attemptsLimit) ||
       settings.attemptsLimit < 1 || settings.attemptsLimit > 50)) {
    errors.push("Количество попыток должно быть целым числом от 1 до 50");
  }

  const sizeLimit = 700;
  const jsonSize = JSON.stringify(test).length / 1024;
  if (jsonSize > sizeLimit) {
    const message = `Тест превышает размер ${sizeLimit} КБ`;
    if (publishing) errors.push(message);
    else warnings.push(message);
  }

  if (questions.length > 200) {
    if (publishing) errors.push("В тесте не может быть больше 200 вопросов");
    else warnings.push("В черновике больше 200 вопросов: опубликовать его не получится");
  }

  return { errors, warnings };
}
