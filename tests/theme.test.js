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

// ---------- Палитра (скин) гостя ----------

function setupPalette(initial = {}) {
  const env = setup(initial);
  globalThis.window.dispatchEvent = () => {};
  return env;
}

test('палитра: по умолчанию education, выбор гостя сохраняется и применяется', async () => {
  const { store, attrs } = setupPalette();
  const theme = await import('../shared/theme.js?palette1');
  assert.equal(theme.getPalette(), 'education');
  assert.equal(theme.setPalette('depot'), 'depot');
  assert.equal(store['sb-palette'], 'depot');
  assert.equal(attrs['data-ui'], 'depot');
  assert.equal(theme.getPalette(), 'depot');
});

test('палитра: неизвестное значение заменяется палитрой по умолчанию', async () => {
  const { store, attrs } = setupPalette();
  const theme = await import('../shared/theme.js?palette2');
  assert.equal(theme.setPalette('neon'), 'education');
  assert.equal(store['sb-palette'], 'education');
  assert.equal(attrs['data-ui'], 'education');
});

test('палитра: initTheme поднимает сохранённый выбор, applyPalette ничего не пишет', async () => {
  const { store, attrs } = setupPalette({ 'sb-palette': 'operations' });
  const theme = await import('../shared/theme.js?palette3');
  theme.initTheme();
  assert.equal(attrs['data-ui'], 'operations');
  // applyPalette (профиль из Firestore) только применяет, localStorage не трогает.
  theme.applyPalette('depot');
  assert.equal(attrs['data-ui'], 'depot');
  assert.equal(store['sb-palette'], 'operations');
});

test('палитра: список совпадает со скинами профиля (VALID_UI)', async () => {
  setupPalette();
  const theme = await import('../shared/theme.js?palette4');
  const { VALID_UI } = await import('../core/registration.js');
  assert.deepEqual([...theme.PALETTES], [...VALID_UI]);
  for (const p of theme.PALETTES) assert.ok(theme.PALETTE_META[p].label);
});

test('палитра не сбрасывает светлую/тёмную тему', async () => {
  const { attrs } = setupPalette({ 'sb-theme': 'dark' });
  const theme = await import('../shared/theme.js?palette5');
  theme.applyThemeMode('dark');
  theme.setPalette('depot');
  assert.equal(attrs['data-theme'], 'dark');
  assert.equal(attrs['data-ui'], 'depot');
});
