// tests/publish-recovery.test.js — повторная публикация после сбоя:
// версия уже записана, tests не обновлён → publishTest продолжает.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameVersionSnapshot, canonicalJson } from '../core/test-storage.js';

const ISO = "2026-01-01T00:00:00Z";

test('sameVersionSnapshot: одинаковое содержимое — продолжить публикацию', () => {
  const payload = {
    id: 't1', authorId: 'teacher1', orgId: 'default-org', status: 'published',
    version: 2, title: 'Тест', questions: [{ id: 'q1', type: 'single' }],
    items: { '0': { correct: [1] } }
  };
  const existing = {
    // Firestore вернул документ в своём порядке + поля времени.
    title: 'Тест', version: 2, createdAt: ISO,
    authorId: 'teacher1', orgId: 'default-org', id: 't1',
    updatedAt: ISO, publishedAt: ISO,
    questions: [{ id: 'q1', type: 'single' }], status: 'published',
    items: { '0': { correct: [1] } }
  };
  assert.equal(sameVersionSnapshot(existing, payload), true,
    'порядок полей и серверные метки не влияют на сравнение');
});

test('sameVersionSnapshot: другой items — повторная публикация отклоняется', () => {
  const payload = { version: 2, items: { '0': { correct: [0] } } };
  const existing = { version: 2, items: { '0': { correct: [1] } } };
  assert.equal(sameVersionSnapshot(existing, payload), false);
});

test('sameVersionSnapshot: отличия в статусе и порядке вопросов видны', () => {
  assert.equal(sameVersionSnapshot(
    { version: 1, status: 'published' },
    { version: 1, status: 'draft' }), false);
  assert.equal(sameVersionSnapshot(
    { questions: [{ text: 'a' }, { text: 'b' }] },
    { questions: [{ text: 'b' }, { text: 'a' }] }), false,
    'порядок вопросов важен');
});

test('canonicalJson: ключи сортированы, функции пропущены', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 0, c: null }] }), '{"a":[2,{"c":null,"d":0}],"b":1}');
  assert.equal(canonicalJson({ createdAt: () => {}, x: 1 }), '{"x":1}');
});
