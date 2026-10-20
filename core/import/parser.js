// core/import/parser.js
export function parseQuiz(raw) {
  const errors = [];
  const questions = [];
  const lines = raw.replace(/\r/g, '').split('\n');
  let currentQuestion = null;

  const finalizeCurrent = () => {
    if (!currentQuestion) return;
    const q = currentQuestion;

    if (q.type === 'short') {
      if (!q.answer) {
        errors.push(`Вопрос "${q.text}" должен иметь ответ после "Ответ:"`);
      }
      questions.push(q);
      currentQuestion = null;
      return;
    }

    if (q.options.length < 2) {
      errors.push(`Вопрос "${q.text}" имеет меньше двух вариантов ответа`);
    }
    const correctCount = q.options.filter(o => o.correct).length;
    if (correctCount === 0) {
      errors.push(`Вопрос "${q.text}" не содержит правильного ответа`);
    }

    if (q.options.length > 0) {
      if (correctCount > 1) {
        q.type = 'multiple';
      }
      if (q.type === 'single') {
        const correctOpt = q.options.find(o => o.correct);
        if (correctOpt) {
          q.answer = correctOpt.text;
        }
      } else {
        q.answer = q.options.filter(o => o.correct).map(o => o.text);
      }
    }
    questions.push(q);
    currentQuestion = null;
  };

  const parseOptionLine = (text) => {
    let optText = text;
    let correct = false;

    const markerRegex = /\[(правильный|верный|correct|плюс|\+)\]/gi;
    const starMarker = /\*\s*$/;
    
    if (markerRegex.test(optText) || starMarker.test(optText)) {
      correct = true;
      optText = optText.replace(markerRegex, '').replace(starMarker, '').trim();
    }
    return { text: optText.trim(), correct };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check if it's an option line (starts with A-F or А-Е followed by . ) :)
    const oMatch = trimmed.match(/^([A-FА-Е])[\.\):]\s*(.+)/i);
    // Check if it's a question line (starts with digits followed by . ) )
    const qMatch = trimmed.match(/^(\d+)[\.\)]\s*(.+)/);

    if (oMatch) {
      if (currentQuestion) {
        const opt = parseOptionLine(oMatch[2]);
        currentQuestion.options.push(opt);
      } else {
        errors.push(`Строка ${i + 1}: вариант без вопроса – "${trimmed}"`);
      }
      continue;
    }

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

    errors.push(`Строка ${i + 1}: неожиданный формат – "${trimmed}"`);
  }

  if (currentQuestion) {
    finalizeCurrent();
  }

  return { questions, errors };
}
