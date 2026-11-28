// tests/lesson-plan.test.js — сценарий занятия: план, этапы, защита от повторов.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyPlan, normalizePlan, validatePlan, enabledStages, newRun, canAdvance, advance, skipStage,
  stageStatuses, completion, STAGES
} from "../core/lesson-plan.js";

const L = (text) => ({ t: "label", text });
const A = (accept) => ({ t: "answer", mode: "text", accept });
const task = (title) => ({ title, columns: ["П", "З"], rows: [[L("x"), A(["да"])]] });
const goodPlan = (over = {}) => normalizePlan({
  topic: "Диагностика датчиков", materialId: "m1", entryTestId: "t1", finalTestId: "t2",
  tasks: { a: task("Задание А"), b: task("Задание Б") }, ...over
});

test("полный план валиден; без темы/материала/тестов — понятные ошибки", () => {
  assert.deepEqual(validatePlan(goodPlan()), []);
  const bad = validatePlan(emptyPlan());
  assert.ok(bad.some(e => /тему/.test(e)));
  assert.ok(bad.some(e => /материал/.test(e)));
  assert.ok(bad.some(e => /входной тест/.test(e)));
  assert.ok(bad.some(e => /итоговый тест/.test(e)));
});

test("зависимости этапов: Battle из входного теста, практика из Battle", () => {
  const noEntry = goodPlan({ stages: { entry_test: false, material: true, battle: true, practical: true, final_test: true } });
  assert.ok(validatePlan(noEntry).some(e => /Battle запускается из Live/.test(e)));
  const noBattle = goodPlan({ stages: { entry_test: true, material: true, battle: false, practical: true, final_test: true } });
  assert.ok(validatePlan(noBattle).some(e => /Практика проводится по командам/.test(e)));
  const okOff = goodPlan({ stages: { entry_test: true, material: false, battle: false, practical: false, final_test: true } });
  assert.deepEqual(validatePlan(okOff), []);
});

test("задания практики проверяются по командам (А и Б), если этап включён", () => {
  const p = goodPlan({ tasks: { a: task("A"), b: { title: "", columns: ["x"], rows: [[A([])]] } } });
  const errors = validatePlan(p);
  assert.ok(errors.some(e => /команды Б/.test(e)));
  assert.ok(!errors.some(e => /команды А/.test(e)));
});

test("пороги и веса: нормализация и проверка", () => {
  assert.ok(validatePlan(goodPlan({ grading: { weights: { entry: 0, battle: 0, practical: 0, final: 0 } } })).some(e => /вес/.test(e)));
  assert.ok(validatePlan(goodPlan({ grading: { thresholds: { five: 60, four: 70, three: 50 } } })).some(e => /Пороги/.test(e)));
  assert.equal(normalizePlan({ grading: { weights: { final: -5 } } }).grading.weights.final, 40, "отрицательный вес → по умолчанию");
});

test("этапы идут по порядку; отключённые пропадают, отчёт всегда последний", () => {
  assert.deepEqual(enabledStages(goodPlan()), ["material", "entry_test", "battle", "practical", "final_test", "report"]);
  const p = goodPlan({ stages: { material: false, entry_test: true, battle: false, practical: false, final_test: true } });
  assert.deepEqual(enabledStages(p), ["entry_test", "final_test", "report"]);
  assert.equal(newRun(p, { id: "R1" }).stage, "entry_test");
});

test("переходы закрыты условиями: нельзя перейти, пока этап не выполнен", () => {
  const plan = goodPlan();
  let run = newRun(plan, { id: "R1", nowMs: 1 });
  assert.equal(canAdvance(run, plan, {}).ok, true, "материал — решение преподавателя");
  run = advance(run, plan, {}, 10);
  assert.equal(run.stage, "entry_test");
  assert.throws(() => advance(run, plan, {}, 11), /не завершён/);
  run = advance(run, plan, { entryCompleted: true }, 20);
  assert.equal(run.stage, "battle");
  assert.throws(() => advance(run, plan, { entryCompleted: true }, 21), /Battle ещё не завершена/);
  run = advance(run, plan, { battleFinished: true }, 30);
  assert.equal(run.stage, "practical");
  assert.throws(() => advance(run, plan, { battleFinished: true }, 31), /не подтверждён/);
  run = advance(run, plan, { practicalConfirmed: true }, 40);
  assert.equal(run.stage, "final_test");
  run = advance(run, plan, { finalCompleted: true }, 50);
  assert.equal(run.stage, "report");
  assert.deepEqual(Object.keys(run.done), ["material", "entry_test", "battle", "practical", "final_test"]);
});

test("повторный запуск завершённого этапа и двойной клик невозможны", () => {
  const plan = goodPlan();
  let run = newRun(plan, { id: "R" });
  const once = advance(run, plan, {}, 5);
  // Тот же «устаревший» run, переданный второй раз, не должен снова пройти этап.
  const twice = canAdvance({ ...run, done: { material: 5 } }, plan, {});
  assert.equal(twice.ok, false);
  assert.match(twice.reason, /уже завершён/);
  assert.equal(once.stage, "entry_test");
  const atReport = { ...run, stage: "report" };
  assert.throws(() => advance(atReport, plan, {}), /уже завершено/);
  assert.throws(() => skipStage(atReport, plan), /нельзя/);
});

test("пропуск этапа: фиксируется, не требует условий, виден в статусах", () => {
  const plan = goodPlan();
  let run = advance(newRun(plan, { id: "R" }), plan, {}, 1); // entry_test
  run = advance(run, plan, { entryCompleted: true }, 2);       // battle
  run = skipStage(run, plan, { nowMs: 3, reason: "нет времени" });
  assert.ok(run.skipped.battle);
  assert.equal(run.skipReasons.battle, "нет времени");
  assert.ok(run.skipped.practical, "без Battle практика недоступна и пропускается");
  assert.match(run.skipReasons.practical, /Нет команд/);
  assert.equal(run.stage, "final_test");
  const st = Object.fromEntries(stageStatuses(run, plan).map(s => [s.stage, s.status]));
  assert.deepEqual(st, {
    material: "done", entry_test: "done", battle: "skipped", practical: "skipped",
    reinforcement: "off", final_test: "current", report: "next"
  });
});

test("процент выполнения: пропущенные в знаменателе, отключённые — нет", () => {
  const plan = goodPlan();
  let run = advance(newRun(plan, { id: "R" }), plan, {}, 1);
  run = advance(run, plan, { entryCompleted: true }, 2);
  run = skipStage(run, plan, { nowMs: 3 });
  const c = completion(run, plan);
  assert.deepEqual([c.done, c.skipped, c.planned, c.percent], [2, 2, 5, 40]);
  const small = goodPlan({ stages: { material: false, entry_test: true, battle: false, practical: false, final_test: true } });
  let r2 = newRun(small, { id: "S" });
  r2 = advance(r2, small, { entryCompleted: true }, 1);
  assert.equal(completion(r2, small).percent, 50);
  assert.equal(STAGES.length, 7);
});

// совместимость: старый сценарий без закрепления работает как раньше
test("совместимость: старый сценарий без закрепления работает как раньше", () => {
  const old = normalizePlan({ topic: "Т", stages: { material: true, entry_test: true, battle: true, practical: true, final_test: true } });
  assert.equal(old.stages.reinforcement, false);
  assert.deepEqual(enabledStages(old), ["material", "entry_test", "battle", "practical", "final_test", "report"]);
  // вообще без блока stages
  assert.equal(normalizePlan({ topic: "Т", stages: {} }).stages.reinforcement, false);
});

// этап «Закрепление материала» встаёт ровно после практики
test("этап «Закрепление материала» встаёт ровно после практики", () => {
  const on = goodPlan({ stages: { material:true, entry_test:true, battle:true, practical:true, reinforcement:true, final_test:true } });
  assert.deepEqual(enabledStages(on), ["material","entry_test","battle","practical","reinforcement","final_test","report"]);
});

// вопросы закрепления: нормализация и проверка
test("вопросы закрепления: нормализация и проверка", () => {
  const q = { type:"single", text:"Сигнал?", options:[{text:"Зелёный",correct:true},{text:"Красный"}], points:1, lineNumber: 4 };
  const p = normalizePlan({ topic:"Т", stages:{ practical:true, reinforcement:true }, reinforcement:{ questions:[q] } });
  assert.equal(p.reinforcement.questions.length, 1);
  assert.equal(p.reinforcement.questions[0].lineNumber, undefined);
  assert.deepEqual(validatePlan(p).filter(e => /закрепи|вопрос/i.test(e)), []);

  const empty = normalizePlan({ topic:"Т", stages:{ practical:true, reinforcement:true }, reinforcement:{ questions:[] } });
  assert.ok(validatePlan(empty).some(e => /закрепи|вопросы/i.test(e)), "без вопросов этап не должен сохраняться");

  const broken = normalizePlan({ topic:"Т", stages:{ practical:true, reinforcement:true },
    reinforcement:{ questions:[{ type:"single", text:"?", options:[{text:"Только один", correct:true}], points:1 }] } });
  assert.ok(validatePlan(broken).some(e => /Вопрос/i.test(e)), "невалидный вопрос должен дать ошибку");
});

// переходы: после таблицы практики сценарий идёт в закрепление и не зависает
test("переходы: после таблицы практики сценарий идёт в закрепление и не зависает", () => {
  const plan = goodPlan({ stages:{ material:false, entry_test:true, battle:false, practical:true, reinforcement:true, final_test:true } });
  let run = newRun(plan, { id: "E" });
  run = advance(run, plan, { entryCompleted: true, practicalConfirmed: true }, 1);
  assert.equal(run.stage, "reinforcement");
  // комната не создана — завершать нельзя
  assert.equal(canAdvance(run, plan, {}).ok, false);
  // комната создана, тест не пройден — завершать нельзя
  assert.equal(canAdvance(run, plan, { reinforcementRoomCode: "ABC123" }).ok, false);
  // тест пройден — можно
  assert.equal(canAdvance(run, plan, { reinforcementRoomCode: "ABC123", reinforcementCompleted: true }).ok, true);
  run = advance(run, plan, { reinforcementRoomCode: "ABC123", reinforcementCompleted: true }, 1);
  assert.equal(run.stage, "final_test");
  // и финальный тест отключён — сценарий уходит в отчёт, а не зависает
  const noFinal = goodPlan({ stages:{ material:false, entry_test:true, battle:false, practical:true, reinforcement:true, final_test:false } });
  let r2 = newRun(noFinal, { id: "E2" });
  r2 = advance(r2, noFinal, { entryCompleted: true, practicalConfirmed: true }, 1);
  assert.equal(r2.stage, "reinforcement");
  r2 = advance(r2, noFinal, { reinforcementCompleted: true, reinforcementRoomCode: "Z" }, 1);
  assert.equal(r2.stage, "report");
});

// практика пропущена — закрепление на своём месте (спец-ветка moveForward)
test("практика пропущена — закрепление на своём месте (спец-ветка moveForward)", () => {
  // battle выключен → практика автоматически пропускается, дальше должно быть закрепление
  const plan = goodPlan({ stages:{ material:false, entry_test:true, battle:false, practical:true, reinforcement:true, final_test:true } });
  let run = newRun(plan, { id: "E" });
  run = advance(run, plan, { entryCompleted: true }, 1);
  assert.equal(run.stage, "reinforcement");
});

test("ход занятия хранит снимок оценки и названий: правка сценария отчёт не меняет", async () => {
  const { reportPlanOfRun } = await import("../core/lesson-plan.js");
  const plan = goodPlan({ subjectName: "Электрика", entryTestTitle: "Вход", finalTestTitle: "Итог", grading: { weights: { entry: 10, battle: 10, practical: 10, final: 70 }, thresholds: { five: 90, four: 75, three: 55 } } });
  const run = newRun(plan, { id: "R1" });
  plan.grading.weights.final = 1; plan.topic = "Правка после запуска"; // правим сценарий после запуска
  const rp = reportPlanOfRun(run);
  assert.equal(rp.topic, "Диагностика датчиков");
  assert.equal(rp.subjectName, "Электрика");
  assert.equal(rp.grading.weights.final, 70);
  assert.equal(rp.grading.thresholds.five, 90);
  assert.equal(rp.entryTestTitle, "Вход");
  assert.deepEqual(rp.stages, run.stages);
});

test("параметры Battle: по умолчанию как в Live, значения зажимаются в пределы", () => {
  const d = emptyPlan().battle;
  assert.deepEqual(d, { battleTestId: "", questionCount: 10, questionSeconds: 30 });
  const p = normalizePlan({ battle: { battleTestId: "T2", questionCount: 9999, questionSeconds: 1 } });
  assert.equal(p.battle.battleTestId, "T2");
  assert.ok(p.battle.questionCount <= 60 && p.battle.questionCount >= 1);
  assert.ok(p.battle.questionSeconds >= 5);
  assert.equal(normalizePlan({ battle: { battleTestId: "a/b" } }).battle.battleTestId, "", "небезопасный id отброшен");
  assert.equal(normalizePlan(null).battle.questionCount, 10);
});

test("краевые: мусор в поле закрепления не роняет нормализацию", () => {
  const p1 = normalizePlan({ topic: "Т", stages: { reinforcement: true }, reinforcement: null });
  assert.deepEqual(p1.reinforcement.questions, []);

  const p2 = normalizePlan({ topic: "Т", stages: { reinforcement: true }, reinforcement: { questions: "не массив" } });
  assert.deepEqual(p2.reinforcement.questions, []);

  const p3 = normalizePlan({ topic: "Т", stages: { reinforcement: true }, reinforcement: { questions: [null, 5, "строка"] } });
  assert.deepEqual(p3.reinforcement.questions, []);

  const p4 = normalizePlan({ topic: "Т", stages: { reinforcement: true }, reinforcement: { questions: [ { type: "wat", text: "" }, { type: "single", text: "ok", options: [{ text: "a", correct: true }, { text: "b" }] } ] } });
  // нормализация отбрасывает только не-объекты (null/число/строку); объект с
  // неизвестным типом сохраняется, тип приводится к "single"
  assert.equal(p4.reinforcement.questions.length, 2);
  assert.equal(p4.reinforcement.questions[0].type, "single");
  assert.equal(p4.reinforcement.questions[0].text, "");
  assert.equal(p4.reinforcement.questions[1].type, "single");
  assert.equal(p4.reinforcement.questions[1].text, "ok");
  // а пустой текст такого вопроса обязан поймать validatePlan — не молчим о нём
  assert.ok(validatePlan(p4).some(e => /Вопрос 1: отсутствует текст/.test(e)));
});

test("краевые: ограничение количества вопросов", () => {
  const questions = Array.from({ length: 201 }, (_, i) => ({ type: "short", text: `Q${i}`, answer: `a${i}` }));
  const p = normalizePlan({ topic: "Т", stages: { reinforcement: true }, reinforcement: { questions } });
  assert.equal(p.reinforcement.questions.length, 200);
});

test("краевые: понятные ошибки валидации вопросов", () => {
  const empty = normalizePlan({ topic: "Т", stages: { reinforcement: true }, reinforcement: { questions: [] } });
  assert.ok(validatePlan(empty).some(e => /Добавьте вопросы закрепления/.test(e)));

  const badType = normalizePlan({ topic: "Т", stages: { reinforcement: true }, reinforcement: { questions: [{ type: "singleXYZ", text: "Что?", options: [{ text: "a", correct: true }, { text: "b" }] }] } });
  assert.ok(validatePlan(badType).some(e => /Вопрос 1: неизвестный тип вопроса/.test(e)));

  const noCorrect = normalizePlan({ topic: "Т", stages: { reinforcement: true }, reinforcement: { questions: [{ type: "single", text: "Что?", options: [{ text: "a" }, { text: "b" }] }] } });
  assert.ok(validatePlan(noCorrect).some(e => /Вопрос 1: укажите ровно один правильный вариант/.test(e)));

  const twoCorrect = normalizePlan({ topic: "Т", stages: { reinforcement: true }, reinforcement: { questions: [{ type: "single", text: "Что?", options: [{ text: "a", correct: true }, { text: "b", correct: true }] }] } });
  assert.ok(validatePlan(twoCorrect).some(e => /Вопрос 1: укажите ровно один правильный вариант/.test(e)));

  const noAnswer = normalizePlan({ topic: "Т", stages: { reinforcement: true }, reinforcement: { questions: [{ type: "short", text: "Что?", answer: "" }] } });
  assert.ok(validatePlan(noAnswer).some(e => /Вопрос 1: тип short должен иметь ответ/.test(e)));

  const valid = goodPlan({ stages: { reinforcement: true }, reinforcement: { questions: [{ type: "single", text: "Что?", options: [{ text: "a", correct: true }, { text: "b" }], points: 1 }] } });
  const reinErrors = validatePlan(valid).filter(e => /закреплени|вопрос/i.test(e));
  assert.deepEqual(reinErrors, []);
});
