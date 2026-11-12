// tests/avatars.test.js — ЖД-аватары (inline SVG) и совместимость с правилами.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RAIL_AVATARS, AVATAR_PRESETS, AVATAR_PATTERN, avatarPreset, avatarSvg,
  isValidAvatarValue, DEFAULT_AVATAR_VALUE, RAIL_SHAPE_LABELS
} from '../shared/avatars.js';

test('8 фигур ЖД-тематики, у каждой по два цветовых варианта', () => {
  assert.equal(Object.keys(RAIL_SHAPE_LABELS).length, 8);
  assert.equal(RAIL_AVATARS.length, 16);
  for (const shape of Object.keys(RAIL_SHAPE_LABELS)) {
    assert.equal(RAIL_AVATARS.filter(a => a.shape === shape).length, 2, shape);
  }
});

test('значение preset:<id> проходит шаблон правил Firestore — правила менять не нужно', () => {
  for (const a of RAIL_AVATARS) {
    assert.ok(AVATAR_PATTERN.test(`preset:${a.id}`), a.id);
    assert.ok(isValidAvatarValue(`preset:${a.id}`));
  }
  assert.ok(isValidAvatarValue(DEFAULT_AVATAR_VALUE));
});

test('id уникальны и не пересекаются со старыми эмодзи-пресетами', () => {
  const ids = [...RAIL_AVATARS, ...AVATAR_PRESETS].map(a => a.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('старые эмодзи-аватары продолжают находиться', () => {
  assert.equal(avatarPreset('preset:fox').emoji, '🦊');
  assert.equal(avatarSvg(avatarPreset('preset:fox')), null);
  assert.equal(avatarPreset('preset:unknown'), null);
});

test('avatarSvg: валидный самодостаточный SVG с фоном и акцентом, без скриптов', () => {
  for (const a of RAIL_AVATARS) {
    const svg = avatarSvg(a, 40);
    assert.match(svg, /^<svg [^>]*viewBox="0 0 48 48"/);
    assert.ok(svg.includes(a.bg) && svg.includes(a.accent), a.id);
    assert.ok(svg.endsWith('</svg>'));
    assert.ok(!/<script|onload|onclick|href=/i.test(svg), a.id);
    // Теги сбалансированы: открывающих <rect/path/circle/g> столько же, сколько закрытых/самозакрытых.
    const opens = (svg.match(/<g[ >]/g) || []).length;
    const closes = (svg.match(/<\/g>/g) || []).length;
    assert.equal(opens, closes, a.id);
  }
});
