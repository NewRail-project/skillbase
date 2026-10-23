// core/import/parser.js — разбор текстового формата теста.
// Чистая логика без DOM и Firebase: вызывается из редактора и из тестов.

export function parseQuiz(raw) {
  const structuredErrors = [];
  const questions = [];
  const lines = raw.replace(/\r/g, '').split('\n');
  let currentQuestion = null;
  let currentPoints = 1;
  let currentExplanation = null;

  const finalizeCurrent = () => {
    if (!currentQuestion) return;
    const q = currentQuestion;

    if (q.type === 'short') {
      if (!q.answer) {
        structuredErrors.push({
          line: q.lineNumber,
          questionIndex: questions.length,
          severity: 'error',
          message: `Вопрос "${q.text}" должен иметь ответ после "Ответ:"`
        });
      }
      questions.push({ ...q, points: currentPoints, explanation: currentExplanation });
      currentQuestion = null;
      currentPoints = 1;
      currentExplanation = null;
      return;
    }

    if (q.options.length < 2) {
      structuredErrors.push({
        line: q.lineNumber,
        questionIndex: questions.length,
        severity: 'error',
        message: `Вопрос "${q.text}" имеет меньше двух вариантов ответа`
      });
    }
    const correctCount = q.options.filter(o => o.correct).length;
    if (q.options.length > 10) {
      structuredErrors.push({
        line: q.lineNumber,
        questionIndex: questions.length,
        severity: 'error',
        message: `Вопрос "${q.text}" имеет больше 10 вариантов ответа`
      });
    }

    if (q.options.length >= 2) {
      if (correctCount > 1) {
        q.type = 'multiple';
      }
      if (q.type === 'single') {
        const correctOpt = q.options.find(o => o.correct);
        if (correctOpt) {
          q.answer = correctOpt.text;
        } else {
          structuredErrors.push({
            line: q.lineNumber,
            questionIndex: questions.length,
            severity: 'error',
            message: `Вопрос "${q.text}" не содержит правильного ответа`
          });
        }
      } else {
        const correctOptions = q.options.filter(o => o.correct);
        if (correctOptions.length === 0) {
          structuredErrors.push({
            line: q.lineNumber,
            questionIndex: questions.length,
            severity: 'error',
            message: `Вопрос "${q.text}" не содержит правильного ответа`
          });
        } else {
          q.answer = correctOptions.map(o => o.text);
        }
      }
    }

    const optionTexts = q.options.map(o => o.text);
    const uniqueOptions = [...new Set(optionTexts)];
    if (uniqueOptions.length < optionTexts.length) {
      structuredErrors.push({
        line: q.lineNumber,
        questionIndex: questions.length,
        severity: 'warning',
        message: `Вопрос "${q.text}" содержит одинаковые варианты ответа`
      });
    }

    if (q.options.some(o => !o.text)) {
      structuredErrors.push({
        line: q.lineNumber,
        questionIndex: questions.length,
        severity: 'warning',
        message: `Вопрос "${q.text}" содержит пустые варианты ответа`
      });
    }

    questions.push({ ...q, points: currentPoints, explanation: currentExplanation });
    currentQuestion = null;
    currentPoints = 1;
    currentExplanation = null;
  };

  const parseOptionLine = (text) => {
    let optText = text.trim();
    let correct = false;

    // Маркеры правильного ответа: [правильный], [correct], (+), [*]
    const markerRegex = /[\[(](правильный|верный|correct|плюс|\+|\*)[\])]/gi;
    if (markerRegex.test(optText)) {
      correct = true;
      optText = optText.replace(markerRegex, '').trim();
    }

    // Также допускается звёздочка в конце строки: "Вариант *"
    if (/(^|\s)\*\s*$/.test(optText)) {
      correct = true;
      optText = optText.replace(/\s*\*\s*$/, '').trim();
    }

    return { text: optText.trim(), correct };
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.toLowerCase().startsWith('баллы:')) {
      const pointsMatch = trimmed.match(/баллы:\s*(\d+(\.\d+)?)/i);
      if (pointsMatch) {
        currentPoints = parseFloat(pointsMatch[1]);
        continue;
      }
    }

    if (trimmed.toLowerCase().startsWith('пояснение:')) {
      currentExplanation = trimmed.substring('пояснение:'.length).trim();
      continue;
    }

    const oMatch = trimmed.match(/^([A-JА-Е])[\.\):]\s*(.+)/i);

    if (oMatch) {
      if (currentQuestion) {
        const opt = parseOptionLine(oMatch[2]);
        currentQuestion.options.push(opt);
      } else {
        structuredErrors.push({
          line: i + 1,
          questionIndex: null,
          severity: 'error',
          message: `Строка ${i + 1}: вариант без вопроса – "${trimmed}"`
        });
      }
      continue;
    }

    const qMatch = trimmed.match(/^(\d+)[\.\)]\s*(.+)/);

    if (qMatch) {
      if (currentQuestion) {
        finalizeCurrent();
      }
      const rawText = qMatch[2];
      const answerIdx = rawText.toLowerCase().indexOf('ответ:');
      let answer = null;
      let qText = rawText;
      let type = 'single';

      if (answerIdx !== -1) {
        answer = rawText.substring(answerIdx + 'ответ:'.length).trim();
        qText = rawText.substring(0, answerIdx).trim();
        type = 'short';
      }

      currentQuestion = {
        type,
        text: qText,
        options: [],
        answer,
        lineNumber: i + 1
      };
      continue;
    }

    structuredErrors.push({
      line: i + 1,
      questionIndex: null,
      severity: 'error',
      message: `Строка ${i + 1}: неожиданный формат – "${trimmed}"`
    });
  }

  if (currentQuestion) {
    finalizeCurrent();
  }

  const errors = structuredErrors.filter(e => e.severity === 'error').map(e => e.message);

  return { questions, errors, structuredErrors };
}
