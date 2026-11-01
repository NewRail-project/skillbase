// tests/theme.test.js — тема гостя: выбор хранится в localStorage устройства
// и не зависит от профиля (shared/theme.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';

function setup(initial = {}) {
  const store = { ...initial };
  globalThis.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }
  };
  const attrs = {};
  const root = { style: {}, getAttribute: k => attrs[k] ?? null, setAttribute: (k, v) => { attrs[k] = v; } };
  globalThis.document = { documentElement: root, querySelector: () => null };
  globalThis.window = { dispatchEvent() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
  return { store, attrs };
}

test('гость без профиля: выбор темы сохраняется в localStorage и применяется', async () => {
  const { store, attrs } = setup();
  const theme = await import('../shared/theme.js');
  assert.equal(theme.getThemeMode(), 'system');
  theme.setThemeMode('dark');
  assert.equal(store['sb-theme'], 'dark');
  assert.equal(attrs['data-theme'], 'dark');
});

test('toggleTheme переключает светлую и тёмную', async () => {
  const { store, attrs } = setup({ 'sb-theme': 'light' });
  const theme = await import('../shared/theme.js');
  theme.applyThemeMode('light');
  assert.equal(theme.toggleTheme(), 'dark');
  assert.equal(attrs['data-theme'], 'dark');
  assert.equal(theme.toggleTheme(), 'light');
  assert.equal(store['sb-theme'], 'light');
});

test('сохранённый выбор читается при следующем визите', async () => {
  setup({ 'sb-theme': 'dark' });
  const theme = await import('../shared/theme.js');
  assert.equal(theme.getThemeMode(), 'dark');
  assert.equal(theme.resolveTheme('dark'), 'dark');
});
