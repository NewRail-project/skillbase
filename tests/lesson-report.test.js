// tests/lesson-report.test.js — итоговый отчёт занятия, оценка, готовность.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLessonReport, recommendGrade, gradeFromPercent, testResult, dynamicsOf, readinessOf,
  READINESS_NOTE
} from "../core/lesson-report.js";
import { normalizePlan, newRun, advance } from "../core/lesson-plan.js";
import { splitTask, evaluateSubmission, compareTeams } from "../core/practical.js";

const L = (text) => ({ t: "label", text });
const A = (accept) => ({ t: "answer", mode: "text", accept });
const task = (t) => ({ title: t, columns: ["П", "З"], rows: [[L("x"), A(["да"])], [L("y"), A(["нет"])]] });
const plan = normalizePlan({ topic: "Датчики", materialId: "m", entryTestId: "e", finalTestId: "f", tasks: { a: task("А"), b: task("Б") } });

const det = (uid, name, correct, total = 10, status = "graded") => ({ uid, name, status, grade: correct * 9, earned: correct, max: total, answered: status === "zero" ? 0 : total, total, correctCount: correct });
const bp = (uid, teamId, grade, extra = {}) => ({ uid, name: uid, teamId, isCaptain: false, isReserve: false, substituted: false, eliminated: false, availableQuestions: 5, participatedQuestions: 5, accuracyPercent: grade, participationPercent: 100, battleGrade: grade, ...extra });

function fullRun() {
  let run = newRun(plan, { id: "R1", nowMs: 1 });
  run = advance(run, plan, {}, 2);
  run = advance(run, plan, { entryCompleted: true }, 3);
  run = advance(run, plan, { battleFinished: true }, 4);
  run = advance(run, plan, { practicalConfirmed: true }, 5);
  run = advance(run, plan, { finalCompleted: true }, 6);
  return run;
}
function practicalData() {
  const a = splitTask(task("А")), b = splitTask(task("Б"));
  const ea = evaluateSubmission({ pub: a.publicTask, keys: a.keys, cells: { r0c1: "да", r1c1: "нет" } });
  const eb = evaluateSubmission({ pub: b.publicTask, keys: b.keys, cells: { r0c1: "да", r1c1: "?" } });
  return {
    tasks: { a: a.publicTask, b: b.publicTask }, evaluations: { a: ea, b: eb },
    comparison: compareTeams(ea, eb),
    submissions: { a: { by: "u1", submittedAt: 10 }, b: { by: "u3", submittedAt: 11 } },
    expected: { a: { r0c1: "да" } }, confirmedAt: 99
  };
}
const inputs = () => ({
  plan, run: fullRun(), hostName: "Иванов И.И.", dateMs: 1700000000000,
  entry: { studentsDetail: [det("u1", "Анна", 4), det("u2", "Борис", 6), det("u3", "Вера", 5), det("u4", "Глеб", 0, 10, "absent")] },
  final: { studentsDetail: [det("u1", "Анна", 8), det("u2", "Борис", 6), det("u3", "Вера", 9)] },
  battle: { winner: "a", tie: false, scores: { a: 30, b: 20 }, players: [bp("u1", "a", 80), bp("u2", "a", 60), bp("u3", "b", 70), bp("u5", "b", 0, { battleGrade: null, availableQuestions: 0, isReserve: true })] },
  practical: practicalData()
});

test("общая статистика: тема, преподаватель, участники, тесты, динамика, победители", () => {
  const r = buildLessonReport(inputs());
  assert.equal(r.lesson.topic, "Датчики");
  assert.equal(r.lesson.hostName, "Иванов И.И.");
  assert.equal(r.participants, 5, "u1..u5 — все, кто есть в данных");
  assert.equal(r.summary.entry.participants, 3, "u4 не участвовал — не в среднем и не нулём");
  assert.equal(r.summary.entry.averagePercent, 50);
  assert.equal(r.summary.final.averagePercent, 76.7);
  assert.equal(r.summary.dynamics.improved, 2);
  assert.equal(r.summary.battle.winner, "a");
  assert.equal(r.summary.practical.winner, "a", "А: 100%, Б: 50%");
  assert.equal(r.completion.percent, 100);
  assert.equal(r.version, 1);
});

test("индивидуально: проценты, динамика, этапы; отсутствующий — не ноль", () => {
  const r = buildLessonReport(inputs());
  const by = (uid) => r.people.find(p => p.uid === uid);
  assert.equal(by("u1").entry.percent, 40);
  assert.equal(by("u1").final.percent, 80);
  assert.deepEqual([by("u1").dynamics.delta, by("u1").dynamics.label], [40, "Рост"]);
  assert.equal(by("u2").dynamics.label, "Без существенных изменений");
  const absent = by("u4");
  assert.equal(absent.entry.available, false);
  assert.equal(absent.stages.entry_test, "missed");
  assert.equal(absent.dynamics.available, false);
  assert.equal(absent.recommended.grade, null, "нет результатов — оценка не выставляется");
  assert.equal(by("u1").stages.final_test, "done");
});

test("рекомендуемая оценка: прозрачные компоненты, веса пересчитаны по имеющимся", () => {
  const rec = recommendGrade({ entry: 40, battle: 80, practical: 100, final: 80 });
  assert.equal(rec.percent, 0.2 * 40 + 0.25 * 80 + 0.15 * 100 + 0.4 * 80);
  assert.equal(rec.grade, 4);
  assert.equal(rec.components.filter(c => c.used).length, 4);
  assert.equal(rec.components.reduce((s, c) => s + c.share, 0), 100);
  // Нет входного теста: вес не превращается в 0 %, а перераспределяется.
  const noEntry = recommendGrade({ entry: null, battle: 80, practical: 100, final: 80 });
  assert.equal(noEntry.components.find(c => c.key === "entry").used, false);
  assert.equal(noEntry.percent, Math.round(((25 * 80 + 15 * 100 + 40 * 80) / 80) * 10) / 10);
  assert.ok(noEntry.percent > recommendGrade({ entry: 0, battle: 80, practical: 100, final: 80 }).percent, "ноль за пропуск был бы строже");
});

test("командный результат не заменяет личных: без личных данных оценки нет", () => {
  const onlyTeam = recommendGrade({ practical: 100 });
  assert.equal(onlyTeam.grade, null);
  assert.equal(onlyTeam.confidence, "none");
  assert.match(onlyTeam.note, /Недостаточно личных/);
  const one = recommendGrade({ practical: 100, final: 90 });
  assert.equal(one.confidence, "low");
  assert.equal(recommendGrade({}).grade, null);
});

test("победа команды не даёт одинаковую оценку всем её участникам", () => {
  const r = buildLessonReport(inputs());
  const u1 = r.people.find(p => p.uid === "u1");
  const u2 = r.people.find(p => p.uid === "u2");
  assert.equal(u1.battle.teamId, u2.battle.teamId, "одна команда (победившая)");
  assert.equal(u1.practical.teamPercent, u2.practical.teamPercent, "одинаковый командный результат");
  assert.notEqual(u1.recommended.percent, u2.recommended.percent, "но личные результаты разные");
});

test("резерв без замены и не участвовавшие в Battle: компонент не учитывается", () => {
  const r = buildLessonReport(inputs());
  const reserve = r.people.find(p => p.uid === "u5");
  assert.equal(reserve.battle.available, false);
  assert.equal(reserve.practical.available, false, "команды не было — практика не засчитывается");
  assert.equal(reserve.recommended.components.find(c => c.key === "battle").used, false);
});

test("личный вклад в практику не оценивается, это сказано явно; факт заполнения — отдельно", () => {
  const r = buildLessonReport(inputs());
  const u1 = r.people.find(p => p.uid === "u1");
  assert.equal(u1.practical.contribution, null);
  assert.match(u1.practical.contributionNote, /не оценивается/);
  assert.equal(u1.practical.filledTable, true, "u1 заполнил таблицу команды А");
  assert.equal(r.people.find(p => p.uid === "u2").practical.filledTable, false);
  assert.ok(r.notes.some(n => /не оценивается/.test(n)));
});

test("пропущенные/отключённые этапы: в отчёте честные заметки, ноль не ставится", () => {
  const small = normalizePlan({ topic: "Т", entryTestId: "e", finalTestId: "f", stages: { material: false, entry_test: true, battle: false, practical: false, final_test: true } });
  let run = newRun(small, { id: "S" });
  run = advance(run, small, { entryCompleted: true }, 1);
  const r = buildLessonReport({
    plan: small, run, entry: { studentsDetail: [det("u1", "Анна", 7)] }, final: null, battle: null, practical: null
  });
  assert.equal(r.summary.battle.available, false);
  assert.equal(r.summary.practical.available, false);
  assert.ok(r.notes.some(n => /Итоговый тест не проведён/.test(n)));
  const p = r.people[0];
  assert.equal(p.stages.battle, "off");
  assert.equal(p.stages.final_test, "not_held");
  assert.equal(p.recommended.percent, 70, "только входной тест, без нулей за остальное");
  assert.equal(p.recommended.confidence, "low");
  assert.equal(p.readiness.basis, "только по входному тесту (итогового нет)");
});

test("окончательное решение — за преподавателем; рекомендация и решение раздельны", () => {
  const base = buildLessonReport(inputs());
  assert.ok(base.people.every(p => p.decision === null), "без решения итоговой оценки нет");
  const r = buildLessonReport({ ...inputs(), decisions: { u1: { grade: 5, reason: "Активность на практике" }, u2: { grade: 9 }, u3: { grade: "4" } } });
  const u1 = r.people.find(p => p.uid === "u1");
  assert.deepEqual(u1.decision, { grade: 5, reason: "Активность на практике" });
  assert.equal(u1.recommended.grade, 4, "рекомендация сохранена отдельно");
  assert.equal(r.people.find(p => p.uid === "u2").decision, null, "оценка вне 2–5 отвергнута");
  assert.equal(r.people.find(p => p.uid === "u3").decision, null, "строка вместо числа отвергнута");
});

test("готовность по теме: уровни и оговорка про учебную оценку", () => {
  const ok = (percent) => ({ available: true, percent });
  assert.equal(readinessOf(ok(80), ok(80)).label, "Тема усвоена");
  assert.equal(readinessOf(ok(10), ok(60)).label, "Требует закрепления");
  assert.equal(readinessOf(ok(90), ok(30)).label, "Нужно повторение", "берётся итоговый тест");
  assert.equal(readinessOf({ available: false }, { available: false }).available, false);
  assert.match(readinessOf(ok(80), ok(80)).note, /не объективный уровень профессиональной компетентности/);
  assert.equal(READINESS_NOTE, readinessOf(ok(1), ok(1)).note);
});

test("вспомогательное: перевод процента в оценку, статусы теста, динамика", () => {
  assert.deepEqual([90, 75, 55, 10].map(p => gradeFromPercent(p)), [5, 4, 3, 2]);
  assert.equal(gradeFromPercent(NaN), null);
  assert.equal(testResult(null).available, false);
  assert.equal(testResult({ status: "zero", total: 10, correctCount: 0, answered: 0 }).percent, 0);
  assert.equal(testResult({ status: "absent" }).available, false);
  assert.equal(dynamicsOf({ available: true, percent: 50 }, { available: true, percent: 35 }).label, "Снижение");
  assert.equal(dynamicsOf({ available: false }, { available: true, percent: 35 }).available, false);
});

test("в отчёте нет ключей ответов: ожидаемое только то, что передали явно", () => {
  const i = inputs();
  const r = buildLessonReport(i);
  const json = JSON.stringify(r);
  assert.ok(!json.includes('"accept"'), "поля accept в отчёте нет");
  assert.equal(r.practical.teams.a.cells.r0c1.expected, "да", "ожидаемый ответ — только явный (для истории преподавателя)");
  const noExpected = buildLessonReport({ ...i, practical: { ...i.practical, expected: undefined } });
  assert.ok(!JSON.stringify(noExpected).includes("expected"));
});

test("практика для отчёта: берётся зафиксированный результат; без подтверждения её нет", async () => {
  const { practicalForReport, cleanDecisions } = await import("../core/lesson-report.js");
  const a = splitTask(task("А")), b = splitTask(task("Б"));
  const ea = evaluateSubmission({ pub: a.publicTask, keys: a.keys, cells: { r0c1: "да", r1c1: "нет" } });
  const eb = evaluateSubmission({ pub: b.publicTask, keys: b.keys, cells: { r0c1: "да", r1c1: "x" } });
  const confirmed = { evaluations: { a: ea, b: eb }, comparison: compareTeams(ea, eb), confirmedAt: { toMillis: () => 777 } };
  const snapshot = {
    tasks: { a: a.publicTask, b: b.publicTask },
    submissions: { a: { by: "u1", submittedAt: { toMillis: () => 5 } }, b: { by: "u3", submittedAt: 6 } },
    keys: { a: a.keys, b: b.keys }
  };
  const p = practicalForReport({ snapshot, confirmed });
  assert.equal(p.confirmedAt, 777);
  assert.deepEqual(p.submissions.a, { by: "u1", submittedAt: 5 });
  assert.equal(p.expected.a.r0c1, "да");
  // Правка ключей после подтверждения не меняет зафиксированный итог.
  snapshot.keys.a.r0c1.accept = ["другое"];
  assert.equal(practicalForReport({ snapshot, confirmed }).evaluations.a.score, 2);
  assert.equal(practicalForReport({ snapshot, confirmed: null }), null);
  assert.equal(practicalForReport({ snapshot, confirmed: { evaluations: {}, comparison: { ready: false } } }), null);
  assert.deepEqual(cleanDecisions({ u1: { grade: 5, reason: "x" }, u2: { grade: 1 }, u3: null, u4: { grade: "3" } }), { u1: { grade: 5, reason: "x" } });
});
