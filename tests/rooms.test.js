import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateRoomCode, normalizeRoomCode, isValidRoomCode,
  questionTimeMs, roomSignature, answeredCount,
  computeScores, buildReveal, joinPlayerFields, SERVER_TIMESTAMP,
  roomGateStatus, computeRoomState, buildJoinUrl
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

// ---------- Повторный вход в комнату (P0-2) ----------

// Первый вход: полный набор полей, включая joinedAt (серверная метка).
test('joinPlayerFields: первый вход пишет joinedAt и роль', () => {
  const fields = joinPlayerFields(null, { name: 'Иван Петров', observer: false });
  assert.deepEqual(Object.keys(fields).sort(),
    ['joinedAt', 'name', 'observer', 'playerId', 'uid', 'updatedAt']);
  assert.equal(fields.observer, false);
  assert.equal(fields.joinedAt, SERVER_TIMESTAMP);
  assert.equal(fields.updatedAt, SERVER_TIMESTAMP);
});

// Регрессия P0: пустые uid/playerId нарушали правило create Firestore
// (uid == playerId == request.auth.uid) — вход авторизованного пользователя
// падал с permission-denied. Вызывающий обязан передать реальный uid.
test('joinPlayerFields: реальный uid попадает в uid и playerId', () => {
  const created = joinPlayerFields(null, {
    uid: 'u1', playerId: 'u1', name: 'Иван Петров', observer: false
  });
  assert.equal(created.uid, 'u1');
  assert.equal(created.playerId, 'u1');

  const repeated = joinPlayerFields(
    { uid: '', playerId: '', name: 'Иван', observer: false },
    { uid: 'u1', playerId: 'u1', name: 'Иван', observer: false }
  );
  assert.equal(repeated.uid, 'u1');
  assert.equal(repeated.playerId, 'u1');
});

// Повторный вход: joinedAt и observer не переписываются (правила update
// запрещают их менять) — иначе permission-denied.
test('joinPlayerFields: повторный вход не трогает joinedAt и observer', () => {
  const existing = {
    uid: 'u1', playerId: 'u1', name: 'Иван', observer: false,
    joinedAt: '2026-01-01T00:00:00Z'
  };
  const fields = joinPlayerFields(existing, { name: 'Иван', observer: true });
  assert.equal('joinedAt' in fields, false);
  assert.equal('observer' in fields, false);
  assert.deepEqual(fields, { uid: 'u1', playerId: 'u1', updatedAt: SERVER_TIMESTAMP });
});

// Повторный вход с тем же именем: только updatedAt (affectedKeys ⊆ allowed).
test('joinPlayerFields: повторный вход без изменений — только updatedAt', () => {
  const existing = { uid: 'u1', playerId: 'u1', name: 'Иван', observer: false };
  const fields = joinPlayerFields(existing, { name: 'Иван', observer: false });
  assert.deepEqual(fields, { uid: 'u1', playerId: 'u1', updatedAt: SERVER_TIMESTAMP });
});

// Повторный вход с новым именем: имя обновляется (правила разрешают).
test('joinPlayerFields: повторный вход обновляет изменившееся имя', () => {
  const existing = { uid: 'u1', playerId: 'u1', name: 'Иван', observer: false };
  const fields = joinPlayerFields(existing, { name: 'Иван Петров', observer: false });
  assert.equal(fields.name, 'Иван Петров');
  assert.equal('joinedAt' in fields, false);
});

// Пустое имя при повторном входе не затирает прежнее (профиль не загрузился).
test('joinPlayerFields: пустое имя при повторном входе не записывается', () => {
  const existing = { uid: 'u1', playerId: 'u1', name: 'Иван', observer: false };
  const fields = joinPlayerFields(existing, { name: '', observer: false });
  assert.equal('name' in fields, false);
});

// Гость: аватар пишется при первом входе и обновляется при повторном.
test('joinPlayerFields: аватар гостя — первый вход и повторный', () => {
  const created = joinPlayerFields(null, { name: 'Гость', observer: false, avatar: 'preset:cat' });
  assert.equal(created.avatar, 'preset:cat');
  const existing = { uid: 'g1', playerId: 'g1', name: 'Гость', avatar: 'preset:cat', observer: false };
  const updated = joinPlayerFields(existing, { name: 'Гость', observer: false, avatar: 'preset:fox' });
  assert.equal(updated.avatar, 'preset:fox');
  assert.equal('joinedAt' in updated, false);
});

// ---------- Гейт страницы комнаты (жалоба «Вы не в этой комнате») ----------

const ACTIVE_ROOM = { status: 'active', code: '9QNT86' };

// Регрессия гонки: до первого снапшота players страница НЕ должна теме
// «Вы не в этой комнате» — это «подключаемся».
test('roomGateStatus: до снапшота players — waiting', () => {
  assert.equal(roomGateStatus({
    playersLoaded: false, players: [], uid: 'u1', room: ACTIVE_ROOM
  }), 'waiting');
  assert.equal(roomGateStatus({ uid: 'u1', room: ACTIVE_ROOM }), 'waiting',
    'без playersLoaded тоже waiting');
  assert.equal(roomGateStatus({ playersLoaded: true, uid: 'u1', room: null }),
    'waiting', 'без комнаты waiting');
  assert.equal(roomGateStatus({
    playersLoaded: false, players: [], uid: 'u1', room: ACTIVE_ROOM, myDoc: { uid: 'u1', observer: false }
  }), 'player', 'при наличии myDoc мгновенно возвращает player без ожидания списка всех игроков');
  assert.equal(roomGateStatus({
    playersLoaded: false, players: [], uid: 'u1', room: ACTIVE_ROOM, myDoc: { uid: 'u1', observer: true }
  }), 'observer', 'при наличии myDoc мгновенно возвращает observer');
});

test('computeRoomState: независимые состояния комнаты', () => {
  assert.equal(computeRoomState({ connectionError: 'net' }), 'connection_error');
  assert.equal(computeRoomState({ room: null }), 'connecting');
  assert.equal(computeRoomState({ room: { status: 'closed' } }), 'completed');
  assert.equal(computeRoomState({ room: { status: 'active' }, myDoc: null, isHost: false, playersLoaded: false }), 'connecting');
  assert.equal(computeRoomState({ room: { status: 'active' }, myDoc: null, isHost: false, playersLoaded: true }), 'role_select');
  assert.equal(computeRoomState({ room: { status: 'active', phase: 'idle' }, myDoc: { uid: 'u1' } }), 'waiting');
  assert.equal(computeRoomState({ room: { status: 'active', phase: 'opened', currentQuestion: 0 }, myDoc: { uid: 'u1' } }), 'in_progress');
});

// Участник распознаётся по uid (uid всегда равен id документа).
test('roomGateStatus: участник и наблюдатель распознаются', () => {
  const players = [{ uid: 'u1', observer: false }, { uid: 'u2', observer: true }];
  assert.equal(roomGateStatus({
    playersLoaded: true, players, uid: 'u1', room: ACTIVE_ROOM
  }), 'player');
  assert.equal(roomGateStatus({
    playersLoaded: true, players, uid: 'u2', room: ACTIVE_ROOM
  }), 'observer');
});

// Регрессия: профильный пользователь видит подтверждение входа,
// а не тупик «Вы не в этой комнате».
test('roomGateStatus: не участник с профилем — confirm-join', () => {
  assert.equal(roomGateStatus({
    playersLoaded: true, players: [], uid: 'u1', room: ACTIVE_ROOM
  }), 'confirm-join');
});

// Гость без членства — на гостевую форму (нужны имя и аватар), не автозапись.
test('roomGateStatus: гость без членства — guest-join', () => {
  assert.equal(roomGateStatus({
    playersLoaded: true, players: [], uid: 'g1', room: ACTIVE_ROOM, guest: true
  }), 'guest-join');
});

// Закрытая или завершённая комната не приглашает к входу.
test('roomGateStatus: закрытая комната — closed', () => {
  assert.equal(roomGateStatus({
    playersLoaded: true, players: [], uid: 'u1',
    room: { status: 'closed', code: '9QNT86' }
  }), 'closed');
  assert.equal(roomGateStatus({
    playersLoaded: true, players: [], uid: 'u1',
    room: { status: 'ended', code: '9QNT86' }
  }), 'closed');
});

// Неавторизованный — на вход по коду.
test('roomGateStatus: без uid — signIn', () => {
  assert.equal(roomGateStatus({
    playersLoaded: true, players: [], uid: null, room: ACTIVE_ROOM
  }), 'signIn');
});

// ---------- Ссылка приглашения из QR ----------

const SITE = { origin: 'https://newrail-project.github.io', pathname: '/skillbase/' };

// QR содержит правильную индивидуальную ссылку комнаты.
test('buildJoinUrl: QR комнаты ведёт на её код без ручного ввода', () => {
  assert.equal(
    buildJoinUrl('9QNT86', SITE),
    'https://newrail-project.github.io/skillbase/#join/9QNT86'
  );
});

// QR разных комнат ведут в разные комнаты (roomId в ссылке).
test('buildJoinUrl: разные комнаты — разные ссылки', () => {
  const a = buildJoinUrl('ABC234', SITE);
  const b = buildJoinUrl('XYZ98K', SITE);
  assert.notEqual(a, b);
  assert.ok(a.endsWith('#join/ABC234'));
  assert.ok(b.endsWith('#join/XYZ98K'));
});

// Некорректный код не превращается в ссылку (не «какой-то» URL).
test('buildJoinUrl: недопустимый код даёт пустую ссылку', () => {
  assert.equal(buildJoinUrl('ABC0I1', SITE), '');
  assert.equal(buildJoinUrl('', SITE), '');
});
