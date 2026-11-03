// Чистые правила согласия с документами (политика + соглашение).
//
// Модуль не импортирует Firebase: его тестируют в Node
// (tests/consents.test.js), а auth.js, страницы и правила Firestore
// используют как единый источник версий и состава записи.
//
// Решение о согласии принимает пользователь в интерфейсе; здесь только
// проверка факта принятия и сборка документа Firestore. Подтверждение
// в localStorage НЕ является доказательством принятия — это только
// удобство повторных визитов гостя внутри той же анонимной сессии
// (доказательство — запись consents в Firestore).

// Фактическая редакция документов: дата «Обновлено» на страницах
// #privacy, #terms и #rules (см. ui/pages/*-*.js). Номеров версий,
// истории изменений и юридических реквизитов у документов нет —
// не выдумываем их: редакция идентифицируется датой.
export const DOC_VERSIONS = {
  privacy: "02.11.2026",
  terms: "02.11.2026",
  rules: "02.11.2026"
};

// Названия и маршруты документов для ссылок в чекбоксах согласия.
export const CONSENT_DOCUMENTS = {
  privacy: { id: "privacy", title: "Политика конфиденциальности", route: "#privacy" },
  terms: { id: "terms", title: "Пользовательское соглашение", route: "#terms" }
};

// Какие документы принимает пользователь одним чекбоксом.
export const CONSENT_REQUIRED_KEYS = ["privacy", "terms"];

// Типы согласия (маршрут сохранения в consents/{id}):
//   signup      — регистрация (форма или первый вход Google на #setup)
//   guest-test  — гостевой проход теста по прямой ссылке
//   live-room   — вход гостя в Live-комнату по коду/QR
export const CONSENT_TYPES = ["signup", "guest-test", "live-room"];

// Набор полей документа согласия — должен дословно совпадать с
// allow create в firestore.rules (consents).
export function buildConsentFields({ uid, type } = {}) {
  const id = String(uid ?? "").trim();
  if (!id) return { ok: false, error: "Согласие требует идентификатора сессии." };
  if (!CONSENT_TYPES.includes(type)) {
    return { ok: false, error: "Неизвестный тип согласия." };
  }
  const docs = {};
  for (const key of CONSENT_REQUIRED_KEYS) {
    const version = DOC_VERSIONS[key];
    if (!version) return { ok: false, error: `Не задана редакция документа ${key}.` };
    docs[key] = version;
  }
  return {
    ok: true,
    value: {
      uid: id,
      type,
      docs
    }
  };
}

// ---------- UX-маркер повторных визитов гостя ----------

const KEY_PREFIX = "sb:consent:";

function consentKey(uid, type) {
  return `${KEY_PREFIX}${uid}:${type}`;
}

const CONSENT_MARKER_VALUE = "accepted-v1";

// Принимался ли такой тип согласия в этой гостевой сессии. Маркер
// проставляется ТОЛЬКО после успешной записи в Firestore, поэтому
// отсутствие записи в базе ≠ принятый чекбокс в текущей сессии.
export function hasConsentMarker(uid, type) {
  if (!CONSENT_TYPES.includes(type)) return false;
  try {
    const storage = globalThis.localStorage;
    if (!storage || typeof storage.getItem !== "function") return false;
    return storage.getItem(consentKey(uid, type)) === CONSENT_MARKER_VALUE;
  } catch {
    return false;
  }
}

// Пометка «согласие сохранено в Firestore»: вызывается после успешной
// записи, гость при обновлении страницы не проходит это снова.
// Возвращает false, если storage недоступен: тогда интерфейс не считает
// согласие «повторным» и каждый раз показывает чекбокс заново.
export function markConsent(uid, type) {
  if (!CONSENT_TYPES.includes(type)) return false;
  try {
    const storage = globalThis.localStorage;
    if (!storage || typeof storage.setItem !== "function") return false;
    storage.setItem(consentKey(uid, type), CONSENT_MARKER_VALUE);
    return true;
  } catch {
    return false;
  }
}

export function clearConsentMarkers(uid) {
  try {
    for (const type of CONSENT_TYPES) {
      globalThis.localStorage?.removeItem(consentKey(String(uid ?? ""), type));
    }
  } catch {
    // localStorage недоступен — чистить нечего.
  }
}
