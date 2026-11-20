// tests/battle-room-connection.test.js — подключение Battle к Live-комнате
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, findOne } from "./helpers/fake-dom.js";

describe('Подключение Battle к Live', () => {
  installFakeDom();
  let local;

  function mockLocal(room) {
    local = {
      ...room,
      isHost: true,
      // Другие поля по умолчанию
    };
    globalThis.local = local;
  }

  function renderBattlePrep() {
    // Эмулируем рендер battlePrepForHost
    return eval("battlePrepForHost()");
  }

  test('AUTO + battleEnabled = true — панель подготовки подключена', () => {
    mockLocal({
      mode: 'auto',
      battleEnabled: true,
      status: 'active',
      phase: 'opened',
      test: { id: 'test1' },
    });
    const root = renderBattlePrep();
    const panel = findOne(root, (e) => e.className === 'battle-prep');
    assert.ok(panel, 'Панель подготовки должна быть отображена');
  });

  test('AUTO + battleEnabled = false — панель отсутствует', () => {
    mockLocal({
      mode: 'auto',
      battleEnabled: false,
      status: 'active',
      phase: 'opened',
      test: { id: 'test1' },
    });
    const root = renderBattlePrep();
    const panel = findOne(root, (e) => e.className === 'battle-prep');
    assert.ok(!panel, 'Панель не должна отображаться');
  });

  test('MANUAL + battleEnabled = true — панель подключена после завершения теста', () => {
    mockLocal({
      mode: 'manual',
      battleEnabled: true,
      status: 'closed',
      phase: 'closed',
      test: { id: 'test1' },
      liveFinishedForBattle: true,
    });
    const root = renderBattlePrep();
    const panel = findOne(root, (e) => e.className === 'battle-prep');
    assert.ok(panel, 'Панель должна отображаться после завершения теста');
  });

  test('MANUAL + battleEnabled = false — обычный Live не изменён', () => {
    mockLocal({
      mode: 'manual',
      battleEnabled: false,
      status: 'closed',
      phase: 'closed',
      test: { id: 'test1' },
      liveFinishedForBattle: true,
    });
    const root = renderBattlePrep();
    const panel = findOne(root, (e) => e.className === 'battle-prep');
    assert.ok(!panel, 'Панель не должна отображаться');
    // Проверяем, что обычный контент итога есть
    const final = findOne(root, (e) => e.className === 'final-view');
    assert.ok(final, 'Обычный итог должен отображаться');
  });
});
