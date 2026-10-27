import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateRoomCode, normalizeRoomCode, isValidRoomCode,
  questionTimeMs, roomSignature, answeredCount,
  computeScores, buildReveal
} from '../core/rooms-logic.js';

test('generateRoomCode: 6 символов алфавита без 0/O/1/I', () => {
  const code = generateRoomCode();
  assert.equal(code.length, 6);
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.ok(!/[0O1I]/.test(code));
});

test('normalizeRoomCode: убирает пробелы, локализует похожие символы', () => {
  assert.equal(normalizeRoomCode(' ab c23z '), 'ABC23Z');
  assert.equal(normalizeRoomCode('о12л45'), null); // кириллица Л — невалидный символ
  assert.equal(normalizeRoomCode('аbc234'), null); // кириллица А — невалидный символ
  // Кириллическая О и цифра 0 становятся латинской O, 1 и І — латинской I.
  assert.notEqual(normalizeRoomCode('О12345'), 'О12345');
});

test('normalizeRoomCode: короткие и пустые коды отклоняются', () => {
  assert.equal(normalizeRoomCode(''), null);
  assert.equal(normalizeRoomCode(null), null);
  assert.equal(normalizeRoomCode('ABC23'), null);
  assert.equal(normalizeRoomCode('ABC2345'), null);
});

test('isValidRoomCode: латиница и цифры, без 0/O/1/I', () => {
  assert.equal(isValidRoomCode('ABC234'), true);
  assert.equal(isValidRoomCode('ABC0I1'), false);
  assert.equal(isValidRoomCode('abc'), false);
});

test('questionTimeMs: в пределах ±2 минут берём серверное время', () => {
  const server = Date.now() - 30_000;
  assert.equal(questionTimeMs(server, Date.now()), server);
});

test('questionTimeMs: сильный уход сервера вперёд — момент получения', () => {
  // Сервер «в будущем» (устройство отстало), но не сильно — берём сервер; этот кейс
  // обозначает только сильный уход вперёд.
  const server = Date.now() + 180_000;
  const now = Date.now();
  assert.equal(questionTimeMs(server, now), now, 'сильный уход вперёд — момент получения');
});

test('questionTimeMs: уход в прошлое не маскируем (восстановление комнаты)', () => {
  // Вопрос открыт задолго до перезагрузки: серверная метка остаётся —
  // таймер покажет, что время уже вышло, и автозакрытие сработает один раз.
  const server = 1_000;
  assert.equal(questionTimeMs(server, 5_000_000), server);
});

test('questionTimeMs: нет серверного времени — локальное', () => {
  assert.equal(questionTimeMs(null, 12345), 12345);
});

test('roomSignature: меняется только по существенным полям', () => {
  const base = {
    room: { status: 'active', currentQuestionId: '2', phase: 'opened', qStartedMs: 1000, questionCount: 3 },
    players: [{ uid: 'p1', name: 'Ваня', answers: {} }],
    myAnswer: null
  };
  const same = roomSignature(base);
  assert.equal(roomSignature({ ...base, players: [{ uid: 'p1', name: 'Ваня', avatar: 'x', answers: {} }] }), same,
    'несущественные поля игрока не меняют сигнатуру');

  const withAnswer = roomSignature({
    ...base,
    players: [{ uid: 'p1', name: 'Ваня', answers: { '2': 0 } }],
    myAnswer: 0
  });
  assert.notEqual(withAnswer, same, 'новый ответ меняет сигнатуру');

  const closed = roomSignature({
    ...base,
    room: { ...base.room, phase: 'closed' }
  });
  assert.notEqual(closed, same, 'закрытие вопроса меняет сигнатуру');
});

test('answeredCount: считает только участников, не наблюдателей', () => {
  const players = [
    { uid: 'a', observer: false, answers: { '1': 0 } },
    { uid: 'b', observer: false, answers: {} },
    { uid: 'c', observer: true, answers: { '1': 2 } }
  ];
  assert.equal(answeredCount(players, '1'), 1);
  assert.equal(answeredCount(players, '1', { includeObservers: true }), 2);
});

const KEYS = {
  '0': { type: 'single', points: 2, correct: [1] },
  '1': { type: 'multiple', points: 3, correct: [0, 2] },
  '2': { type: 'short', points: 5, answer: 'диспетчер' }
};

test('computeScores: баллы и сортировка по очкам', () => {
  const players = [
    { uid: 'u1', name: 'Аня', observer: false, answers: { '0': 1, '1': [0, 2], '2': 'Диспетчер' } },
    { uid: 'u2', name: 'Борис', observer: false, answers: { '0': 0 } },
    { uid: 'v3', name: 'Смотрит', observer: true, answers: { '0': 1 } }
  ];
  const board = computeScores(players, KEYS, [0, 1, 2]);
  assert.equal(board.length, 2, 'наблюдатель не в таблице');
  assert.deepEqual(board.map(p => p.name), ['Аня', 'Борис']);
  // Серия Live-комнаты: 2×1.1=2.2→2, 3×1.2=3.6→4, 5... 6×1.2=7.2→7 → 13.
  assert.equal(board[0].score, 13);
  assert.equal(board[1].score, 0);
  assert.equal(board[0].max, 10);
});

test('computeScores: частично закрытые вопросы учитываются', () => {
  const players = [{ uid: 'u1', name: 'Аня', answers: { '0': 1 } }];
  const board = computeScores(players, KEYS, [0]);
  assert.equal(board[0].score, 2);
  assert.equal(board[0].max, 2);
});

test('buildReveal: single раскрывает индексы, short — ответ', () => {
  const single = buildReveal({ type: 'single', points: 2, correct: [1, 3] });
  assert.deepEqual(single.correct, [1, 3]);
  assert.equal(single.points, 2);

  const short = buildReveal({ type: 'short', points: 5, answer: ' диспетчер ', explanation: 'Устав стр.' });
  assert.equal(short.answer, ' диспетчер ');
  assert.equal(short.explanation, 'Устав стр.');
  assert.equal(short.correct, undefined, 'у short нет списка индексов');
});

test('buildReveal: пустой ключ даёт null', () => {
  assert.equal(buildReveal(null), null);
});
