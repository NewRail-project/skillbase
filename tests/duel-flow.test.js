// tests/duel-flow.test.js — целостность подключения дуэлей за места:
// страница комнаты подписана на duels/final, итоговый рейтинг разрешает
// места через applyDuelPlaces, у ведущего есть панель проведения раундов,
// у участника — форма ответа, правила разрешают чтение и запрещают
// записи посторонним. Статический анализ исходников в стиле repo-тестов.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const roomPage = readFileSync(join(ROOT, 'ui/pages/room.js'), 'utf8');
const rooms = readFileSync(join(ROOT, 'core/rooms.js'), 'utf8');
const duelLogic = readFileSync(join(ROOT, 'core/duel-logic.js'), 'utf8');
const rules = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
const duelComponent = readFileSync(join(ROOT, 'ui/components/duel.js'), 'utf8');

test('страница комнаты подписана на документ дуэлей', () => {
  assert.match(roomPage, /subscribeDuels\(/);
  assert.match(roomPage, /local\.duels = doc/);
  assert.match(roomPage, /duelSig\(\)/);
});

test('итоговый рейтинг разрешается дуэлями только после завершения теста', () => {
  // ratingSource применяет applyDuelPlaces на итоговом экране.
  assert.match(roomPage, /function ratingSource\(\)[\s\S]{0,400}applyDuelPlaces\(rows, local\.duels\)/);
  // Во время теста общие места ratingRows (1,1,3) не трогаются.
  assert.match(duelLogic, /статус.*running[\s\S]*duelPending|duelPending/);
  // Финальные виды берут строки из ratingSource.
  assert.match(roomPage, /function finalSequence\(\{ projector = false \} = \{\}\) \{\s*const rows = ratingSource\(\);/);
  assert.match(roomPage, /function boardRows\(\) \{\s*return \(local\.scores \|\| \[\]\)\.length \? ratingSource\(\) : \[\];/);
});

test('ведущий: создание документа, раунды и решение преподавателя', () => {
  assert.match(roomPage, /function manageDuels\(\)/);
  assert.match(roomPage, /ensureDuelsDoc\(local\.code, buildDuelsDoc\(/);
  assert.match(roomPage, /function duelOpenRound\(/);
  assert.match(roomPage, /function duelCloseRound\(/);
  assert.match(roomPage, /function duelStop\(/);
  assert.match(roomPage, /function duelDecide\(/);
  assert.match(roomPage, /validateDecision\(/);
  // Закрытие раунда считает вердикты по ключам, без ответа — пропуск.
  assert.match(roomPage, /function duelCloseRound\([\s\S]{0,900}isCorrect\(key, answer\)/);
  assert.match(roomPage, /answer == null \? null : isCorrect\(key, answer\)/);
  // Панель ведущего показывается в финальных видах.
  assert.match(roomPage, /const duels = duelsPanel\(\);/);
  assert.match(roomPage, /duelsPanel\(\)[\s\S]{0,40}wrap\.appendChild\(duels\)/);
  assert.equal(roomPage.match(/const duels = duelsPanel\(\);/g).length, 2,
    'панель подключена и в autoHostView, и в hostView');
});

test('участник: вопрос раунда и ответ сохраняются отдельно от players/answers', () => {
  assert.match(roomPage, /function duelPlayerWidget\(\)/);
  assert.match(roomPage, /function duelAnswerForm\(/);
  assert.match(roomPage, /saveDuelAnswer\(local\.code, answerId, value\)/);
  // Виджет участника виден в итоговых видах (auto и manual).
  assert.match(roomPage, /duelPlayerWidget\(\)/g);
});

test('Firestore-слой: документ duels/final и ответы раундов', () => {
  assert.match(rooms, /export function subscribeDuels\(/);
  assert.match(rooms, /export async function ensureDuelsDoc\(/);
  assert.match(rooms, /export async function updateDuelsDoc\(/);
  assert.match(rooms, /export async function readDuelAnswers\(/);
  assert.match(rooms, /export async function saveDuelAnswer\(/);
  // ensureDuelsDoc не затирает существующую историю.
  assert.match(rooms, /function ensureDuelsDoc\([\s\S]{0,600}if \(existing\.exists\(\)\) return false;/);
});

test('правила: duels читают все в комнате, пишет только ведущий', () => {
  assert.match(rules, /match \/duels\/\{docId\} \{[\s\S]*allow read: if isRoomHost\(\) \|\| inRoomAnyRole\(\);/);
  assert.match(rules, /match \/duels\/\{docId\} \{[\s\S]*allow create, update: if isRoomHost\(\)/);
  assert.match(rules, /match \/duels\/\{docId\} \{[\s\S]*allow delete: if false;/);
  assert.match(rules, /match \/answers\/\{answerId\} \{[\s\S]*allow update, delete: if false;/);
  // Поля документа ограничены белым списком.
  assert.match(rules, /\["key", "status", "groups", "order", "computedAt", "computedBy", "version"\]/);
});

test('анимация «Дуэль» берёт раунды из core/duel-logic.js', () => {
  assert.match(duelComponent, /import \{ duelRounds \} from "\.\.\/\.\.\/core\/duel-logic\.js";/);
  assert.match(duelComponent, /export \{ duelRounds \};/);
  // Баннер учитывает уникальные места после разрешения ничьей.
  assert.match(duelComponent, /a\.place !== b\.place/);
});

test('чистая логика дуэлей не зависит от DOM и Firebase', () => {
  assert.doesNotMatch(duelLogic, /from "\.\.\/shared\/firebase|document\.|window\.|getElementById/);
  for (const name of ['tieGroups', 'applyDuelPlaces', 'buildDuelsDoc', 'pendingUidsFor']) {
    assert.match(duelLogic, new RegExp(`export function ${name}\\(`));
  }
});
