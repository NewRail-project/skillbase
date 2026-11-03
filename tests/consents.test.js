// tests/consents.test.js — согласие с документами (core/consent-docs.js).
//
// Проверяются чистые правила: состав записи Firestore (uid, type, docs),
// запрет пустых/неизвестных значений и UX-маркер повторных визитов гостя
// (localStorage не доказательство, поэтому вызывается только после записи).
import test from "node:test";
import assert from "node:assert/strict";
import {
  DOC_VERSIONS,
  CONSENT_TYPES,
  CONSENT_REQUIRED_KEYS,
  buildConsentFields,
  hasConsentMarker,
  markConsent,
  clearConsentMarkers
} from "../core/consent-docs.js";

// ---------- Состав записи согласия ----------

test("Запись согласия содержит uid, тип и редакции обоих документов", () => {
  const check = buildConsentFields({ uid: "an-1", type: "guest-test" });
  assert.equal(check.ok, true);
  assert.deepEqual(check.value, {
    uid: "an-1",
    type: "guest-test",
    docs: {
      privacy: DOC_VERSIONS.privacy,
      terms: DOC_VERSIONS.terms
    }
  });
});

test("Редакции документов — непустые строки для всех обязательных ключей", () => {
  for (const key of CONSENT_REQUIRED_KEYS) {
    assert.equal(typeof DOC_VERSIONS[key], "string", `версия ${key} — строка`);
    assert.ok(DOC_VERSIONS[key].length > 0, `версия ${key} не пуста`);
  }
});

test("Согласие без идентификатора сессии отклоняется", () => {
  assert.equal(buildConsentFields({ type: "signup" }).ok, false);
  assert.equal(buildConsentFields({ uid: "  ", type: "signup" }).ok, false);
});

test("Неизвестный тип согласия отклоняется", () => {
  assert.equal(buildConsentFields({ uid: "u1", type: "stripe-payment" }).ok, false);
  assert.equal(buildConsentFields({ uid: "u1" }).ok, false);
});

test("Известные типы согласия принимаются", () => {
  for (const type of CONSENT_TYPES) {
    assert.equal(buildConsentFields({ uid: "u1", type }).ok, true);
  }
});

// ---------- UX-маркер повторных визитов ----------

test("Маркер согласия проставляется и снимается очисткой", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  };

  clearConsentMarkers("guest-A");
  assert.equal(hasConsentMarker("guest-A", "guest-test"), false);

  assert.equal(markConsent("guest-A", "guest-test"), true);
  assert.equal(hasConsentMarker("guest-A", "guest-test"), true);

  // Маркеры типов и сессий независимы: согласие на тест не открывает
  // автоматом согласие для Live-комнаты другой сессии.
  assert.equal(hasConsentMarker("guest-A", "live-room"), false);
  assert.equal(hasConsentMarker("guest-B", "guest-test"), false);

  clearConsentMarkers("guest-A");
  assert.equal(hasConsentMarker("guest-A", "guest-test"), false);
});

test("Маркер неизвестного типа не сохраняется и не читается", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  };

  assert.equal(markConsent("guest-A", "fake-type"), false);
  assert.equal(hasConsentMarker("guest-A", "fake-type"), false);
});

test("Недоступный localStorage не ломает проверки", () => {
  globalThis.localStorage = undefined;
  assert.equal(hasConsentMarker("guest-A", "guest-test"), false);
  assert.equal(markConsent("guest-A", "guest-test"), false);
  assert.doesNotThrow(() => clearConsentMarkers("guest-A"));
});
