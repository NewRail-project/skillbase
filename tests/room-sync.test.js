// tests/room-sync.test.js — контракт синхронизации Live-комнаты без
// перезагрузки страницы.
//
// Проверяет чистые подписи из core/rooms-logic.js, которыми страница
// #room (ui/pages/room.js) разделяет обновления на два уровня:
//
//   roomRenderSignature — полная перерисовка вида (шаг комнаты, мой ответ,
//   роль, подключение). «Толпа» сюда не входит: чужие ответы и очки не
//   должны пересобирать экран.
//
//   roomCrowdSignature — подпись «толпы» (ответы, очки, состав) для
//   точечных обновляторов рейтинга, счётчиков и списков участников.
import test from "node:test";
import assert from "node:assert/strict";
import {
  roomRenderSignature,
  roomCrowdSignature
} from "../core/rooms-logic.js";
import { rowSignature } from "../ui/components/leaderboard.js";

// Базовое состояние вида: участник отвечает на открытый вопрос.
const baseRender = {
  roomStatus: "active",
  conn: "in_progress",
  life: "in_progress",
  position: 2,
  phase: "question",
  currentQuestionId: "2",
  qStartedMs: 1700000000000,
  regOpen: 1,
  clockReady: 1,
  revealOn: "-",
  myAnswered: false,
  role: "player",
  removed: false,
  testReady: true,
  keysReady: true,
  hasMaterial: false
};

const baseCrowd = {
  players: [
    { uid: "u1", name: "Аня", answers: { "0": 1, "1": 2 } },
    { uid: "u2", name: "Борис", answers: { "0": 1 } }
  ],
  scores: [
    { uid: "u1", score: 20, finished: 2 },
    { uid: "u2", score: 10, finished: 2 }
  ],
  reveals: { "0": {}, "1": {} }
};

// ---------- Полная перерисовка: одинаковые данные — рендера нет ----------

test("render-подпись: одинаковые данные дают одну подпись (нет повторного рендера)", () => {
  assert.equal(roomRenderSignature(baseRender), roomRenderSignature({ ...baseRender }));
});

test("render-подпись: повторные снапшоты толпы НЕ меняют подпись вида", () => {
  // Сценарий: пока участник печатает ответ, у других изменились ответы и
  // очки, кто-то вошёл. Все эти данные входят только в crowd-подпись,
  // поэтому полная перерисовка не запускается.
  const crowdA = roomCrowdSignature(baseCrowd);
  const crowdB = roomCrowdSignature({
    players: [
      { uid: "u1", name: "Аня", answers: { "0": 1, "1": 2, "2": 3 } },
      { uid: "u2", name: "Борис", answers: { "0": 1, "2": 1 } },
      { uid: "u3", name: "Вера", answers: {} }
    ],
    scores: [
      { uid: "u1", score: 35, finished: 2 },
      { uid: "u2", score: 15, finished: 2 }
    ],
    reveals: { "0": {}, "1": {} }
  });
  assert.notEqual(crowdA, crowdB, "толпа изменилась — точечные обновляторы обязаны сработать");
  assert.equal(roomRenderSignature(baseRender), roomRenderSignature({ ...baseRender }),
    "но полная перерисовка вида не запускается");
});

test("render-подпись: мой ответ меняет подпись (блокировка повторной отправки)", () => {
  const answered = roomRenderSignature({ ...baseRender, myAnswered: true });
  assert.notEqual(roomRenderSignature(baseRender), answered);
});

test("render-подпись: новый вопрос и его раскрытие меняют подпись", () => {
  const nextQuestion = roomRenderSignature({ ...baseRender, position: 3, currentQuestionId: "3", qStartedMs: 1700000003000 });
  assert.notEqual(roomRenderSignature(baseRender), nextQuestion);
  const revealed = roomRenderSignature({ ...baseRender, phase: "gap", revealOn: "on" });
  assert.notEqual(roomRenderSignature(baseRender), revealed);
});

test("render-подпись: смена роли, удаления и состояния связи меняют подпись", () => {
  assert.notEqual(roomRenderSignature(baseRender), roomRenderSignature({ ...baseRender, role: "observer" }));
  assert.notEqual(roomRenderSignature(baseRender), roomRenderSignature({ ...baseRender, removed: true }));
  assert.notEqual(roomRenderSignature(baseRender), roomRenderSignature({ ...baseRender, conn: "error" }));
  assert.notEqual(roomRenderSignature(baseRender), roomRenderSignature({ ...baseRender, roomStatus: "closed" }));
});

// ---------- Толпа: точечные обновления должны замечать изменения ----------

test("crowd-подпись: чужой ответ меняет подпись (счётчики обновятся)", () => {
  const after = {
    ...baseCrowd,
    players: baseCrowd.players.map(p => p.uid === "u2"
      ? { ...p, answers: { "0": 1, "2": 1 } }
      : p)
  };
  assert.notEqual(roomCrowdSignature(baseCrowd), roomCrowdSignature(after));
});

test("crowd-подпись: очки и места меняют подпись (рейтинг обновится)", () => {
  const after = {
    ...baseCrowd,
    scores: [{ uid: "u1", score: 25, finished: 2 }, { uid: "u2", score: 10, finished: 2 }]
  };
  assert.notEqual(roomCrowdSignature(baseCrowd), roomCrowdSignature(after));
});

test("crowd-подпись: вход и выход участников меняют подпись", () => {
  const joined = {
    ...baseCrowd,
    players: [...baseCrowd.players, { uid: "u3", name: "Вера", answers: {} }]
  };
  assert.notEqual(roomCrowdSignature(baseCrowd), roomCrowdSignature(joined));
  const left = { ...baseCrowd, players: [baseCrowd.players[0]] };
  assert.notEqual(roomCrowdSignature(baseCrowd), roomCrowdSignature(left));
});

test("crowd-подпись: наблюдатели не попадают в счёт ответов", () => {
  const withObserver = {
    ...baseCrowd,
    players: [...baseCrowd.players, { uid: "o1", role: "observer", observer: true, answers: { "0": 1 } }]
  };
  // Наблюдатель добавляет только ids — ответы его не считаются.
  const before = roomCrowdSignature(baseCrowd);
  const after = roomCrowdSignature(withObserver);
  assert.notEqual(before, after, "состав изменился — списки участников обновятся");
  assert.ok(!after.includes("o1:"), "ответ наблюдателя не входит в счётчик ответов");
});

test("crowd-подпись: одинаковые данные — одна подпись (нет лишних обновлений)", () => {
  assert.equal(roomCrowdSignature(baseCrowd), roomCrowdSignature({ ...baseCrowd }));
});

// ---------- Карточка рейтинга: точечное обновление, аватар догружается ----------

const baseRow = {
  uid: "u1", name: "Аня", avatar: null, place: 2, score: 20, correctCount: 2,
  percent: 100, answered: 2, finished: 2, status: "in_progress", streak: 1
};

test("row-подпись: аватар входит в подпись карточки (дозагрузка профиля обновит только её)", () => {
  const before = rowSignature(baseRow);
  const after = rowSignature({ ...baseRow, avatar: "https://example.test/a.png" });
  assert.notEqual(before, after, "аватар догрузился — карточка обязана обновиться");
  // Данные очков не менялись — подпись та же, карточка DOM-узла не трогается.
  assert.equal(rowSignature(baseRow), rowSignature({ ...baseRow }));
});
