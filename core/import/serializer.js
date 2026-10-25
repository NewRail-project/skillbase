// core/import/serializer.js — обратное преобразование теста в текстовый формат.
// Нужно для редактирования уже сохранённого теста в том же редакторе.

function oneLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function serializeTest(test) {
  const questions = Array.isArray(test?.questions) ? test.questions : [];

  return questions.map((question, index) => {
    const lines = [];
    const type = question?.type || "single";
    const text = oneLine(question?.text) || `Вопрос ${index + 1}`;

    if (type === "short") {
      lines.push(`${index + 1}. ${text} Ответ: ${oneLine(question?.answer)}`);
    } else {
      lines.push(`${index + 1}. ${text}`);
      const options = Array.isArray(question?.options) ? question.options : [];
      options.forEach((option, optionIndex) => {
        const label = String.fromCharCode(65 + optionIndex);
        lines.push(`${label}) ${oneLine(option?.text)}${option?.correct ? " [+]" : ""}`);
      });
    }

    const points = Number(question?.points);
    if (Number.isFinite(points) && points > 0 && points !== 1) {
      lines.push(`Баллы: ${points}`);
    }

    if (question?.explanation) {
      lines.push(`Пояснение: ${oneLine(question.explanation)}`);
    }

    return lines.join("\n");
  }).join("\n\n");
}
