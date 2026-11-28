// tests/lesson-store.test.js — слой хранения занятия на Firestore в памяти.
// Проверяется то, что нельзя увидеть в чистой логике: какие документы пишутся,
// что в публичных данных нет ключей, идемпотентность и защита переходов.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./helpers/stub-loader.mjs", import.meta.url);
globalThis.__SB = { profile: { uid: "captain1", role: "teacher", orgId: "o1", fullName: "Иванов" }, calls: [], staff: true };

// ---- Firestore в памяти ----
const store = new Map();
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const snapOf = (path) => ({ id: path.split("/").pop(), exists: () => store.has(path), data: () => clone(store.get(path)) });
const writes = [];
globalThis.__FB = {
  doc: (_db, ...segs) => ({ path: segs.join("/") }),
  collection: (_db, ...segs) => ({ path: segs.join("/"), __col: true }),
  serverTimestamp: () => ({ __ts: true }),
  getDoc: async (ref) => snapOf(ref.path),
  setDoc: async (ref, data) => { writes.push(["set", ref.path]); store.set(ref.path, clone(data)); },
  updateDoc: async (ref, patch) => {
    if (!store.has(ref.path)) { const e = new Error("not-found"); e.code = "not-found"; throw e; }
    writes.push(["update", ref.path]); store.set(ref.path, { ...store.get(ref.path), ...clone(patch) });
  },
  deleteDoc: async (ref) => { writes.push(["delete", ref.path]); store.delete(ref.path); },
  writeBatch: () => {
    const ops = [];
    return {
      set: (ref, data) => ops.push(["set", ref.path, clone(data)]),
      update: (ref, patch) => ops.push(["update", ref.path, clone(patch)]),
      commit: async () => { for (const [k, path, data] of ops) { writes.push([k, path]); store.set(path, k === "set" ? data : { ...(store.get(path) || {}), ...data }); } }
    };
  },
  runTransaction: async (_db, fn) => {
    const pending = [];
    const tx = {
      get: async (ref) => snapOf(ref.path),
      update: (ref, patch) => pending.push([ref.path, patch]),
      set: (ref, data) => pending.push([ref.path, data, true])
    };
    const result = await fn(tx);
    for (const [path, data, replace] of pending) store.set(path, replace ? clone(data) : { ...store.get(path), ...clone(data) });
    return result;
  }
};

const practical = await import("../core/practical-store.js");
const lesson = await import("../core/lesson-store.js");
const { advance, newRun, normalizePlan } = await import("../core/lesson-plan.js");
const { cellId, decodeTask } = await import("../core/practical.js");

const L = (t) => ({ t: "label", text: t });
const A = (mode, accept) => ({ t: "answer", mode, accept });
const task = (t) => ({ title: t, description: "описание", columns: ["П", "З"], rows: [[L("Датчик"), A("text", ["СЕКРЕТ-1"])], [L("Значение"), A("number", ["4"])]] });
const plan = normalizePlan({ topic: "Т", materialId: "m", entryTestId: "e", finalTestId: "f", tasks: { a: task("А"), b: task("Б") } });
const R = "ABCD23"; // код без символов 0/1/I/O: иначе normalizeRoomCode их заменит

beforeEach(() => { store.clear(); writes.length = 0; globalThis.__FS_WRITES = []; });

test("setupPractical: публичные задания без ключей, ключи — отдельно в battleKeys", async () => {
  const { created } = await practical.setupPractical(R, plan);
  assert.equal(created, 2);
  for (const team of ["a", "b"]) {
    const pub = store.get(`rooms/${R}/practicalTasks/${team}`);
    assert.equal(pub.team, team);
    assert.equal(pub.status, "draft");
    assert.ok(!JSON.stringify(pub).includes("СЕКРЕТ-1"), "ключ не должен попасть в публичный документ");
    // В базе строки хранятся как { c: [...] } (Firestore не принимает массив в массиве).
    assert.ok(pub.rows.every((row) => !Array.isArray(row)), "строки в базе — не вложенные массивы");
    assert.ok(!("accept" in decodeTask(pub).rows[0][1]));
    const keys = store.get(`rooms/${R}/battleKeys/practical_${team}`);
    assert.deepEqual(keys.cells.r0c1.accept, ["СЕКРЕТ-1"]);
  }
  // Ни в одном документе подколлекций практики для участников ключа нет.
  const leaked = [...store.entries()].filter(([path, data]) => /practicalTasks|practicalSubmissions/.test(path) && JSON.stringify(data).includes("СЕКРЕТ-1"));
  assert.deepEqual(leaked, []);
});

test("setupPractical идемпотентна: повторный вызов не стирает ответы и статусы", async () => {
  await practical.setupPractical(R, plan);
  await practical.setTaskStatus(R, "a", "open");
  const again = await practical.setupPractical(R, plan);
  assert.equal(again.created, 0);
  assert.equal(store.get(`rooms/${R}/practicalTasks/a`).status, "open", "открытое задание не сброшено в draft");
});

test("капитан: черновик и отправка пишут только известные ячейки, отправка фиксирует статус", async () => {
  await practical.setupPractical(R, plan);
  const pub = store.get(`rooms/${R}/practicalTasks/a`);
  await practical.saveDraft(R, "a", pub, { r0c1: "ответ", r9c9: "чужое", accept: ["x"] });
  let sub = store.get(`rooms/${R}/practicalSubmissions/a`);
  assert.deepEqual(sub.cells, { r0c1: "ответ" });
  assert.equal(sub.status, "draft");
  assert.equal(sub.by, "captain1");
  await practical.submitTable(R, "a", pub, { r0c1: "ответ", r1c1: "4" });
  sub = store.get(`rooms/${R}/practicalSubmissions/a`);
  assert.equal(sub.status, "submitted");
  assert.deepEqual(sub.cells, { r0c1: "ответ", r1c1: "4" });
  assert.deepEqual(Object.keys(sub).sort(), ["by", "cells", "status", "submittedAt", "team", "updatedAt"]);
  await assert.rejects(() => practical.saveDraft(R, "x", pub, {}), /Неизвестная команда/);
});

test("подтверждение: публичный итог без ожидаемых ответов; без готового сравнения — отказ", async () => {
  await practical.setupPractical(R, plan);
  await assert.rejects(() => practical.confirmResult(R, { evaluations: {}, comparison: { ready: false, reason: "Есть ответы, которые ждут ручной проверки." } }), /ждут ручной проверки/);
  const ev = (score) => ({ score, max: 2, percent: score * 50, cells: { r0c1: { ok: score > 0, source: "auto", points: 1, answer: "x" }, r1c1: { ok: false, source: "auto", points: 1, answer: "y" } } });
  await practical.confirmResult(R, { evaluations: { a: ev(2), b: ev(1) }, comparison: { ready: true, tie: false, winner: "a", a: {}, b: {} }, overrides: { a: {}, b: {} } });
  const a = store.get(`rooms/${R}/practicalTasks/a`);
  assert.equal(a.status, "confirmed");
  assert.equal(a.result.winner, "a");
  assert.deepEqual(Object.keys(a.result).sort(), ["cells", "max", "percent", "score", "winner"]);
  assert.ok(!JSON.stringify(a).includes("СЕКРЕТ-1"));
  assert.ok(store.has(`rooms/${R}/battleRounds/practical_result`), "полный результат — в закрытом документе ведущего");
});

test("решения преподавателя сохраняются сразу и отбрасывают мусор", async () => {
  await practical.saveReview(R, { a: { r0c1: true, bad: true, r1c1: "yes" }, b: { r2c3: false } });
  const saved = await practical.loadReview(R);
  assert.deepEqual(saved, { a: { r0c1: true }, b: { r2c3: false } });
});

test("правила: поля, которые пишет хранилище, разрешены правилами Firestore", async () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const allowed = (marker) => {
    const block = rules.slice(rules.indexOf(marker));
    const m = block.match(/hasOnly\(\s*\[([^\]]+)\]/);
    return new Set([...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]));
  };
  await practical.setupPractical(R, plan);
  const pub = store.get(`rooms/${R}/practicalTasks/a`);
  const taskAllowed = allowed("match /practicalTasks/{teamId}");
  for (const k of Object.keys(pub)) assert.ok(taskAllowed.has(k), `practicalTasks: поле «${k}» не разрешено правилами`);
  await practical.submitTable(R, "a", pub, { r0c1: "x" });
  const subAllowed = allowed("function practicalCaptainWrite");
  for (const k of Object.keys(store.get(`rooms/${R}/practicalSubmissions/a`))) assert.ok(subAllowed.has(k), `practicalSubmissions: «${k}»`);
  // История занятия.
  await lesson.saveLessonHistory({ code: R, report: { lesson: { topic: "Т" }, participants: 0 } });
  const histAllowed = allowed("match /lessonHistory/{docId}");
  for (const k of Object.keys(store.get(`lessonHistory/${R}`))) assert.ok(histAllowed.has(k), `lessonHistory: «${k}»`);
});

// ---------- ход занятия ----------

function seedRoom(stage = "entry_test", extra = {}) {
  const run = { ...newRun(plan, { id: R, nowMs: 1 }), planId: "P1", stage, ...extra };
  store.set(`rooms/${R}`, { code: R, hostId: "captain1", lesson: run });
  return run;
}

test("переход этапа: один раз; повторный клик/вторая вкладка получают «этап уже изменился»", async () => {
  seedRoom("entry_test");
  const first = await lesson.advanceLesson(R, "entry_test", { entryCompleted: true });
  assert.equal(first.stage, "battle");
  await assert.rejects(() => lesson.advanceLesson(R, "entry_test", { entryCompleted: true }), (e) => e.code === "stale");
  assert.equal(store.get(`rooms/${R}`).lesson.stage, "battle", "второй вызов ничего не продвинул");
  assert.equal(Object.keys(store.get(`rooms/${R}`).lesson.done).filter(s => s === "entry_test").length, 1);
});

test("переход закрыт условием этапа даже при прямом вызове", async () => {
  seedRoom("battle");
  await assert.rejects(() => lesson.advanceLesson(R, "battle", {}), /Battle ещё не завершена/);
  assert.equal(store.get(`rooms/${R}`).lesson.stage, "battle");
});

test("пропуск этапа записывается с причиной; не занятие — понятная ошибка", async () => {
  seedRoom("battle");
  const run = await lesson.skipLessonStage(R, "battle", "нет времени");
  assert.equal(run.skipReasons.battle, "нет времени");
  assert.ok(run.skipped.practical, "практика без Battle пропущена автоматически");
  store.set("rooms/ZZZZ99", { code: "ZZZZ99" });
  await assert.rejects(() => lesson.advanceLesson("ZZZZ99", "x", {}), /Это не комната занятия/);
});

test("итоговая комната создаётся один раз: повторный вызов возвращает прежний код", async () => {
  seedRoom("final_test");
  let created = 0;
  globalThis.__SB.createRoomImpl = async () => { created += 1; const code = ["KLMN22", "KLMN33"][created - 1]; store.set(`rooms/${code}`, { code }); return code; };
  const test1 = { id: "f", status: "published", questions: [{ id: "q" }] };
  const code1 = await lesson.startFinalRoom({ entryCode: R, test: test1, profile: globalThis.__SB.profile });
  const code2 = await lesson.startFinalRoom({ entryCode: R, test: test1, profile: globalThis.__SB.profile });
  assert.equal(code1, "KLMN22");
  assert.equal(code2, "KLMN22");
  assert.equal(created, 1, "вторая комната не создавалась");
  assert.equal(store.get(`rooms/${R}`).lesson.finalRoomCode, "KLMN22");
  delete globalThis.__SB.createRoomImpl;
});

// ---------- история ----------

test("история неизменяема: повторное сохранение не перезаписывает", async () => {
  const first = await lesson.saveLessonHistory({ code: R, report: { lesson: { topic: "Первое", hostName: "И", dateMs: 5 }, participants: 3 }, finalCode: "KLMN22" });
  assert.equal(first.saved, true);
  const second = await lesson.saveLessonHistory({ code: R, report: { lesson: { topic: "ПЕРЕЗАПИСЬ" }, participants: 99 } });
  assert.deepEqual(second, { saved: false, reason: "exists" });
  const doc = store.get(`lessonHistory/${R}`);
  assert.equal(doc.report.lesson.topic, "Первое");
  assert.equal(doc.hostId, "captain1");
  assert.equal(doc.orgId, "o1");
  assert.equal(doc.code, R);
  assert.equal((await lesson.loadLessonHistory(R)).report.participants, 3);
});

test("строка списка истории устойчива к неполным и старым записям", () => {
  assert.deepEqual(lesson.lessonHistoryRow({}), { code: "", topic: "Занятие", subjectName: "", dateMs: null, participants: 0, battle: null, practical: null, completion: null });
  const row = lesson.lessonHistoryRow({ code: R, topic: "Т", createdAtMs: 10, report: { participants: 4, completion: { percent: 80 }, summary: { battle: { available: true, winner: "a" }, practical: { available: true, tie: true } } } });
  assert.deepEqual([row.participants, row.battle.winner, row.practical.tie, row.completion], [4, "a", true, 80]);
  const sorted = lesson.sortLessonHistory([{ code: "B", dateMs: 1 }, { code: "A", dateMs: 9 }, { code: "C", dateMs: null }]);
  assert.deepEqual(sorted.map(r => r.code), ["A", "B", "C"]);
});

test("сохранение плана: невалидный план не пишется, текст ошибки понятный", async () => {
  await assert.rejects(() => lesson.saveLessonPlan(null, { topic: "" }), (e) => e.code === "validation" && /тему/.test(e.message));
  assert.ok(!writes.length, "ничего не записано");
  const id = await lesson.saveLessonPlan(null, plan);
  const doc = store.get(`testKeys/lesson__${id}`);
  assert.equal(doc.kind, "lessonPlan");
  assert.equal(doc.authorId, "captain1");
  assert.equal(doc.orgId, "o1");
  assert.equal((await lesson.loadLessonPlan(id)).tasks.a.rows[0][1].accept[0], "СЕКРЕТ-1", "ключи плана хранятся в закрытом документе");
  assert.match(lesson.lessonErrorText({ code: "permission-denied" }), /Нет прав/);
  assert.ok(!/permission-denied/.test(lesson.lessonErrorText({ code: "permission-denied" })));
});

test("запуск занятия: параметры Battle из сценария уходят в createRoom; без Battle — нет", async () => {
  const seen = [];
  globalThis.__SB.createRoomImpl = async (args) => { seen.push(args); return "KLMN22"; };
  const test1 = { id: "e", status: "published", questions: [{ id: "q" }] };
  const withBattle = normalizePlan({ ...plan, battle: { battleTestId: "BANK2", questionCount: 12, questionSeconds: 45 } });
  await lesson.startLesson({ planId: "P1", plan: withBattle, test: test1, profile: globalThis.__SB.profile });
  assert.equal(seen[0].battleEnabled, true);
  assert.deepEqual(seen[0].battleSettings, { battleTestId: "BANK2", questionCount: 12, questionSeconds: 45 });
  assert.equal(seen[0].lesson.planId, "P1");
  const noBattle = normalizePlan({ ...plan, stages: { material: true, entry_test: true, battle: false, practical: false, final_test: true } });
  await lesson.startLesson({ planId: "P2", plan: noBattle, test: test1, profile: globalThis.__SB.profile });
  assert.equal(seen[1].battleEnabled, false);
  assert.equal(seen[1].battleSettings, null);
  delete globalThis.__SB.createRoomImpl;
});
