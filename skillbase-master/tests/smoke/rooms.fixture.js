// tests/smoke/rooms.fixture.js — подмена Firebase в браузере.
//
// Техника: до загрузки модулей приложения настраиваем
// window.__FIREBASE_STUB__ и перекрываем network-запросы к Firebase API,
// чтобы smoke-тесты работали без реального проекта и сети.
//
// Использование:
//   npx playwright test tests/smoke/rooms.spec.js
// Перед этим: npm i -D @playwright/test && npx playwright install chromium

export const STUB_PROFILE = {
  uidField: "uid",
  users: {
    host:     { uid: "host",  email: "host@example.com",  role: "teacher",  orgId: "default-org", groupId: "", fullName: "Хост Тестов",   ui: "education" },
    player1:  { uid: "p1",    email: "p1@example.com",    role: "student",  orgId: "default-org", groupId: "default-group", fullName: "Анна Игрок", ui: "education" },
    player2:  { uid: "p2",    email: "p2@example.com",    role: "student",  orgId: "default-org", groupId: "default-group", fullName: "Борис Игрок", ui: "education" },
    observer: { uid: "obs",   email: "obs@example.com",   role: "student",  orgId: "default-org", groupId: "default-group", fullName: "Ольга Наблюдатель", ui: "education" }
  },
  test: {
    id: "t-smoke",
    title: "Smoke-тест",
    authorId: "host",
    orgId: "default-org",
    status: "published",
    version: 1,
    settings: { timePerQuestion: 30 },
    questions: [
      { type: "single",   text: "Сколько сигналов у светофора?", options: [{ text: "Два" }, { text: "Три" }], points: 1 },
      { type: "multiple", text: "Выберите запрещающие сигналы", options: [{ text: "Красный" }, { text: "Жёлтый" }, { text: "Зелёный" }], points: 2 },
      { type: "short",    text: "Кто управляет поездом?", options: [], points: 3 }
    ]
  },
  keys: {
    "0": { type: "single", points: 1, correct: [1] },
    "1": { type: "multiple", points: 2, correct: [0, 1] },
    "2": { type: "short", points: 3, answer: "машинист" }
  }
};

// addInitScript-инъекция: перехват fetch к Firestore REST и Google Auth.
export const stubInitScript = `(() => {
  const store = ${JSON.stringify(STUB_PROFILE)};

  const replies = {
    rooms: new Map(),       // code -> room doc
    players: new Map(),     // \${code}/\${uid} -> player doc
    scores: new Map(),
    reveals: new Map(),
    observers: new Map()
  };
  window.__stub = { store, replies };
})();`;

// Сквозной сценарий smoke: запуск комнаты, три вопроса, итоги.
export const SCENARIO = {
  expectedAnswers: {
    q0: { player1: 1, player2: 0 },       // single: Анна верно, Борис неверно
    q1: { player1: [0, 1], player2: [0, 1] },
    q2: { player1: "машинист", player2: "паровоз" }
  }
};
