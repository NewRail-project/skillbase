// tests/live-auto.test.js — автономный режим Live: расписание от серверного
// времени, состояния подключения, роли, рейтинг, синхронизация часов.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CONN, autoPlan, autoPosition, answerAllowed, finalizablePositions,
  finishedPositions, autoQStarts, roomLifecycle, deriveConnectionState,
  buildAutoSettings, buildQuestionOrder, isValidOrder, questionIndexAt,
  keysByPosition, ratingRows, changedScores, summarizeRating, questionAccuracy,
  roleOfPlayer, resolveRequestedRole, nameForJoin, isRegistrationOpen,
  offsetFromProbe, bestOffset, serverNow, questionSecFor, formatClockMs,
  QUESTION_SEC_DEFAULT, GAP_SEC_MIN
} from "../core/live-auto.js";

const T0 = 1_000_000;
// 3 вопроса по 20 с + пауза 3 с → слот 23 с.
const room = (extra = {}) => ({
  mode: "auto", status: "active", liveState: "in_progress",
  questionSec: 20, gapSec: 3, questionCount: 3, autoStartedAt: T0,
  ...extra
});

test("autoPosition: до старта — waiting без позиции", () => {
  const plan = autoPlan(room({ autoStartedAt: null, liveState: "waiting" }));
  const pos = autoPosition(plan, T0 + 5000);
  assert.equal(pos.state, "waiting");
  assert.equal(pos.position, -1);
});

test("autoPosition: вопрос → пауза → следующий вопрос → завершение", () => {
  const plan = autoPlan(room());
  assert.deepEqual(
    (({ state, phase, position }) => ({ state, phase, position }))(autoPosition(plan, T0)),
    { state: "in_progress", phase: "question", position: 0 });
  const mid = autoPosition(plan, T0 + 5000);
  assert.equal(mid.msLeft, 15000);
  assert.equal(autoPosition(plan, T0 + 19_999).phase, "question");
  assert.equal(autoPosition(plan, T0 + 20_000).phase, "gap");
  assert.equal(autoPosition(plan, T0 + 22_999).position, 0);
  const next = autoPosition(plan, T0 + 23_000);
  assert.equal(next.position, 1);
  assert.equal(next.phase, "question");
  // Последний слот: 2 × 23 = 46 с … 69 с.
  assert.equal(autoPosition(plan, T0 + 46_000).position, 2);
  assert.equal(autoPosition(plan, T0 + 68_999).state, "in_progress");
  assert.equal(autoPosition(plan, T0 + 69_000).state, "completed");
});

test("autoPosition: все устройства с одним временем получают один вопрос", () => {
  const plan = autoPlan(room());
  const serverMs = T0 + 30_000;
  // Устройство A отстаёт на 40 с, B спешит на 25 с; после поправки на смещение
  // оба вычисляют серверное время и один номер вопроса.
  const a = autoPosition(plan, serverNow(40_000, serverMs - 40_000));
  const b = autoPosition(plan, serverNow(-25_000, serverMs + 25_000));
  assert.equal(a.position, b.position);
  assert.equal(a.position, 1);
});

test("autoPosition: досрочное завершение останавливает расписание", () => {
  const plan = autoPlan(room({ autoEndedAt: T0 + 10_000 }));
  assert.equal(autoPosition(plan, T0 + 9_999).state, "in_progress");
  assert.equal(autoPosition(plan, T0 + 10_000).state, "completed");
});

test("answerAllowed: зеркало правил — текущий вопрос, окно и допуск", () => {
  const plan = autoPlan(room());
  assert.equal(answerAllowed(plan, T0 + 10_000, "0"), true);
  assert.equal(answerAllowed(plan, T0 + 20_800, "0"), true, "допуск 1 с на сеть");
  assert.equal(answerAllowed(plan, T0 + 21_000, "0"), false, "окно и допуск закончились");
  assert.equal(answerAllowed(plan, T0 + 10_000, "1"), false, "будущий вопрос");
  assert.equal(answerAllowed(plan, T0 + 28_000, "1"), true);
  assert.equal(answerAllowed(plan, T0 + 28_000, "0"), false, "прошлый вопрос");
  assert.equal(answerAllowed(plan, T0 + 47_000, "3"), false, "вопроса 3 нет");
  assert.equal(answerAllowed(plan, T0 - 1, "0"), false, "до старта");
  assert.equal(answerAllowed(plan, T0 + 5000, "x"), false);
  assert.equal(answerAllowed(autoPlan(room({ autoEndedAt: T0 + 5000 })), T0 + 6000, "0"), false);
});

test("допуск ответа не залезает в следующий слот (gap ≥ 2 с)", () => {
  assert.ok(GAP_SEC_MIN * 1000 > 1000);
  const plan = autoPlan(room({ gapSec: 1 }));
  assert.equal(plan.gapSec, GAP_SEC_MIN, "gap ограничивается снизу");
});

test("finalizablePositions: закрываются только завершившиеся и ещё без reveal", () => {
  const plan = autoPlan(room());
  assert.deepEqual(finalizablePositions({ plan, nowMs: T0 + 5000 }), []);
  assert.deepEqual(finalizablePositions({ plan, nowMs: T0 + 21_500 }), [0]);
  assert.deepEqual(finalizablePositions({ plan, nowMs: T0 + 21_500, reveals: { 0: {} } }), []);
  assert.deepEqual(finalizablePositions({ plan, nowMs: T0 + 80_000 }), [0, 1, 2],
    "ведущий вернулся после перезагрузки — догоняет все вопросы");
});

test("finalizablePositions: досрочное завершение не закрывает неначатые вопросы", () => {
  const plan = autoPlan(room({ autoEndedAt: T0 + 25_000 }));
  // Вопрос 0 завершён, вопрос 1 начался в 23 с и оборван в 25 с; вопроса 2 не было.
  assert.deepEqual(finalizablePositions({ plan, nowMs: T0 + 60_000 }), [0, 1]);
  assert.deepEqual(finishedPositions(plan, T0 + 60_000), [0, 1]);
});

test("autoQStarts: старты вопросов для бонуса за скорость", () => {
  const plan = autoPlan(room());
  assert.deepEqual(autoQStarts(plan), { 0: T0, 1: T0 + 23_000, 2: T0 + 46_000 });
});

test("roomLifecycle: waiting → in_progress → completed → closed", () => {
  assert.equal(roomLifecycle(room({ autoStartedAt: null, liveState: "waiting" }), T0), "waiting");
  assert.equal(roomLifecycle(room(), T0 + 100), "in_progress");
  assert.equal(roomLifecycle(room(), T0 + 70_000), "completed");
  assert.equal(roomLifecycle(room({ liveState: "completed" }), T0 + 100), "completed");
  assert.equal(roomLifecycle(room({ status: "closed" }), T0 + 100), "closed");
  // Ручной режим: по phase.
  assert.equal(roomLifecycle({ mode: "manual", status: "active", phase: "idle" }, T0), "waiting");
  assert.equal(roomLifecycle({ status: "active", phase: "opened" }, T0), "in_progress");
});

test("deriveConnectionState: waiting по собственному документу, без списка участников", () => {
  const waiting = room({ autoStartedAt: null, liveState: "waiting" });
  // playersLoaded вообще не участвует: достаточно подтверждённого членства.
  assert.equal(deriveConnectionState({ memberConfirmed: true, roomLoaded: true, room: waiting, nowMs: T0 }), CONN.WAITING);
});

test("deriveConnectionState: connecting → ошибка только по ошибке или таймауту", () => {
  assert.equal(deriveConnectionState({}), CONN.CONNECTING);
  assert.equal(deriveConnectionState({ error: { code: "permission-denied" } }), CONN.ERROR);
  assert.equal(deriveConnectionState({ timedOut: true }), CONN.ERROR);
});

test("deriveConnectionState: таймаут не считается подтверждением подключения", () => {
  // 15 с прошло, членство не подтверждено → ошибка, а не «waiting».
  assert.equal(deriveConnectionState({ roomLoaded: true, room: room(), timedOut: true }), CONN.ERROR);
  // Членство подтверждено — таймаут ничего не меняет.
  assert.equal(deriveConnectionState({
    memberConfirmed: true, roomLoaded: true, room: room(), nowMs: T0 + 100, timedOut: true
  }), CONN.IN_PROGRESS);
});

test("deriveConnectionState: in_progress / completed / closed", () => {
  const base = { memberConfirmed: true, roomLoaded: true };
  assert.equal(deriveConnectionState({ ...base, room: room(), nowMs: T0 + 100 }), CONN.IN_PROGRESS);
  assert.equal(deriveConnectionState({ ...base, room: room(), nowMs: T0 + 90_000 }), CONN.COMPLETED);
  assert.equal(deriveConnectionState({ ...base, room: room({ status: "closed" }), nowMs: T0 }), CONN.CLOSED);
});

test("роли: roleOfPlayer читает role, затем observer", () => {
  assert.equal(roleOfPlayer({ role: "observer", observer: false }), "observer");
  assert.equal(roleOfPlayer({ role: "player", observer: true }), "player");
  assert.equal(roleOfPlayer({ observer: true }), "observer");
  assert.equal(roleOfPlayer({}), "player");
  assert.equal(roleOfPlayer(null), null);
});

test("роли: преподаватель-не-ведущий входит только наблюдателем", () => {
  assert.equal(resolveRequestedRole({ requested: "player", isStaffUser: true, isHost: false }), "observer");
  assert.equal(resolveRequestedRole({ requested: "player", isStaffUser: true, isHost: true }), "player");
  assert.equal(resolveRequestedRole({ requested: "observer" }), "observer");
  assert.equal(resolveRequestedRole({ requested: "что-то" }), "player");
});

test("nameForJoin: ФИО из профиля, иначе ввод; наблюдателю достаточно имени", () => {
  assert.deepEqual(nameForJoin({ profileName: "Иванов Иван Иванович", role: "player" }),
    { ok: true, value: "Иванов Иван Иванович" });
  assert.equal(nameForJoin({ typed: "Иван", role: "player" }).ok, false, "участнику нужны фамилия и имя");
  assert.equal(nameForJoin({ typed: "Иван Иванов", role: "player" }).ok, true);
  assert.equal(nameForJoin({ typed: "Иван", role: "observer" }).ok, true);
  assert.equal(nameForJoin({ role: "observer" }).ok, false);
  assert.equal(nameForJoin({ typed: "  Иван   Петров ", role: "player" }).value, "Иван Петров");
});

test("registration: закрытая регистрация и завершённый тест не пускают новых", () => {
  assert.equal(isRegistrationOpen(room({ autoStartedAt: null, liveState: "waiting" }), T0), true);
  assert.equal(isRegistrationOpen(room({ registrationOpen: false }), T0 + 10), false);
  assert.equal(isRegistrationOpen(room({ status: "closed" }), T0 + 10), false);
  assert.equal(isRegistrationOpen(room(), T0 + 99_000), false, "тест завершён");
});

test("настройки: время на вопрос из теста, totalTime и значение по умолчанию", () => {
  const qs = [{}, {}, {}, {}];
  assert.equal(questionSecFor({ questions: qs, settings: { timePerQuestion: 45 } }), 45);
  assert.equal(questionSecFor({ questions: qs, settings: { totalTime: 240 } }), 60);
  assert.equal(questionSecFor({ questions: qs, settings: {} }), QUESTION_SEC_DEFAULT);
  assert.equal(questionSecFor({ questions: qs, settings: { timePerQuestion: 45 } }, 12), 12);
  assert.equal(questionSecFor({ questions: qs, settings: {} }, 2), 5, "ниже минимума поднимается");
});

test("buildAutoSettings: последовательный и случайный порядок", () => {
  const t = { questions: [{}, {}, {}, {}, {}], settings: { timePerQuestion: 20, showLeaderboard: true } };
  const seq = buildAutoSettings({ test: t });
  assert.deepEqual(seq.order, [0, 1, 2, 3, 4]);
  assert.equal(seq.mode, "auto");
  assert.equal(seq.speedBonus, true);
  assert.equal(seq.showLeaderboard, true);
  assert.equal(seq.totalSec, 5 * (20 + 3));
  let i = 0;
  const seeded = () => [0.9, 0.1, 0.5, 0.3][i++ % 4];
  const shuffled = buildAutoSettings({ test: t, options: { shuffleQuestions: true, speedBonus: false }, random: seeded });
  assert.ok(isValidOrder(shuffled.order, 5));
  assert.equal(shuffled.speedBonus, false);
  assert.deepEqual(buildQuestionOrder(0, true), []);
});

test("порядок вопросов: позиция → индекс и ключи по позициям", () => {
  const r = { questionCount: 3, order: [2, 0, 1] };
  assert.equal(questionIndexAt(r, 0), 2);
  assert.equal(questionIndexAt(r, 2), 1);
  assert.equal(questionIndexAt({ questionCount: 3 }, 1), 1, "без order — последовательно");
  assert.equal(questionIndexAt({ questionCount: 3, order: [0, 0, 1] }, 1), 1, "битый order игнорируется");
  const keys = { items: {
    0: { type: "single", correct: [0], points: 1 },
    1: { type: "single", correct: [1], points: 2 },
    2: { type: "single", correct: [2], points: 3 }
  } };
  const byPos = keysByPosition(keys, r);
  assert.ok(Array.isArray(byPos));
  assert.equal(byPos[0].points, 3);
  assert.equal(byPos[1].points, 1);
  assert.equal(byPos[2].points, 2);
  // Нет ключа вопроса — null на своей позиции, остальные не сдвигаются.
  const sparse = keysByPosition({ 0: { points: 1 }, 2: { points: 5 } }, { questionCount: 3 });
  assert.equal(sparse[1], null);
  assert.equal(sparse[2].points, 5);
});

test("ratingRows: места, проценты, статус; участники без очков тоже в списке", () => {
  const players = [
    { uid: "a", name: "Аня" }, { uid: "b", name: "Борис" },
    { uid: "c", name: "Вика" }, { uid: "o", name: "Наблюдатель", role: "observer" }
  ];
  const scores = [
    { uid: "a", name: "Аня", score: 5, max: 6, correctCount: 3, answered: 4, finished: 4 },
    { uid: "b", name: "Борис", score: 5, max: 6, correctCount: 3, answered: 3, finished: 4 }
  ];
  const rows = ratingRows({ scores, players, questionCount: 6, finished: 4, lifecycle: "in_progress" });
  assert.deepEqual(rows.map(r => r.uid), ["a", "b", "c"], "наблюдатель в рейтинг не входит");
  assert.deepEqual(rows.map(r => r.place), [1, 1, 3], "равные очки — одно место");
  assert.equal(rows[0].percent, 75);
  assert.equal(rows[2].score, 0);
  assert.equal(rows[0].status, "in_progress");
  assert.equal(ratingRows({ scores, players, lifecycle: "completed" })[0].status, "completed");
});

test("ratingRows: очки без документа участника (список ещё грузится) не теряются", () => {
  const rows = ratingRows({ scores: [{ uid: "z", name: "Зоя", score: 2, correctCount: 1, finished: 1 }], players: [] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Зоя");
});

test("changedScores: пишем только изменившиеся строки", () => {
  const existing = [{ uid: "a", name: "A", score: 2, max: 3, correctCount: 1, answered: 2, finished: 2 }];
  const same = { uid: "a", name: "A", score: 2, max: 3, correctCount: 1, answered: 2, finished: 2 };
  const changed = { ...same, score: 4 };
  const fresh = { uid: "b", name: "B", score: 0, max: 3, correctCount: 0, answered: 0, finished: 2 };
  assert.deepEqual(changedScores(existing, [same, fresh]).map(r => r.uid), ["b"]);
  assert.deepEqual(changedScores(existing, [changed]).map(r => r.uid), ["a"]);
});

test("summarizeRating и questionAccuracy: итоговая статистика ведущего", () => {
  const rows = [
    { uid: "a", name: "A", score: 6, percent: 100, correctCount: 3 },
    { uid: "b", name: "B", score: 2, percent: 33, correctCount: 1 }
  ];
  const sum = summarizeRating(rows);
  assert.equal(sum.participants, 2);
  assert.equal(sum.averageScore, 4);
  assert.equal(sum.averagePercent, 67);
  assert.equal(summarizeRating([]).participants, 0);

  const keysByPos = { "0": { type: "single", correct: [1], points: 1 } };
  const acc = questionAccuracy({
    players: [
      { uid: "a", answers: { "0": 1 } }, { uid: "b", answers: { "0": 0 } },
      { uid: "c", answers: {} }, { uid: "o", role: "observer", answers: {} }
    ],
    keysByPos, positions: [0]
  });
  assert.deepEqual(acc[0], { position: 0, answered: 2, correct: 1, participants: 3, percent: 33 });
});

test("синхронизация часов: проба с наименьшим RTT побеждает", () => {
  // Устройство отстаёт на 5 с: сервер 105 000, локально 100 000, RTT 200 мс.
  const p1 = offsetFromProbe({ sendMs: 99_900, ackMs: 100_100, serverMs: 105_000 });
  assert.equal(p1.offsetMs, 5000);
  assert.equal(p1.rttMs, 200);
  const slow = offsetFromProbe({ sendMs: 0, ackMs: 2000, serverMs: 7000 });
  assert.equal(bestOffset([slow, p1]), 5000);
  assert.equal(bestOffset([]), 0);
  assert.equal(bestOffset([null]), 0);
  assert.equal(offsetFromProbe({ sendMs: 5, ackMs: 1, serverMs: 3 }), null);
  assert.equal(serverNow(5000, 100_000), 105_000);
  assert.equal(serverNow(NaN, 100_000), 100_000);
});

test("formatClockMs: мм:сс с округлением вверх", () => {
  assert.equal(formatClockMs(0), "00:00");
  assert.equal(formatClockMs(1), "00:01");
  assert.equal(formatClockMs(61_000), "01:01");
  assert.equal(formatClockMs(-5), "00:00");
});
