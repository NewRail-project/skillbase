// tests/room-history.test.js — история завершённых Live-комнат:
// сохранение снимка при завершении, идемпотентность (код = id документа),
// отсутствие дубликатов, состав снимка (участники, рейтинг, дуэли, журнал),
// повторное открытие без пересчёта, неизменяемость, открытие после
// перезагрузки, совместимость со старыми комнатами, доступ по ролям и
// изоляция организации (статические проверки правил + правила проверяются
// через Rules API в tools/rules-test.mjs — кейсы «История: …»).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- Фейковый DOM (как в tests/live-final.test.js) ----------

function makeElement(tag) {
  const el = {
    tag,
    attrs: {},
    children: [],
    dataset: {},
    style: {},
    textContent: "",
    listeners: {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] ?? null; },
    appendChild(child) { this.children.push(child); return child; },
    append(...nodes) { for (const n of nodes) this.appendChild(n); },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    classList: { toggle() {}, add() {}, remove() {} }
  };
  return el;
}

globalThis.document = {
  createElement: makeElement,
  createElementNS: (ns, tag) => makeElement(tag),
  createTextNode: text => ({ text })
};

const {
  buildRoomHistorySnapshot, historyRow, snapshotReport, sortHistoryRows,
  ROOM_HISTORY_VERSION
} = await import("../core/room-history.js");
const {
  overviewPanel, studentsPanel, reportSection, journalPanel, recommendationsPanel
} = await import("../ui/components/live-report.js");

const roomPage = readFileSync(join(ROOT, "ui/pages/room.js"), "utf8");
const rooms = readFileSync(join(ROOT, "core/rooms.js"), "utf8");
const rules = readFileSync(join(ROOT, "firestore.rules"), "utf8");
const historyModule = readFileSync(join(ROOT, "core/room-history.js"), "utf8");
const historyPage = readFileSync(join(ROOT, "ui/pages/room-history.js"), "utf8");

// ---------- Данные ----------

const keys = Array.from({ length: 3 }, () => ({ type: "single", points: 1, correct: [0] }));
const questions = [
  { text: "Вопрос 1", topic: "Тема A" },
  { text: "Вопрос 2", topic: "Тема B" },
  { text: "Вопрос 3", topic: "Тема A" }
];
const room = {
  code: "ABC123", orgId: "org1", hostId: "teacher1", hostName: "Преподаватель",
  testId: "t1", testTitle: "Срез знаний", questionCount: 3,
  createdAt: { seconds: 1760000000, nanoseconds: 0 },
  autoEndedAt: { seconds: 1760003600, nanoseconds: 0 }
};
const players = [
  { uid: "a", name: "Анна", answers: { 0: 0, 1: 0, 2: 1 } },
  { uid: "b", name: "Борис", answers: {} },
  { uid: "o", name: "Смотрящий", answers: { 0: 0 }, observer: true }
];
const scores = [
  { uid: "a", name: "Анна", place: 1, score: 3, streak: 2, bestStreak: 3, trail: "111", avatar: "preset:a" },
  { uid: "b", name: "Борис", place: 2, score: 0, streak: 0, bestStreak: 0, trail: "", avatar: "preset:b" }
];
const duels = {
  key: "final", status: "resolved", computedBy: "teacher1", version: 1,
  groups: [{
    id: "g0", uids: ["a", "b"], names: { a: "Анна", b: "Борис" },
    tally: { a: 1, b: 0 }, status: "resolved", rounds: [{}, {}],
    order: ["a", "b"], stoppedReason: "", decision: null
  }]
};
const buildInput = () => ({
  room, test: { title: "Срез знаний" }, players, scores, duels,
  keysByPos: keys, questions, positions: [0, 1, 2],
  meta: { subject: "История", topic: "Древний мир" }
});

// 1. Сохранение завершённой комнаты: снимок содержит всё необходимое.
test("снимок завершённой комнаты содержит сведения о комнате, тесте и датах", () => {
  const s = buildRoomHistorySnapshot(buildInput());
  assert.equal(s.code, "ABC123");
  assert.equal(s.key, "ABC123"); // устойчивый идентификатор
  assert.equal(s.orgId, "org1");
  assert.equal(s.hostId, "teacher1");
  assert.equal(s.testTitle, "Срез знаний");
  assert.equal(s.subjectName, "История");
  assert.equal(s.topicName, "Древний мир");
  assert.equal(s.createdAtMs, 1760000000000);
  assert.equal(s.finishedAtMs, 1760003600000);
  assert.equal(s.version, ROOM_HISTORY_VERSION);
  assert.ok(s.overview);
  assert.ok(s.rating.length);
  assert.ok(s.report);
  assert.ok(s.journal.length);
});

// 2. Повторное событие завершения не пересоздаёт и не меняет снимок.
test("повторное завершение: снимок детерминирован, клиент пишет только при отсутствии документа", () => {
  const first = buildRoomHistorySnapshot(buildInput());
  const second = buildRoomHistorySnapshot(buildInput());
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  // Идемпотентность в core/rooms.js: сначала getDoc, exists → отказ от записи.
  const saveBody = rooms.slice(rooms.indexOf("export async function saveRoomHistory"),
    rooms.indexOf("export async function getRoomHistory"));
  assert.match(saveBody, /const existing = await getDoc\(ref\);/);
  assert.match(saveBody, /if \(existing\.exists\(\)\) return \{ saved: false, reason: "exists" \};/);
  // В room.js повторное сохранение после успеха не запускается.
  assert.match(roomPage, /historySavedCode === local\.code\) return;/);
  assert.match(roomPage, /result\.saved \|\| result\.reason === "exists"/);
});

// 3. Отсутствие дубликатов: один документ на комнату (id = код).
test("дубликаты невозможны: документ пишется по коду комнаты", () => {
  assert.match(rooms, /doc\(db, "roomHistory", code\)/);
  assert.match(rooms, /const code = normalizeRoomCode\(snapshot\?\.code\);/);
  const s = buildRoomHistorySnapshot(buildInput());
  assert.equal(s.code, s.key);
});

// 4. Сохранение фактических участников (наблюдатель — отдельно, не участник).
test("участники сохранены: наблюдатель не считается участником, детализация по каждому", () => {
  const s = buildRoomHistorySnapshot(buildInput());
  assert.equal(s.overview.participants, 2);
  assert.equal(s.overview.observers, 1);
  // Журнал и детализация — только фактические участники (без наблюдателя).
  const uids = s.studentsDetail.map(g => g.uid).sort();
  assert.deepEqual(uids, ["a", "b"]);
  const anna = s.studentsDetail.find(g => g.uid === "a");
  assert.equal(anna.correctCount, 2);
  assert.ok(Array.isArray(anna.breakdown) && anna.breakdown.length === 3);
});

// 5. Рейтинг и дуэли сохранены; ключей правильных ответов в снимке нет.
test("рейтинг с местами и дуэли сохранены, ключи ответов не хранятся", () => {
  const s = buildRoomHistorySnapshot(buildInput());
  assert.equal(s.rating[0].place, 1);
  assert.equal(s.rating[0].score, 3);
  assert.equal(s.rating[0].uid, "a");
  assert.equal(s.duels.status, "resolved");
  assert.equal(s.duels.groups[0].tally.a, 1);
  assert.equal(s.duels.groups[0].rounds, 2);
  assert.equal(s.duels.groups[0].decision, null);
  // Секретов нет: ключей правильных ответов в снимке не появляется.
  // (совпадения вида questions[].correct — это счётчики верных ответов.)
  const raw = JSON.stringify(s);
  assert.ok(!raw.includes("correctAnswer"));
  assert.ok(!raw.includes('"keys"'));
  assert.ok(!raw.includes('"options"'));
});

// 6. Журнал оценок сохранён в полном составе колонок (фактические участники).
test("журнал оценок сохранён: №, ФИО, статус, верно/неверно/пропуски, оценка", () => {
  const s = buildRoomHistorySnapshot(buildInput());
  assert.ok(Array.isArray(s.journal) && s.journal.length === 2);
  const row = s.journal.find(r => r.uid === "a");
  assert.equal(row.n, 1);
  assert.equal(row.name, "Анна");
  assert.equal(row.correct, 2);
  assert.equal(row.wrong, 1);
  assert.equal(row.skipped, 0);
  assert.ok(row.label.length > 0);
});

// 7. Повторное открытие отчёта: существующие компоненты рендерят снимок.
test("повторное открытие: снимок рендерится существующими компонентами отчёта", () => {
  const s = buildRoomHistorySnapshot(buildInput());
  const report = snapshotReport(s);
  // Тот же интерфейс, что у buildLiveReport: group/questions/students/
  // topics/recommendations/verdict + byUid (Map).
  for (const field of ["group", "questions", "students", "topics", "recommendations", "verdict"]) {
    assert.ok(field in report);
  }
  assert.ok(report.byUid instanceof Map);
  assert.equal(report.byUid.get("a").correctCount, 2);
  // Компоненты итогового экрана принимают данные снимка и строят узлы.
  const overview = overviewPanel({
    title: s.testTitle, subject: s.subjectName, topic: s.topicName,
    finishedLabel: "01.01.2026", participants: s.overview.participants,
    observers: s.overview.observers, group: report.group, verdict: report.verdict
  });
  const stats = reportSection(report, { title: "Статистика", sections: ["group", "questions"] });
  const students = studentsPanel(report, []);
  const journal = journalPanel(s.journal, { grades: s.studentsDetail });
  const recs = recommendationsPanel(report);
  for (const node of [overview, stats, students, journal, recs]) assert.ok(node);
  // Страница истории собирает отчёт именно из этих компонентов.
  for (const name of ["overviewPanel", "reportSection", "studentsPanel", "journalPanel", "recommendationsPanel"]) {
    assert.ok(historyPage.includes(name), `${name} подключён`);
  }
});

// 8. Неизменяемость снимка: чтение не мутирует, запись в Firestore закрыта.
test("снимок неизменяем: чтение не пересчитывает оценки, правила запрещают update/delete", () => {
  const s = buildRoomHistorySnapshot(buildInput());
  const before = JSON.stringify(s);
  snapshotReport(s);
  historyRow(s);
  assert.equal(JSON.stringify(s), before);
  // Страница истории не импортирует модули оценивания — повторный
  // просмотр ничего не пересчитывает, оценки не меняются.
  assert.ok(!historyPage.includes("gradeRoster"));
  assert.ok(!historyPage.includes("gradePlayer"));
  // Правила: история неизменяема ни для кого.
  const from = rules.indexOf("match /roomHistory/");
  const section = rules.slice(from, rules.indexOf("allow update, delete: if false;", from)
    + "allow update, delete: if false;".length);
  assert.match(section, /allow update, delete: if false;/);
});

// 9. Открытие после перезагрузки: страница читает снимок из Firestore.
test("открытие после перезагрузки: страница читает roomHistory из Firestore", () => {
  assert.match(historyPage, /getRoomHistory\(code\)/);
  assert.match(historyPage, /listRoomHistory\(/);
  // Данные берутся из документа, а не из состояния активной комнаты.
  assert.ok(!historyPage.includes("subscribeRoom"));
  assert.ok(!historyPage.includes("local.players"));
  // Сохранение подключено на странице комнаты в общем кадровом цикле.
  assert.match(roomPage, /manageHistorySave\(\);/);
  assert.match(roomPage, /function manageHistorySave\(\)/);
});

// 10. Старая комната без новых полей: частичное состояние, без выдумок.
test("старая комната без дуэлей/предмета даёт корректное частичное состояние", () => {
  const oldRoom = {
    code: "OLD111", orgId: "org1", hostId: "teacher1", hostName: "Преподаватель",
    testId: "t2", testTitle: "Старый тест", questionCount: 3,
    createdAt: { seconds: 1700000000, nanoseconds: 0 },
    updatedAt: { seconds: 1700001800, nanoseconds: 0 }
  };
  const s = buildRoomHistorySnapshot({
    room: oldRoom, test: null, players, scores, duels: null,
    keysByPos: keys, questions, positions: [0, 1, 2],
    meta: { subject: "", topic: "" }
  });
  assert.equal(s.subjectName, ""); // не выдумываем
  assert.equal(s.topicName, "");
  assert.equal(s.duels, null);
  assert.equal(s.finishedAtMs, 1700001800000); // fallback на updatedAt
  const row = historyRow(s);
  assert.equal(row.testTitle, "Старый тест");
  assert.equal(row.participants, 2);
  assert.equal(row.duelsResolved, null); // «—» в списке, не «разрешены»
  // Сортировка не ломается на записях без даты: свежие сверху, без даты — в конец.
  const sorted = sortHistoryRows([row, { ...row, code: "Z9", finishedAtMs: null }]);
  assert.equal(sorted[0].code, "OLD111");
});

// 11–12. Доступ преподавателя-владельца и администратора организации.
test("правила: читают преподаватель-владелец и администратор организации", () => {
  const section = rules.slice(rules.indexOf("match /roomHistory/"));
  assert.match(section, /allow read: if isStaffOf\(resource\.data\.orgId\)/);
  assert.match(section, /isAdminOf\(resource\.data\.orgId\)/);
  assert.match(section, /resource\.data\.hostId == request\.auth\.uid/);
});

// 13. Чужая организация недоступна; создание — только в своей.
test("правила: изоляция orgId при чтении и создании снимка", () => {
  const section = rules.slice(rules.indexOf("match /roomHistory/"));
  // Чтение: только сотрудник той же организации.
  assert.match(section, /isStaffOf\(resource\.data\.orgId\)/);
  // Создание: orgId из профиля, ведущий — только своей комнаты, код = id.
  assert.match(section, /request\.resource\.data\.orgId == myOrg\(\)/);
  assert.match(section, /request\.resource\.data\.hostId == request\.auth\.uid/);
  assert.match(section, /request\.resource\.data\.code == docId/);
  // Белый список полей: правильные ответы в снимок не попасть.
  assert.match(section, /hasOnly\(/);
  // Студент не создаёт снимок (isStaff).
  assert.match(section, /allow create: if isStaff\(\)/);
});

// 14. Ученик не изменяет отчёт: update/delete запрещены всем, кейсы правил есть.
test("правила и кейсы: студент не изменяет исторический отчёт", () => {
  const section = rules.slice(rules.indexOf("match /roomHistory/"));
  assert.match(section, /allow update, delete: if false;/);
  // Кейсы Rules API покрывают все 14 пунктов промта.
  const rulesTest = readFileSync(join(ROOT, "tools/rules-test.mjs"), "utf8");
  for (const name of [
    "История: преподаватель-ведущий читает свой снимок",
    "История: администратор организации читает снимок",
    "История: преподаватель не читает чужую комнату (не владелец)",
    "История: преподаватель не читает снимок чужой организации",
    "История: администратор не читает снимок чужой организации",
    "История: студент не читает снимок",
    "История: ведущий сохраняет снимок своей комнаты",
    "История: код документа не совпадает с id — отказ",
    "История: подмена hostId — отказ",
    "История: ведущий не пишет снимок в чужую организацию — отказ",
    "История: студент не сохраняет снимок",
    "История: лишние поля снимка — отказ",
    "История: снимок неизменяем — даже ведущий не обновляет",
    "История: студент не изменяет отчёт",
    "История: удаление запрещено даже администратору"
  ]) {
    assert.ok(rulesTest.includes(name), `кейс правил: ${name}`);
  }
  assert.ok(rulesTest.includes("...roomHistoryCases()"));
});

// Дополнительно: маршрутизация и точка входа в навигацию.
test("маршрут истории подключён, страница в существующей навигации", () => {
  const app = readFileSync(join(ROOT, "shared/app.js"), "utf8");
  assert.match(app, /"room-history":\s*\{\s*file: "ui\/pages\/room-history\.js"/);
  assert.match(app, /roles: STAFF \}/);
  const home = readFileSync(join(ROOT, "ui/pages/home.js"), "utf8");
  assert.match(home, /href: "#room-history"/);
});
