// tests/live-flow.test.js — сквозной сценарий автономного теста на чистой
// логике: несколько «устройств» с разными часами, ответы по правилам окна,
// пересчёт очков ведущим, рейтинг, досрочное завершение.
import test from "node:test";
import assert from "node:assert/strict";
import {
  autoPlan, autoPosition, answerAllowed, autoQStarts, finishedPositions,
  finalizablePositions, keysByPosition, ratingRows, serverNow, roomLifecycle
} from "../core/live-auto.js";
import { computeScores } from "../core/rooms-logic.js";

const T0 = 5_000_000;
const room = {
  mode: "auto", status: "active", liveState: "in_progress", questionCount: 3,
  questionSec: 10, gapSec: 3, autoStartedAt: T0, order: [2, 0, 1], speedBonus: true
};
const keys = {
  0: { type: "single", points: 1, correct: [0] },
  1: { type: "single", points: 1, correct: [1] },
  2: { type: "single", points: 2, correct: [2] }
};

test("три устройства с разными часами видят один и тот же вопрос", () => {
  const plan = autoPlan(room);
  const devices = [{ skew: 0 }, { skew: 7_000 }, { skew: -4_500 }]; // часы устройства − сервер
  for (const serverMs of [T0 + 1, T0 + 12_999, T0 + 13_000, T0 + 30_000, T0 + 38_999]) {
    const seen = devices.map(d => autoPosition(plan, serverNow(-d.skew, serverMs + d.skew)).position);
    assert.equal(new Set(seen).size, 1, `в ${serverMs - T0} мс`);
  }
});

test("перезагрузка: позиция восстанавливается из серверного времени, не из памяти", () => {
  const plan = autoPlan(room);
  assert.equal(autoPosition(plan, T0 + 27_000).position, 2);
  assert.equal(autoPosition(plan, T0 + 27_000).phase, "question");
});

test("полный прогон: ответы по окнам, очки, рейтинг и порядок вопросов", () => {
  const plan = autoPlan(room);
  const byPos = keysByPosition(keys, room); // позиции: [вопрос 2, вопрос 0, вопрос 1]
  // Аня верно отвечает на все (быстро); Борис на первый неверно, второй пропускает.
  const players = [
    { uid: "a", name: "Аня", answers: { 0: 2, 1: 0, 2: 1 }, times: { 0: T0 + 1000, 1: T0 + 14_000, 2: T0 + 27_000 } },
    { uid: "b", name: "Борис", answers: { 0: 0, 2: 0 }, times: { 0: T0 + 2000, 2: T0 + 28_000 } }
  ];
  // Окна: ответы Ани допустимы.
  assert.ok(answerAllowed(plan, T0 + 1000, "0"));
  assert.ok(answerAllowed(plan, T0 + 14_000, "1"));
  assert.ok(answerAllowed(plan, T0 + 27_000, "2"));
  // Опоздавший ответ Бориса на вопрос 1 отклонён правилами (пауза).
  assert.equal(answerAllowed(plan, T0 + 24_500, "1"), false);

  const speed = { qDurationSec: plan.questionSec, qStarts: autoQStarts(plan) };
  const nowEnd = T0 + 3 * 13_000 + 100;
  const board = computeScores(players, byPos, finishedPositions(plan, nowEnd), speed);
  const rows = ratingRows({
    scores: board, players, questionCount: 3, finished: 3, lifecycle: roomLifecycle(room, nowEnd)
  });
  assert.equal(rows[0].uid, "a");
  assert.equal(rows[0].correctCount, 3);
  assert.equal(rows[0].percent, 100);
  assert.equal(rows[0].status, "completed");
  assert.equal(rows[1].uid, "b");
  assert.equal(rows[1].correctCount, 0);
  assert.equal(rows[1].answered, 2);
  assert.ok(rows[0].score > rows[1].score);
  // Пересчёт с нуля идемпотентен.
  const again = computeScores([...players].reverse(), byPos, finishedPositions(plan, nowEnd), speed);
  assert.deepEqual(again.map(r => [r.uid, r.score]), board.map(r => [r.uid, r.score]));
});

test("ведущий вернулся после перезагрузки: догоняет раскрытие и очки", () => {
  const plan = autoPlan(room);
  const missing = finalizablePositions({ plan, nowMs: T0 + 100_000, reveals: { 0: {} } });
  assert.deepEqual(missing, [1, 2]);
});

test("досрочное завершение: новые ответы не принимаются, рейтинг фиксируется", () => {
  const early = autoPlan({ ...room, autoEndedAt: T0 + 15_000 });
  assert.equal(answerAllowed(early, T0 + 16_000, "1"), false);
  assert.equal(autoPosition(early, T0 + 16_000).state, "completed");
  assert.deepEqual(finishedPositions(early, T0 + 60_000), [0, 1]);
});

test("повторное нажатие «Начать» не сдвигает расписание (autoStartedAt задан один раз)", () => {
  // Транзакция startAutoTest отказывает, если autoStartedAt уже есть; здесь
  // проверяем следствие: позиция зависит только от исходной метки.
  const a = autoPosition(autoPlan(room), T0 + 20_000);
  const b = autoPosition(autoPlan({ ...room }), T0 + 20_000);
  assert.deepEqual(a, b);
});
