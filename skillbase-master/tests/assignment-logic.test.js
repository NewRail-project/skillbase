import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignmentKindLabel, assignmentBadgeClass,
  isAssignmentVisible, assignmentState, STATE_LABEL,
  sortAssignments, validateAssignmentDraft, deadlineSubtitle
} from '../core/assignment-logic.js';

const NOW = new Date('2026-10-27T10:00:00Z').getTime();
const DAY = 86_400_000;
const assignment = (id, extra = {}) => ({ id, testId: id, testTitle: `Тест ${id}`, kind: 'exam', ...extra });

test('Бейджи «Обучение» и «Проверка»', () => {
  assert.equal(assignmentKindLabel({ kind: 'training' }), 'Обучение');
  assert.equal(assignmentKindLabel({ kind: 'exam' }), 'Проверка');
  assert.equal(assignmentKindLabel({}), 'Проверка', 'по умолчанию exam');
  assert.equal(assignmentBadgeClass({ kind: 'training' }), 'badge badge-info');
});

test('isAssignmentVisible: без startAt видно, в будущем — нет', () => {
  assert.equal(isAssignmentVisible(assignment('a1'), NOW), true);
  assert.equal(isAssignmentVisible(assignment('a2', { startAt: null }), NOW), true);
  assert.equal(isAssignmentVisible(assignment('a3', { startAt: NOW + DAY }), NOW), false);
  assert.equal(isAssignmentVisible(assignment('a4', { startAt: NOW - DAY }), NOW), true);
});

test('assignmentState: выполнено по отправленной попытке', () => {
  const attempts = [{ assignmentId: 'a1', status: 'graded' }];
  assert.equal(assignmentState(assignment('a1'), attempts, NOW), 'done');
  assert.equal(STATE_LABEL['done'], 'Выполнено');
  // Незавершённая попытка не считается выполнением.
  const attemptsIncomplete = [{ assignmentId: 'a1', status: 'in_progress' }];
  assert.notEqual(assignmentState(assignment('a1'), attemptsIncomplete, NOW), 'done');
});

test('assignmentState: просрочено и срок сегодня', () => {
  assert.equal(assignmentState(assignment('a1', { deadline: NOW - DAY }), [], NOW), 'overdue');
  assert.equal(STATE_LABEL['overdue'], 'Просрочено');
  assert.equal(assignmentState(assignment('a2', { deadline: NOW + 60_000 }), [], NOW), 'dueToday');
  assert.equal(STATE_LABEL['dueToday'], 'Срок сегодня');
  assert.equal(assignmentState(assignment('a3', {}), [], NOW), 'open');
  assert.equal(assignmentState(assignment('a4', { startAt: NOW + DAY }), [], NOW), 'scheduled');
  assert.equal(STATE_LABEL['scheduled'], 'Запланировано');
});

test('sortAssignments: срочность — просроченные сверху, запланированные снизу', () => {
  const list = [
    assignment('plain'),
    assignment('soon', { deadline: NOW + 30_000 }),
    assignment('past', { deadline: NOW - 2 * DAY }),
    assignment('yesterday', { deadline: NOW - DAY }),
    assignment('future', { startAt: NOW + DAY })
  ];
  const sorted = sortAssignments(list, [], NOW);
  assert.deepEqual(
    sorted.map(a => a.id),
    ['past', 'yesterday', 'soon', 'plain', 'future']
  );
});

test('validateAssignmentDraft: kind и материалы', () => {
  assert.ok(validateAssignmentDraft({ kind: 'training', deadline: 123 }).ok,
    'training со сроком валиден');
  assert.equal(validateAssignmentDraft({ kind: 'training' }).ok, false,
    'training без срока не проходит');

  assert.equal(validateAssignmentDraft({ kind: 'webinar' }).ok, false,
    'неизвестный kind отклоняется');

  const longNote = 'x'.repeat(201);
  assert.equal(validateAssignmentDraft({ kind: 'exam', note: longNote }).ok, false);

  const longText = 'y'.repeat(6001);
  assert.equal(validateAssignmentDraft({ kind: 'exam', materialText: longText }).ok, false);

  assert.equal(
    validateAssignmentDraft({ kind: 'exam', materialUrl: 'http://example.com' }).ok,
    false,
    'ссылка не по https отклоняется'
  );
  assert.ok(
    validateAssignmentDraft({ kind: 'exam', materialUrl: 'https://example.com/a' }).ok
  );
  assert.equal(
    validateAssignmentDraft({ kind: 'exam', materialUrl: 'https://' + 'z'.repeat(500) }).ok,
    false,
    'слишком длинная ссылка отклоняется'
  );
});

test('deadlineSubtitle: просрочено, сегодня, осталось дней', () => {
  assert.match(deadlineSubtitle({ toMillis: () => NOW - DAY + 1000 }, NOW), /просрочено/);
  assert.match(deadlineSubtitle({ toMillis: () => NOW + 1000 }, NOW), /сегодня/);
  assert.match(deadlineSubtitle({ toMillis: () => NOW + 3 * DAY }, NOW), /осталось 3 дн./);
  assert.match(deadlineSubtitle(null, NOW), /не указан/);
});
