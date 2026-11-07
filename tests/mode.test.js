// tests/mode.test.js — режим Education / Workforce: сохранение, скин, живые тексты, словарь.
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
  const listeners = {};
  globalThis.window = {
    dispatchEvent(e) { (listeners[e.type] || []).forEach(f => f(e)); },
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter(x => x !== f); },
    matchMedia: () => ({ matches: false, addEventListener() {} })
  };
  globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
  return { store, attrs };
}

const fresh = (p) => import(`../${p}?${Math.random()}`);

test('по умолчанию Education, скин education', async () => {
  const { attrs } = setup();
  const mode = await fresh('core/mode.js');
  assert.equal(mode.initMode(), 'education');
  assert.equal(attrs['data-mode'], 'education');
  assert.equal(attrs['data-ui'], 'education');
});

test('Workforce сохраняется и применяется при следующем запуске', async () => {
  const { store, attrs } = setup();
  const mode = await fresh('core/mode.js');
  mode.initMode();
  mode.setMode('workforce');
  assert.equal(store['sb-mode'], 'workforce');
  assert.equal(attrs['data-ui'], 'workforce');
  const next = setup(store);
  const mode2 = await fresh('core/mode.js');
  assert.equal(mode2.initMode(), 'workforce');
  assert.equal(next.attrs['data-ui'], 'workforce');
});

test('Education → Workforce → Education возвращает выбранный скин', async () => {
  const { attrs } = setup({ 'sb-ui': 'depot' });
  const mode = await fresh('core/mode.js');
  mode.initMode();
  assert.equal(attrs['data-ui'], 'depot');
  mode.setMode('workforce');
  assert.equal(attrs['data-ui'], 'workforce');
  mode.applyUi('operations'); // выбор скина в Workforce не ломает скин режима
  assert.equal(attrs['data-ui'], 'workforce');
  mode.setMode('education');
  assert.equal(attrs['data-ui'], 'operations');
});

test('испорченное значение в хранилище → Education', async () => {
  setup({ 'sb-mode': 'hacker' });
  const mode = await fresh('core/mode.js');
  assert.equal(mode.readStoredMode(), 'education');
  assert.equal(mode.setMode('bogus'), mode.getMode());
});

test('смена режима шлёт событие и обновляет живые тексты на месте', async () => {
  setup();
  globalThis.document.createTextNode = (v) => ({ nodeValue: v });
  const mode = await fresh('core/mode.js');
  const live = await import('../shared/live.js');
  const i18n = await fresh('core/i18n.js');
  mode.initMode();
  let seen = null;
  mode.subscribeMode(m => { seen = m; });
  const node = live.liveText(() => i18n.t('nav.tests'));
  assert.equal(node.nodeValue, 'Каталог тестов');
  mode.setMode('workforce');
  assert.equal(seen, 'workforce');
  assert.equal(node.nodeValue, 'Проверка знаний');
  mode.setMode('education');
  assert.equal(node.nodeValue, 'Каталог тестов');
});

test('словарь: наборы ключей совпадают, подстановки работают, роль не меняется', async () => {
  setup();
  const i18n = await fresh('core/i18n.js');
  const a = i18n.dictionaryKeys('education').sort();
  const b = i18n.dictionaryKeys('workforce').sort();
  assert.deepEqual(a, b);
  for (const k of a) {
    assert.ok(i18n.DICTIONARY.education[k] !== '', k);
    assert.ok(i18n.DICTIONARY.workforce[k] !== '', k);
  }
  assert.equal(i18n.t('home.learner.hello', { name: 'Иван' }, 'workforce'), 'Здравствуйте, Иван');
  assert.equal(i18n.t('role.teacher', 'workforce'), 'Инструктор');
  assert.equal(i18n.t('role.student', 'education'), 'Студент');
  assert.equal(i18n.t('no.such.key'), 'no.such.key');
});

test('словарь: Workforce действительно отличается там, где это важно', async () => {
  setup();
  const i18n = await fresh('core/i18n.js');
  for (const k of ['nav.tests', 'nav.assignments', 'nav.results', 'role.student', 'role.teacher', 'group']) {
    assert.notEqual(i18n.t(k, 'education'), i18n.t(k, 'workforce'), k);
  }
});
