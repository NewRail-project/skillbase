import test from "node:test";
import assert from "node:assert/strict";
import {
  pairGradeValue, gradePlayer, gradeRoster, journalRows, journalAverage,
  GRADE_STATUS, GRADE_STATUS_LABEL
} from "../core/pair-grade.js";

const keys = Array.from({ length: 10 }, () => ({ type: "single", points: 1, correct: [0] }));
const answersOf = (right, answeredAll = true) => {
  const out = {};
  for (let i = 0; i < 10; i++) {
    if (i < right) out[i] = 0;            // правильный ответ
    else if (answeredAll) out[i] = 1;     // неправильный ответ
    // иначе — пропуск
  }
  return out;
};

test("журнал: участник с ответами", () => {
  // 5 верных, 5 неверных, на все ответил: 90×5/10 + 10×10/10 = 55.
  const grades = gradeRoster({ players: [{ uid: "a", name: "Андрей", answers: answersOf(5) }], keysByPos: keys });
  const journal = journalRows(grades);
  assert.strictEqual(journal.length, 1);
  assert.strictEqual(journal[0].n, 1);
  assert.strictEqual(journal[0].name, "Андрей");
  assert.strictEqual(journal[0].status, GRADE_STATUS.GRADED);
  assert.strictEqual(journal[0].statusLabel, "Участвовал");
  assert.strictEqual(journal[0].correct, 5);
  assert.strictEqual(journal[0].wrong, 5);
  assert.strictEqual(journal[0].skipped, 0);
  assert.strictEqual(journal[0].total, 10);
  assert.strictEqual(journal[0].grade, 55);
  assert.strictEqual(journal[0].label, String(55));
});

test("журнал: участник без ответов — оценка 0 и статус", () => {
  const grades = gradeRoster({ players: [{ uid: "b", name: "Борис", answers: {} }], keysByPos: keys });
  const journal = journalRows(grades);
  assert.strictEqual(journal.length, 1);
  assert.strictEqual(journal[0].status, GRADE_STATUS.ZERO);
  assert.strictEqual(journal[0].statusLabel, GRADE_STATUS_LABEL.zero);
  assert.strictEqual(journal[0].correct, 0);
  assert.strictEqual(journal[0].wrong, 0);
  assert.strictEqual(journal[0].skipped, 10);
  assert.strictEqual(journal[0].total, 10);
  assert.strictEqual(journal[0].grade, 0);
});

test("журнал: наблюдатель исключён", () => {
  for (const p of [
    { uid: "c", name: "Константин", answers: { 0: 0 }, observer: true },
    { uid: "c2", name: "Ольга", answers: { 0: 0 }, role: "observer" },
    { uid: "c3", name: "Хост", answers: { 0: 0 }, isAdminPlayer: true }
  ]) {
    const journal = journalRows(gradeRoster({ players: [p], keysByPos: keys }));
    assert.strictEqual(journal.length, 0, `исключается: ${p.name}`);
  }
});

test("журнал: не вошедший пользователь не попадает (только players комнаты)", () => {
  // В Live журнал строится из local.players: кого нет среди игроков —
  // того нет в журнале. absent-строки передаются только в истории группы.
  const journal = journalRows(gradeRoster({ players: [], keysByPos: keys }));
  assert.strictEqual(journal.length, 0);
  // А отсутствующий из списка группы помечается отдельно и без оценки.
  const withAbsent = journalRows(gradeRoster({
    players: [{ uid: "a", name: "Андрей", answers: answersOf(10) }],
    absent: [{ uid: "z", name: "Забыл" }]
  }));
  assert.strictEqual(withAbsent.length, 2);
  const absentRow = withAbsent.find(r => r.uid === "z");
  assert.strictEqual(absentRow.statusLabel, GRADE_STATUS_LABEL.absent);
  assert.strictEqual(absentRow.grade, null);
});

test("журнал: отключение после входа — строка остаётся", () => {
  // players/{uid} живёт после отключения: строка не удаляется.
  const journal = journalRows(gradeRoster({
    players: [{ uid: "d", name: "Дмитрий", answers: answersOf(3) }],
    keysByPos: keys
  }));
  assert.strictEqual(journal.length, 1);
  assert.strictEqual(journal[0].name, "Дмитрий");
  assert.strictEqual(journal[0].grade, 37); // 90×3/10 + 10
});

test("журнал: повторное подключение не создаёт вторую строку", () => {
  // Один uid встречается дважды (стороронний источник) → первый вход выигрывает.
  const journal = journalRows(gradeRoster({
    players: [
      { uid: "e", name: "Елена", answers: answersOf(4) },
      { uid: "e", name: "Елена (повтор)", answers: answersOf(9) }
    ],
    keysByPos: keys
  }));
  assert.strictEqual(journal.length, 1);
  assert.strictEqual(journal[0].name, "Елена");
  assert.strictEqual(journal[0].grade, 46); // 90×4/10 + 10
});

test("журнал: сортировка по ФИО (алфавит)", () => {
  const journal = journalRows(gradeRoster({
    players: [
      { uid: "z", name: "Зоя", answers: { 0: 0 } },
      { uid: "a", name: "Анна", answers: { 0: 0 } },
      { uid: "m", name: "Михаил", answers: { 0: 0 } }
    ],
    keysByPos: keys
  }));
  assert.deepStrictEqual(journal.map(r => r.name), ["Анна", "Зоя", "Михаил"]);
  assert.deepStrictEqual(journal.map(r => r.n), [1, 2, 3]);
});

test("журнал: правильность оценки — 82 за 8 из 10", () => {
  const journal = journalRows(gradeRoster({
    players: [{ uid: "t", name: "Тест", answers: answersOf(8) }],
    keysByPos: keys
  }));
  assert.strictEqual(journal[0].grade, 82); // 90×8/10 + 10×10/10
  assert.strictEqual(journal[0].status, GRADE_STATUS.GRADED);
});

test("журнал: взвешенные вопросы", () => {
  const weighted = [
    { type: "single", points: 10, correct: [0] },
    { type: "single", points: 5, correct: [0] },
    { type: "single", points: 5, correct: [0] }
  ];
  // Вернул только тяжёлый вопрос: 90×10/20 + 10×1/3 ≈ 45 + 3.33 → 48.
  const journal = journalRows(gradeRoster({
    players: [{ uid: "w", name: "Вера", answers: { 0: 0 } }],
    keysByPos: weighted
  }));
  assert.strictEqual(journal[0].correct, 1);
  assert.strictEqual(journal[0].wrong, 0);
  assert.strictEqual(journal[0].skipped, 2);
  assert.strictEqual(journal[0].grade, 48);
});

test("журнал: независимость оценки от рейтинга и дуэлей", () => {
  const base = { uid: "r", name: "Рейтинг", answers: answersOf(8) };
  const plain = journalRows(gradeRoster({ players: [base], keysByPos: keys }))[0];
  const noisy = journalRows(gradeRoster({
    players: [{ ...base, score: 1500, place: 1, streak: 7, bestStreak: 9,
      duelResolved: true, duelPending: true, duelGroup: "g1", trail: "↑" }],
    keysByPos: keys
  }))[0];
  assert.strictEqual(plain.grade, noisy.grade, "рейтинг/дуэли не меняют оценку");
  assert.strictEqual(noisy.grade, 82);
});

test("журнал: отсутствие дубликатов участников", () => {
  const grades = gradeRoster({
    players: [
      { uid: "s", name: "Сергей", answers: { 0: 0 } },
      { uid: "s", name: "Сергей (повтор)", answers: { 1: 1 } },
      { uid: "f", name: "Фёдор", answers: { 0: 0 } }
    ],
    keysByPos: keys
  });
  assert.strictEqual(grades.length, 2);
  const uids = grades.map(g => g.uid);
  assert.strictEqual(new Set(uids).size, uids.length);
});

test("журнал: неправильный ответ ≠ отсутствие участия", () => {
  const g = gradePlayer({ uid: "x", name: "Ксения", answers: { 0: 1 } }, keys);
  assert.strictEqual(g.answered, 1);
  assert.strictEqual(g.correctCount, 0);
  assert.strictEqual(g.status, GRADE_STATUS.GRADED, "ответивший неверный — graded, не zero");
  assert.strictEqual(g.grade, 1); // 90×0 + 10×1/10
});

test("журнал: средний балл — null на пустом, среднее по выставленным", () => {
  assert.strictEqual(journalAverage(gradeRoster({ players: [] })), null);
  const grades = gradeRoster({
    players: [
      { uid: "s1", name: "Студент1", answers: answersOf(8) },
      { uid: "s2", name: "Студент2", answers: answersOf(6) }
    ],
    keysByPos: keys
  });
  // (82 + 64) / 2 = 73.
  assert.strictEqual(journalAverage(grades), 73);
});

test("журнал: строка несёт все колонки по ТЗ", () => {
  const row = journalRows(gradeRoster({
    players: [{ uid: "x", name: "Иван", answers: answersOf(7) }],
    keysByPos: keys
  }))[0];
  for (const field of ["n", "name", "statusLabel", "grade", "correct", "wrong", "skipped", "total", "label"]) {
    assert.ok(field in row, `journalRows возвращает ${field}`);
  }
  // correct + wrong + skipped = total.
  assert.strictEqual(row.correct + row.wrong + row.skipped, row.total);
});
