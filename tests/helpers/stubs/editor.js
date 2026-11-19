// Заглушка core/editor.js: реальные функции чтения/записи тестов заменяются
// выборкой из globalThis.__SB с теми же фильтрами, что у боевых
// (orgId + status != "deleted", для не-админа ещё authorId == uid).
// Правила Firestore здесь не выполняются — их проверяет tools/rules-test.mjs.
const sb = () => globalThis.__SB;
const clone = v => JSON.parse(JSON.stringify(v));

// Текущий тест редактора (аналог currentTest в core/editor.js).
let currentTest = {};

function visible(orgId, role, uid) {
  return (sb().tests || []).filter(t =>
    t && t.orgId === orgId && t.status !== "deleted"
    && (role === "admin" || t.authorId === uid));
}

export async function listMyTests(uid, orgId, role = "teacher") {
  const s = sb();
  s.calls.push(["listMyTests", uid, orgId, role]);
  if (s.listTestsError) throw s.listTestsError;
  return clone(visible(orgId, role, uid));
}

// Опубликованные тесты организации: правила разрешают их читать любому
// участнику организации, независимо от авторства.
export async function listPublishedTests(orgId) {
  const s = sb();
  s.calls.push(["listPublishedTests", orgId]);
  if (s.listPublishedError) throw s.listPublishedError;
  return clone((s.tests || []).filter(t => t && t.orgId === orgId && t.status === "published"));
}

export async function deleteTest(testId, plan) {
  const s = sb();
  s.calls.push(["deleteTest", testId, clone(plan || {})]);
  if (s.deleteTestError) throw s.deleteTestError;
}

export async function loadTest(id) {
  const s = sb();
  s.calls.push(["loadTest", id]);
  if (s.loadTestError) throw s.loadTestError;
  const found = (s.tests || []).find(t => t.id === id);
  if (!found) return null;
  currentTest = clone(found);
  return clone(found);
}

export function getCurrentTest() { return currentTest; }
export function resetTest() { currentTest = {}; }

export function updateTest(draft) {
  const s = sb();
  currentTest = { ...currentTest, ...clone(draft) };
  s.calls.push(["updateTest", clone(draft)]);
}

export async function saveTest() {
  sb().calls.push(["saveTest"]);
}
export async function publishTest() {
  sb().calls.push(["publishTest"]);
}

export function validateTestDraft() { return { errors: [], warnings: [] }; }
export function validateTestForPublish() { return { errors: [], warnings: [] }; }

// Разбор текста: страница должна получить непустой результат, иначе
// сохранение теста не доходит до записи materialId.
export function parseQuizText(text) {
  const hasText = Boolean(String(text || "").trim());
  return {
    questions: hasText
      ? [{
          type: "single",
          text: "Вопрос из заглушки?",
          options: [{ text: "Да", correct: true }, { text: "Нет" }],
          points: 1
        }]
      : [],
    errors: [],
    structuredErrors: []
  };
}
