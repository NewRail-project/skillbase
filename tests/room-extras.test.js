// tests/room-extras.test.js — ограничения звуков, пресеты реакций,
// пресетные аватары и счёт очков Live-комнаты.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOUND_DEFS, SOUND_LIMITS, VIBRATION_DEFS, canPlay
} from '../shared/sound.js';
import { REACTIONS, normalizeReaction } from '../shared/reactions.js';
import {
  AVATAR_PRESETS, AVATAR_PATTERN, avatarPreset, isValidAvatarValue
} from '../shared/avatars.js';
import { myAnswerVerdict } from '../core/rooms-logic.js';

test('SOUND_DEFS: каждый звук 80–400 мс и громкостью ≤ 0.2', () => {
  const names = Object.keys(SOUND_DEFS);
  assert.ok(names.includes('join'));
  assert.ok(names.includes('start'));
  assert.ok(names.includes('tick'));
  assert.ok(names.includes('correct'));
  assert.ok(names.includes('wrong'));
  assert.ok(names.includes('up'));
  assert.ok(names.includes('final'));
  for (const [name, def] of Object.entries(SOUND_DEFS)) {
    assert.ok(def.dur >= SOUND_LIMITS.durMin && def.dur <= SOUND_LIMITS.durMax,
      `${name}: dur ${def.dur} вне 80–400 мс`);
    assert.ok(def.gain <= SOUND_LIMITS.gainMax,
      `${name}: gain ${def.gain} выше 0.2`);
    assert.ok(['tone', 'sweep'].includes(def.kind), `${name}: вид волны`);
  }
});

test('canPlay: один звук на событие не чаще раза в 150 мс', () => {
  const lastMs = {};
  assert.equal(canPlay('tick', 1000, lastMs), true, 'первый тик разрешён');
  assert.equal(canPlay('tick', 1010, lastMs), true, 'гейт учитывает lastMs, а не сам факт вызова');
  lastMs.tick = 1000;
  assert.equal(canPlay('tick', 1100, lastMs), false, '90 мс — слишком рано');
  assert.equal(canPlay('tick', 1151, lastMs), true, '151 мс — уже можно');
  assert.equal(canPlay('нет-такого', 1000, lastMs), false, 'неизвестный звук запрещён');
});

test('VIBRATION_DEFS: верный [30], неверный [60,40,60]', () => {
  assert.deepEqual(VIBRATION_DEFS.correct, [30]);
  assert.deepEqual(VIBRATION_DEFS.wrong, [60, 40, 60]);
});

test('REACTIONS: 8 пресетов, normalizeReaction отбрасывает чужое', () => {
  assert.equal(REACTIONS.length, 8);
  for (const emoji of REACTIONS) assert.equal(normalizeReaction(emoji), emoji);
  assert.equal(normalizeReaction('🐍'), null);
  assert.equal(normalizeReaction(''), null);
  assert.equal(normalizeReaction(null), null);
});

test('AVATAR_PRESETS: ровно 24 пресета, валидный формат "preset:<id>"', () => {
  assert.equal(AVATAR_PRESETS.length, 24);
  const ids = new Set();
  for (const preset of AVATAR_PRESETS) {
    assert.match(preset.bg, /^#/, `${preset.id}: фон-цвет`);
    ids.add(preset.id);
  }
  assert.equal(ids.size, 24, 'id уникальны');
  for (const id of ids) {
    assert.match(`preset:${id}`, AVATAR_PATTERN, `${id}: попадает в правило`);
  }
  assert.equal(avatarPreset('preset:fox'), AVATAR_PRESETS.find(p => p.id === 'fox'));
  assert.equal(avatarPreset('data:image/jpeg;base64,xx'), null, 'base64 не пресет');
  // Правильность правила-паттерна в firestore.rules: без точек, слешей и верхнего регистра.
  assert.equal(isValidAvatarValue(null), true);
  assert.equal(isValidAvatarValue(undefined), true);
  assert.equal(isValidAvatarValue('preset:koala'), true);
  assert.equal(isValidAvatarValue('preset:КОТ'), false, 'кириллица вне пресетов');
  assert.equal(isValidAvatarValue('preset:qwertyuiopasdfghjklza'), false, 'id длиннее 20 символов');
});

test('myAnswerVerdict: выбор по индексам, short по строке', () => {
  const single = { reveal: { type: 'single', correct: [1] } };
  assert.equal(myAnswerVerdict(single, 1), true);
  assert.equal(myAnswerVerdict(single, 0), false);
  const multi = { reveal: { type: 'multiple', correct: [0, 2] } };
  assert.equal(myAnswerVerdict(multi, [0, 2]), true);
  assert.equal(myAnswerVerdict(multi, [2]), false);
  const short = { reveal: { type: 'short', answer: ' Диспетчер ' } };
  assert.equal(myAnswerVerdict(short, 'диспетчер'), true);
  assert.equal(myAnswerVerdict(short, '  '), false, 'пустой short — неверно');
  assert.equal(myAnswerVerdict(null, 1), null, 'без reveal — вердикта нет');
});
