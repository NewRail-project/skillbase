// core/test-storage.js — чистое преобразование теста для Firestore.
// Публичный документ tests хранит вопросы без правильных ответов,
// закрытый документ testKeys — ключи и баллы. Модуль не зависит от Firebase,
// поэтому его можно проверять в Node.

import { questionPoints } from "./scoring.js";

// Делит тест на публичную часть и ключи.
export function splitForStorage(test) {
  const publicQuestions = [];
  const items = {};
  const questions = Array.isArray(test?.questions) ? test.questions : [];

  questions.forEach((question, index) => {
    const type = question?.type || "single";
    const points = questionPoints(question);

    // Firestore не принимает undefined: необязательные поля добавляем только при наличии.
    const publicQuestion = {
      type,
      text: question?.text ?? "",
      options: type === "short"
        ? []
        : (Array.isArray(question?.options) ? question.options : []).map((option) => ({
            text: option?.text ?? ""
          })),
      points,
      required: question?.required === true
    };

    if (typeof question?.image === "string" && question.image) {
      publicQuestion.image = question.image;
    }

    publicQuestions.push(publicQuestion);

    if (type === "short") {
      items[String(index)] = { type, points, answer: String(question?.answer ?? "") };
    } else {
      const correct = [];
      (Array.isArray(question?.options) ? question.options : []).forEach((option, optionIndex) => {
        if (option?.correct === true) correct.push(optionIndex);
      });
      items[String(index)] = { type, points, correct };
    }
  });

  const rest = test && typeof test === "object" ? { ...test } : {};
  delete rest.questions;

  return { publicTest: { ...rest, questions: publicQuestions }, keys: items };
}

// Возвращает правильные ответы в вопросы (только для автора теста).
export function mergeKeys(publicTest, items) {
  const questions = (publicTest?.questions || []).map((question, index) => {
    const key = items?.[String(index)];
    if (!key) return question;

    if (question.type === "short") {
      return { ...question, answer: key.answer ?? "" };
    }

    const correct = new Set(Array.isArray(key.correct) ? key.correct : []);
    return {
      ...question,
      options: (question.options || []).map((option, optionIndex) => ({
        ...option,
        correct: correct.has(optionIndex)
      }))
    };
  });

  return { ...publicTest, questions };
}
