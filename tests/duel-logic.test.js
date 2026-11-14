// tests/duel-logic.test.js — разрешение ничьих итогового рейтинга дуэлями:
// группы из 2/3/4+ участников, повторные ничьи, несколько групп,
// отключение участника, восстановление серии, решения преподавателя,
// неизменность баллов основного теста и учебных оценок.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tieGroups, roundWinner, duelBank, nextDuelQid, createDuelGroup,
  openDuelRound, applyRound, stopGroup, settleGroup, groupProgress,
  pendingUidsFor, validateDecision, applyDecision, buildDuelsDoc,
  duelGroupsChanged, withGroup, applyDuelPlaces, placesAreUnique,
  duelRounds, duelDocStatus
} from '../core/duel-logic.js';
import { gradeRoster, journalRows } from '../core/pair-grade.js';

// ---------- Помощники ----------

// Строка рейтинга в форме ratingRows (минимум полей, которые читает
// duel-logic): score и correctCount задают группу ничьей.
function row(uid, name, score, correctCount, extra = {}) {
  return { uid, name, score, correctCount, place: 0, streak: 0, trail: "", ...extra };
}

// Прогон дуэли группой раундов: каждый раунд — вердикты участников
// (как их посчитал бы ведущий по ключам теста), состояние сжимается
// settleGroup после каждого раунда, серия останавливается на первом
// не-running статусе.
function playRounds(group, sequence, bankSize) {
  let g = group;
  for (const { qid, verdicts } of sequence) {
    g = applyRound(g, qid, verdicts);
    g = settleGroup(g, bankSize);
    if (g.status !== "running") break;
  }
  return g;
}

function members(rows) {
  return rows.map(r => ({ uid: r.uid, name: r.name }));
}

// Раунд, который выигрывает winnerUid (остальные неверны/пропуск).
const verdictOf = (winnerUid, uids) =>
  Object.fromEntries(uids.map(uid => [uid, uid === winnerUid ? true : false]));
const allDraw = uids => Object.fromEntries(uids.map(uid => [uid, false]));

// ---------- 1. Два участника с равными очками на первом месте ----------

test('ничья на первом месте: дуэль даёт уникальные места 1 и 2', () => {
  const rows = [row('a', 'Аня', 20, 2), row('b', 'Борис', 20, 2)];
  const groups = tieGroups(rows);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].members.map(r => r.uid), ['a', 'b']);

  const doc = buildDuelsDoc({ rows, questionCount: 3 });
  const group = doc.groups[0];
  const finished = playRounds(group, [
    { qid: '0', verdicts: { a: true, b: false } },
    { qid: '1', verdicts: { a: false, b: true } },
    { qid: '2', verdicts: { a: true, b: false } }
  ], 3);
  assert.equal(finished.status, 'resolved');
  assert.deepEqual(finished.order, ['a', 'b']);
  assert.deepEqual(finished.tally, { a: 2, b: 1 });

  const resolved = withGroup(doc, group.id, finished, rows);
  assert.equal(resolved.status, 'resolved');
  const placed = applyDuelPlaces(rows, resolved);
  assert.deepEqual(placed.map(r => r.place), [1, 2]);
  assert.ok(placesAreUnique(placed));
});

// ---------- 2. Два участника с равными очками на втором месте ----------

test('ничья на втором месте: лидер сохраняет место, порядок дуэлянтов по решению', () => {
  const rows = [row('c', 'Вера', 30, 3), row('a', 'Аня', 10, 2), row('b', 'Борис', 10, 2)];
  const doc = buildDuelsDoc({ rows, questionCount: 2 });
  const group = doc.groups[0];
  assert.deepEqual(group.uids, ['a', 'b']);
  const finished = playRounds(group, [
    { qid: '0', verdicts: { a: false, b: true } },
    { qid: '1', verdicts: { a: true, b: false } }
  ], 2);
  // Равные очки серий при исчерпанном банке — не победа автоматически.
  assert.equal(finished.status, 'pending');
  assert.deepEqual(pendingUidsFor(finished, 2), ['a', 'b']);

  const decided = applyDecision(finished, {
    order: ['b', 'a'], reason: 'Дополнительное задание: Борис справился', authorUid: 'host'
  }, 2);
  assert.equal(decided.status, 'resolved');
  const resolvedDoc = withGroup(doc, group.id, decided, rows);
  const placed = applyDuelPlaces(rows, resolvedDoc);
  assert.deepEqual(placed.map(r => r.uid), ['c', 'b', 'a']);
  assert.deepEqual(placed.map(r => r.place), [1, 2, 3]);
  assert.equal(placed.find(r => r.uid === 'c').duelResolved, undefined);
});

// ---------- 3. Три участника с равными очками ----------

test('три участника: серия раундов определяет порядок без пересечений', () => {
  const rows = [row('a', 'Аня', 15, 3), row('b', 'Борис', 15, 3), row('c', 'Вера', 15, 3)];
  const doc = buildDuelsDoc({ rows, questionCount: 6 });
  const group = doc.groups[0];
  assert.equal(group.uids.length, 3);
  const finished = playRounds(group, [
    { qid: '0', verdicts: { a: true, b: false, c: false } },
    { qid: '1', verdicts: { a: false, b: true, c: false } },
    { qid: '2', verdicts: { a: false, b: false, c: true } },
    { qid: '3', verdicts: { a: true, b: false, c: false } },
    { qid: '4', verdicts: { a: false, b: true, c: false } },
    { qid: '5', verdicts: { a: true, b: false, c: false } }
  ], 6);
  assert.equal(finished.status, 'resolved');
  assert.deepEqual(finished.order, ['a', 'b', 'c']);
  assert.deepEqual(finished.tally, { a: 3, b: 2, c: 1 });

  const placed = applyDuelPlaces(rows, withGroup(doc, group.id, finished, rows));
  assert.deepEqual(placed.map(r => r.uid), ['a', 'b', 'c']);
  assert.deepEqual(placed.map(r => r.place), [1, 2, 3]);
  assert.ok(placesAreUnique(placed));
});

// ---------- 4. Четыре и более участников с равными очками ----------

test('четыре участника: равные очки серий требуют явного решения', () => {
  const rows = ['a', 'b', 'c', 'd'].map((uid, i) => row(uid, `У${i}`, 8, 4));
  const doc = buildDuelsDoc({ rows, questionCount: 4 });
  const group = doc.groups[0];
  const finished = playRounds(group, [
    { qid: '0', verdicts: verdictOf('a', group.uids) },
    { qid: '1', verdicts: verdictOf('b', group.uids) },
    { qid: '2', verdicts: verdictOf('c', group.uids) },
    { qid: '3', verdicts: verdictOf('d', group.uids) }
  ], 4);
  // Каждый взял свой раунд — очки серий равны: победителя автоматически
  // не назначаем, порядок принимает преподаватель.
  assert.equal(finished.status, 'pending');
  assert.deepEqual(groupProgress(finished, 4).pendingUids, ['a', 'b', 'c', 'd']);

  const decided = applyDecision(finished, {
    order: ['d', 'c', 'b', 'a'], reason: 'Доп. задание у доски', authorUid: 'host'
  }, 4);
  assert.deepEqual(decided.order, ['d', 'c', 'b', 'a']);
  const placed = applyDuelPlaces(rows, withGroup(doc, group.id, decided, rows));
  assert.deepEqual(placed.map(r => r.uid), ['d', 'c', 'b', 'a']);
  assert.ok(placesAreUnique(placed));
});

// ---------- 5. Повторная ничья после дуэли ----------

test('повторная ничья: серия продолжается следующими раундами, ничья раунда не двигает счёт', () => {
  const rows = [row('a', 'Аня', 12, 2), row('b', 'Борис', 12, 2)];
  const doc = buildDuelsDoc({ rows, questionCount: 4 });
  const group = doc.groups[0];
  const finished = playRounds(group, [
    { qid: '0', verdicts: { a: true, b: false } },
    { qid: '1', verdicts: { a: false, b: true } },   // счёт 1:1
    { qid: '2', verdicts: { a: true, b: true } },    // ничья раунда
    { qid: '3', verdicts: { a: true, b: false } }    // решающий раунд
  ], 4);
  assert.equal(finished.status, 'resolved');
  assert.deepEqual(finished.order, ['a', 'b']);
  assert.deepEqual(finished.tally, { a: 2, b: 1 });
  assert.equal(finished.rounds[2].winner, null, 'ничья раунда не приносит очко');
  assert.ok(placesAreUnique(applyDuelPlaces(rows, withGroup(doc, group.id, finished, rows))));
});

// ---------- 6. Ничья внутри дуэли (банк исчерпан) ----------

test('ничья в дуэли: все раунды вничью — победителя не назначают, требуется решение', () => {
  const rows = [row('a', 'Аня', 9, 3), row('b', 'Борис', 9, 3)];
  const doc = buildDuelsDoc({ rows, questionCount: 2 });
  const group = doc.groups[0];
  const finished = playRounds(group, [
    { qid: '0', verdicts: allDraw(group.uids) },
    { qid: '1', verdicts: { a: true, b: true } }
  ], 2);
  assert.equal(finished.status, 'pending');
  assert.equal(finished.order, null);
  assert.deepEqual(pendingUidsFor(finished, 2), ['a', 'b']);
  // Валидация решения: без порядка, без причины и с чужим участником —
  // ошибка; случайного победителя не появляется.
  assert.ok(validateDecision({ pendingUids: ['a', 'b'], order: [], reason: 'x', authorUid: 'h' }).error);
  assert.ok(validateDecision({ pendingUids: ['a', 'b'], order: ['a', 'b'], reason: '', authorUid: 'h' }).error);
  assert.ok(validateDecision({ pendingUids: ['a', 'b'], order: ['a', 'c'], reason: 'x', authorUid: 'h' }).error);
  assert.ok(validateDecision({ pendingUids: ['a', 'b'], order: ['a', 'a'], reason: 'x', authorUid: 'h' }).error);
  const decided = applyDecision(finished, {
    order: ['a', 'b'], reason: 'Оба ответили одинаково — порядок по доп. заданию', authorUid: 'h'
  }, 2);
  assert.equal(decided.status, 'resolved');
  assert.equal(decided.decision.authorUid, 'h');
  assert.ok(decided.decision.reason.includes('доп. заданию'));
});

// ---------- 7. Несколько групп ничьих ----------

test('несколько независимых групп разрешаются каждая своей дуэлью', () => {
  const rows = [
    row('a', 'Аня', 20, 2), row('b', 'Борис', 20, 2),
    row('c', 'Вера', 5, 1), row('d', 'Глеб', 5, 1),
    row('e', 'Дина', 1, 0)
  ];
  const doc = buildDuelsDoc({ rows, questionCount: 3 });
  assert.equal(doc.groups.length, 2);
  let resolved = doc;
  for (const g of doc.groups) {
    const finished = playRounds(g, [
      { qid: '0', verdicts: verdictOf(g.uids[0], g.uids) },
      { qid: '1', verdicts: verdictOf(g.uids[0], g.uids) }
    ], 3);
    assert.equal(finished.status, 'resolved');
    resolved = withGroup(resolved, g.id, finished, rows);
  }
  assert.equal(resolved.status, 'resolved');
  const placed = applyDuelPlaces(rows, resolved);
  assert.deepEqual(placed.map(r => r.uid), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(placed.map(r => r.place), [1, 2, 3, 4, 5]);
  assert.ok(placesAreUnique(placed));
});

// ---------- 8. Отключение участника ----------

test('отключение участника: остановка серии не назначает победителя произвольно', () => {
  const rows = [row('a', 'Аня', 7, 2), row('b', 'Борис', 7, 2), row('c', 'Вера', 7, 2)];
  const doc = buildDuelsDoc({ rows, questionCount: 4 });
  const group = doc.groups[0];
  let g = playRounds(group, [
    { qid: '0', verdicts: { a: true, b: false, c: null } }
  ], 4);
  // Ответы пропавшего — пропуск: раунд честно забрал тот, кто был верен.
  assert.deepEqual(g.tally, { a: 1, b: 0, c: 0 });
  // Участник вышел из сети — ведущий останавливает серию.
  g = stopGroup(g, 'Борис отключился и не может продолжить');
  g = settleGroup(g, 4);
  assert.equal(g.status, 'pending');
  assert.ok(g.stoppedReason.includes('отключился'));
  // Неразрешённые — набравшие равные очки серий; лидер зафиксирован.
  assert.deepEqual(pendingUidsFor(g, 4), ['b', 'c']);
  const decided = applyDecision(g, {
    order: ['c', 'b'], reason: 'Борис отключился; порядок по доп. заданию', authorUid: 'h'
  }, 4);
  assert.equal(decided.status, 'resolved');
  assert.deepEqual(decided.order, ['a', 'c', 'b']);
  assert.ok(placesAreUnique(applyDuelPlaces(rows, withGroup(doc, group.id, decided, rows))));
});

// ---------- 9. Восстановление незавершённой дуэли ----------

test('восстановление: открытый раунд и ответы сохранены — закрытие даёт тот же итог', () => {
  const rows = [row('a', 'Аня', 11, 2), row('b', 'Борис', 11, 2)];
  const doc = buildDuelsDoc({ rows, questionCount: 3 });
  const group = doc.groups[0];
  // Ведущий открыл раунд 1 (вопрос 1) и пропал: состояние в Firestore.
  const opened = openDuelRound(group, 3);
  assert.equal(opened.currentRound, 1);
  assert.equal(opened.currentQid, '0');
  assert.equal(doc.status, 'running');

  // Страница ведущего перезагрузилась: состояние читается из документа,
  // ответы раунда — из подколлекции; закрытие даёт тот же результат, что
  // и без пропадания.
  const savedAnswers = { [`${group.id}__1__a`]: 'раз', [`${group.id}__1__b`]: null };
  const verdicts = {
    a: savedAnswers[`${group.id}__1__a`] != null ? true : null,
    b: null
  };
  const resumed = settleGroup(applyRound(opened, opened.currentQid, verdicts), 3);
  assert.deepEqual(resumed.tally, { a: 1, b: 0 });
  // Досыгранная серия завершается тем же исходом, что и живой прогон.
  const finished = playRounds(resumed, [
    { qid: '1', verdicts: { a: false, b: true } },
    { qid: '2', verdicts: { a: true, b: false } }
  ], 3);
  assert.equal(finished.status, 'resolved');
  assert.deepEqual(finished.order, ['a', 'b']);
  assert.deepEqual(finished.rounds.map(r => r.qid), ['0', '1', '2'],
    'использованные вопросы не повторяются');
});

test('восстановление: пересборка документа не затирает раунды и решения', () => {
  const rows = [row('a', 'Аня', 6, 1), row('b', 'Борис', 6, 1)];
  let doc = buildDuelsDoc({ rows, questionCount: 2 });
  let finished = playRounds(doc.groups[0], [
    { qid: '0', verdicts: allDraw(doc.groups[0].uids) },
    { qid: '1', verdicts: allDraw(doc.groups[0].uids) }
  ], 2);
  assert.equal(finished.status, 'pending');
  doc = withGroup(doc, doc.groups[0].id, finished, rows);
  doc = withGroup(doc, doc.groups[0].id, applyDecision(doc.groups[0], {
    order: ['b', 'a'], reason: 'Решил ведущий после проверки тетрадей', authorUid: 'h'
  }, 2), rows);
  assert.equal(doc.status, 'resolved');

  // Ведущий переоткрыл страницу: пересборка с существующим документом
  // сохраняет историю (та же группа по составу участников).
  assert.equal(duelGroupsChanged(doc, tieGroups(rows)), false);
  const rebuilt = buildDuelsDoc({ rows, existing: doc, questionCount: 2 });
  assert.deepEqual(rebuilt.groups[0].rounds, doc.groups[0].rounds);
  assert.deepEqual(rebuilt.groups[0].decision, doc.groups[0].decision);
  assert.deepEqual(rebuilt.order, doc.order);
});

// ---------- 10. Отсутствие повторяющихся мест в финальном рейтинге ----------

test('финальный рейтинг: без повторяющихся мест после разрешения всех групп', () => {
  const rows = [
    row('a', 'Аня', 30, 3), row('b', 'Борис', 30, 3),
    row('c', 'Вера', 30, 3),
    row('d', 'Глеб', 10, 2), row('e', 'Дина', 10, 2),
    row('f', 'Егор', 5, 1), row('g', 'Жанна', 5, 1)
  ];
  const doc = buildDuelsDoc({ rows, questionCount: 4 });
  let resolved = doc;
  for (const g of doc.groups) {
    let fin = playRounds(g, [
      { qid: '0', verdicts: allDraw(g.uids) },
      { qid: '1', verdicts: verdictOf(g.uids[g.uids.length - 1], g.uids) }
    ], 4);
    // Серия не определила порядок (есть равные очки) — явное решение:
    // порядок внутри неразрешённого уровня — по решению.
    const pending = pendingUidsFor(fin, 4);
    fin = applyDecision(fin, {
      order: [...pending].reverse(), reason: 'Решение преподавателя', authorUid: 'h'
    }, 4);
    resolved = withGroup(resolved, g.id, fin, rows);
  }
  const placed = applyDuelPlaces(rows, resolved);
  assert.ok(placesAreUnique(placed));
  assert.deepEqual(placed.map(r => r.place),
    Array.from({ length: rows.length }, (_, i) => i + 1));
});

test('пока есть неразрешённая группа — места остаются общими с пометкой', () => {
  const rows = [
    row('a', 'Аня', 10, 2, { place: 1 }),
    row('b', 'Борис', 10, 2, { place: 1 }),
    row('c', 'Вера', 5, 1, { place: 3 })
  ];
  const doc = buildDuelsDoc({ rows, questionCount: 2 });
  const placed = applyDuelPlaces(rows, doc);
  // Места из ratingRows не переписаны: 1, 1, 3 — победителя нет.
  assert.deepEqual(placed.map(r => r.place), [1, 1, 3]);
  assert.equal(placed[0].duelPending, true);
  assert.equal(placed[1].duelPending, true);
  assert.equal(placed[2].duelPending, undefined);
  // Документ без групп ничего не меняет.
  assert.deepEqual(applyDuelPlaces(rows, null).map(r => r.place), [1, 1, 3]);
});

// ---------- 11. Неизменность исходных баллов основного теста ----------

test('баллы основного теста не меняются: исходные строки не мутируются', () => {
  const rows = [row('a', 'Аня', 25, 2, { trail: 'ttff' }), row('b', 'Борис', 25, 2, { trail: 'fftt' })];
  const snapshot = JSON.stringify(rows);
  const doc = buildDuelsDoc({ rows, questionCount: 2 });
  const finished = playRounds(doc.groups[0], [
    { qid: '0', verdicts: { a: true, b: false } },
    { qid: '1', verdicts: { a: true, b: false } }
  ], 2);
  const placed = applyDuelPlaces(rows, withGroup(doc, doc.groups[0].id, finished, rows));
  assert.equal(JSON.stringify(rows), snapshot, 'входные строки рейтинга не изменены');
  for (const r of placed) {
    assert.equal(r.score, 25);
    assert.equal(r.correctCount, 2);
    assert.equal(r.trail, r.uid === 'a' ? 'ttff' : 'fftt');
  }
  // Дуэльные раунды — сравнение вердиктов, не очков: duelRounds не
  // пересчитывает score и работает по старому контракту.
  const cmp = duelRounds(
    { verdicts: [{ qid: 0, verdict: true }, { qid: 1, verdict: false }] },
    { verdicts: [{ qid: 0, verdict: false }, { qid: 1, verdict: true }] }
  );
  assert.equal(cmp.winsA, 1);
  assert.equal(cmp.winsB, 1);
  assert.equal(cmp.rounds[0].winner, 'a');
});

// ---------- 12. Неизменность учебных оценок после дуэли ----------

test('учебные оценки не меняются: ответы дуэли не попадают в players/answers', () => {
  const keysByPos = [
    { type: 'single', correct: [0], points: 2 },
    { type: 'short', answer: 'пар', points: 1 }
  ];
  const players = [
    { uid: 'a', name: 'Аня', answers: { 0: 0, 1: 'пар' } },
    { uid: 'b', name: 'Борис', answers: { 0: 0 } },
    { uid: 'c', name: 'Вера', observer: true, answers: { 0: 0, 1: 'пар' } }
  ];
  const before = gradeRoster({ players, keysByPos });
  const rows = [row('a', 'Аня', 3, 2), row('b', 'Борис', 3, 2)];
  const doc = buildDuelsDoc({ rows, questionCount: 2 });
  const finished = playRounds(doc.groups[0], [
    { qid: '0', verdicts: { a: true, b: false } },
    { qid: '1', verdicts: { a: true, b: false } }
  ], 2);
  const placed = applyDuelPlaces(rows, withGroup(doc, doc.groups[0].id, finished, rows));
  assert.ok(placesAreUnique(placed));
  // Результаты дуэлей хранятся отдельно (duels/final/answers), players
  // не изменялись — оценки и журнал те же.
  const after = gradeRoster({ players, keysByPos });
  assert.deepEqual(journalRows(after), journalRows(before));
  assert.deepEqual(after.map(r => r.grade), before.map(r => r.grade));
});

// ---------- Совместимость и служебные контракты ----------

test('комнаты без ничьих: дуэли не нужны, поведение прежнее', () => {
  const rows = [
    row('a', 'Аня', 10, 2, { place: 1 }),
    row('b', 'Борис', 8, 1, { place: 2 }),
    row('c', 'Вера', 4, 0, { place: 3 })
  ];
  assert.equal(tieGroups(rows).length, 0);
  const doc = buildDuelsDoc({ rows, questionCount: 3 });
  assert.deepEqual(doc.groups, []);
  assert.equal(doc.status, 'resolved');
  assert.deepEqual(applyDuelPlaces(rows, doc).map(r => r.place), [1, 2, 3]);
  assert.equal(duelDocStatus([]), 'resolved');
});

test('старые комнаты: строки без correctCount не ломают разбор групп', () => {
  const rows = [row('a', 'Аня', 10, undefined, { place: 1 }), row('b', 'Борис', 10, undefined, { place: 1 })];
  const groups = tieGroups(rows);
  assert.equal(groups.length, 1);
  const doc = buildDuelsDoc({ rows, questionCount: 1 });
  assert.equal(doc.groups.length, 1);
  // Банк из 0 вопросов: раунд открыть нельзя, остаётся решение.
  assert.deepEqual(duelBank(0), []);
  assert.equal(nextDuelQid([], []), null);
  const opened = openDuelRound(doc.groups[0], 0);
  assert.equal(opened, null);
});

test('банк вопросов: каждый вопрос не повторяется, исчерпание возвращает null', () => {
  const bank = duelBank(3);
  assert.deepEqual(bank, ['0', '1', '2']);
  assert.equal(nextDuelQid(bank, []), '0');
  assert.equal(nextDuelQid(bank, ['0', '1']), '2');
  assert.equal(nextDuelQid(bank, ['0', '1', '2']), null);
});

test('roundWinner: единственный верный побеждает, два верных — ничья', () => {
  assert.equal(roundWinner({ a: true, b: false }), 'a');
  assert.equal(roundWinner({ a: false, b: true }), 'b');
  assert.equal(roundWinner({ a: true, b: true, c: false }), null);
  assert.equal(roundWinner({ a: false, b: null }), null);
  assert.equal(roundWinner({}), null);
});

test('старый рейтинг не затронут: ratingRows остаётся с общими местами', async () => {
  const { ratingRows } = await import('../core/live-auto.js');
  const scores = [
    { uid: 'a', name: 'Аня', score: 10, correctCount: 2 },
    { uid: 'b', name: 'Борис', score: 10, correctCount: 2 },
    { uid: 'c', name: 'Вера', score: 4, correctCount: 1 }
  ];
  const rows = ratingRows({ scores, players: [], questionCount: 2, finished: 2, lifecycle: 'completed' });
  assert.deepEqual(rows.map(r => r.place), [1, 1, 3]);
});
