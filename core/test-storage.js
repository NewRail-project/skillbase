// core/test-storage.js — чистое преобразование теста для Firestore.
// Публичный документ tests хранит вопросы без правильных ответов,
// закрытый документ testKeys — ключи и баллы. Модуль не зависит от Firebase,
// поэтому его можно проверять в Node.

import { questionPoints } from "./scoring.js";

// Поля публичного документа tests. Всё остальное в публичную часть не попадает:
// старые документы и импортированные объекты могли содержать ключи ответов.
const PUBLIC_TEST_FIELDS = [
  "id", "title", "description", "instructions", "category", "color",
  "authorId", "orgId", "status", "mode", "settings", "version",
  "createdAt", "updatedAt", "publishedAt"
];

function publicQuestion(question) {
  const type = question?.type || "single";

  // Firestore не принимает undefined: необязательные поля добавляем только при наличии.
  const result = {
    type,
    text: question?.text ?? "",
    options: type === "short"
      ? []
      : (Array.isArray(question?.options) ? question.options : []).map((option) => ({
          text: option?.text ?? ""
        })),
    points: questionPoints(question),
    required: question?.required === true
  };

  if (typeof question?.image === "string" && question.image) {
    result.image = question.image;
  }

  return result;
}

// Убирает из прочитанного теста всё, что не должно быть доступно ученику:
// correct/answer/explanation, служебные поля вопросов и лишние поля документа.
// Нужен для совместимости со старыми документами, где ключи могли лежать
// прямо в публичной части.
export function sanitizePublicTest(test) {
  const source = test && typeof test === "object" ? test : {};
  const clean = {};

  PUBLIC_TEST_FIELDS.forEach((field) => {
    if (source[field] !== undefined) clean[field] = source[field];
  });

  clean.questions = (Array.isArray(source.questions) ? source.questions : [])
    .map(publicQuestion);

  return clean;
}

// Делит тест на публичную часть и ключи.
export function splitForStorage(test) {
  const items = {};
  const questions = Array.isArray(test?.questions) ? test.questions : [];

  questions.forEach((question, index) => {
    const type = question?.type || "single";
    const points = questionPoints(question);
    // Пояснение может раскрывать правильный ответ, поэтому храним его только
    // в закрытом testKeys и возвращаем сотруднику через mergeKeys.
    const explanation = typeof question?.explanation === "string" && question.explanation.trim()
      ? question.explanation
      : "";

    if (type === "short") {
      items[String(index)] = {
        type, points, answer: String(question?.answer ?? ""),
        ...(explanation ? { explanation } : {})
      };
    } else {
      const correct = [];
      (Array.isArray(question?.options) ? question.options : []).forEach((option, optionIndex) => {
        if (option?.correct === true) correct.push(optionIndex);
      });
      items[String(index)] = {
        type, points, correct,
        ...(explanation ? { explanation } : {})
      };
    }
  });

  const rest = test && typeof test === "object" ? { ...test } : {};
  delete rest.questions;

  return {
    publicTest: sanitizePublicTest({ ...rest, questions }),
    keys: items
  };
}

// Возвращает правильные ответы в вопросы (только для автора теста).
export function mergeKeys(publicTest, items) {
  const questions = (publicTest?.questions || []).map((question, index) => {
    const key = items?.[String(index)];
    if (!key) return question;

    const explanation = typeof key.explanation === "string" && key.explanation
      ? { explanation: key.explanation }
      : {};

    if (question.type === "short") {
      return { ...question, ...explanation, answer: key.answer ?? "" };
    }

    const correct = new Set(Array.isArray(key.correct) ? key.correct : []);
    return {
      ...question,
      ...explanation,
      options: (question.options || []).map((option, optionIndex) => ({
        ...option,
        correct: correct.has(optionIndex)
      }))
    };
  });

  return { ...publicTest, questions };
}


// Номер версии теста из произвольного значения: целое число >= 1 или null.
export function normalizeTestVersion(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 1 ? value : null;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return n >= 1 ? n : null;
  }
  return null;
}

// Выбирает ключи для проверки попытки: снимок версии, если он есть,
// иначе текущие ключи теста.
export function selectKeysForAttempt(currentItems, versionedItems, version) {
  const v = normalizeTestVersion(version);
  if (v !== null && versionedItems && versionedItems[String(v)]) {
    return versionedItems[String(v)];
  }
  return currentItems;
}

// ---------- Повторная публикация после сбоя ----------

// Канонический JSON с отсортированными ключами объектов: сравнение
// содержимого версии независимо от порядка полей и от того, как
// Firestore вернул документ.
export function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const keys = Object.keys(value).filter(
    key => typeof value[key] !== "function"
  ).sort();
  return "{" + keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",") + "}";
}

// Содержимое версии совпадает? Серверные поля времени исключаются:
// при неудачной публикации между setDoc(version) и updateDoc(test)
// publishTest должен продолжить, а не упереться в неизменяемость версии.
export function sameVersionSnapshot(existing, payload, {
  ignored = ["createdAt", "updatedAt", "publishedAt"]
} = {}) {
  const strip = (obj) => {
    const out = {};
    for (const key of Object.keys(obj || {})) {
      if (!ignored.includes(key)) out[key] = obj[key];
    }
    return out;
  };
  return canonicalJson(strip(existing)) === canonicalJson(strip(payload));
}
