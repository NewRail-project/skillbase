// tests/lesson-bar.test.js — панель занятия и её подключение к комнате.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { installFakeDom, findAll, findOne, text } from "./helpers/fake-dom.js";

register("./helpers/stub-loader.mjs", import.meta.url);
installFakeDom();
globalThis.__SB = { profile: { uid: "t1", role: "teacher", orgId: "o1" }, calls: [], staff: true };
globalThis.__FS_WRITES = [];
const realWarn = console.warn; console.warn = (...a) => { if (!/подписка|Стили/.test(String(a[0]))) realWarn(...a); };
const realErr = console.error; console.error = (...a) => { if (!/Занятие: подписка/.test(String(a[0]))) realErr(...a); };

const { buildLessonBar } = await import("../ui/components/lesson-bar.js");
const { normalizePlan, newRun, advance } = await import("../core/lesson-plan.js");
const room = await import("../ui/pages/lesson-room.js");

const plan = normalizePlan({ topic: "Датчики", materialId: "m1", entryTestId: "e", finalTestId: "f" });
const fresh = () => ({ ...newRun(plan, { id: "ABC123", nowMs: 1 }), planId: "P1" });
const at = (stage) => ({ ...fresh(), stage });
const btn = (root, action) => findOne(root, e => e.tag === "button" && e.getAttribute("data-action") === action);
const link = (root, action) => findOne(root, e => e.tag === "a" && e.getAttribute("data-action") === action);

test("ведущий: этапы по порядку со статусами, текущий помечен", () => {
  let run = advance(fresh(), plan, {}, 5);
  const bar = buildLessonBar({ run, isHost: true, ctx: {}, entryCode: "ABC123" });
  const items = findAll(bar, e => e.className === "lb-stage");
  assert.deepEqual(items.map(i => i.getAttribute("data-status")), ["done", "current", "next", "upcoming", "upcoming", "upcoming"]);
  assert.equal(items[1].getAttribute("aria-current"), "step");
  assert.match(text(bar), /Выполнено этапов: 1 из 5/);
  assert.match(text(bar), /Входной тест/);
});

test("ведущий: переход закрыт, пока этап не выполнен, и объясняет причину", () => {
  const bar = buildLessonBar({ run: at("entry_test"), isHost: true, ctx: {}, entryCode: "ABC123" });
  assert.equal(btn(bar, "advance").disabled, true);
  assert.match(text(findOne(bar, e => e.getAttribute && e.getAttribute("data-role") === "reason")), /Входной тест ещё не завершён/);
  const ok = buildLessonBar({ run: at("entry_test"), isHost: true, ctx: { entryCompleted: true }, entryCode: "ABC123" });
  assert.equal(btn(ok, "advance").disabled, false);
});

test("ведущий: кнопки вызывают обработчики с текущим этапом (для защиты от устаревшего экрана)", () => {
  const got = [];
  const bar = buildLessonBar({ run: at("battle"), isHost: true, ctx: { battleFinished: true }, entryCode: "X", handlers: { advance: s => got.push(["advance", s]), skip: s => got.push(["skip", s]) } });
  btn(bar, "advance").click(); btn(bar, "skip").click();
  assert.deepEqual(got, [["advance", "battle"], ["skip", "battle"]]);
});

test("ведущий: пока выполняется действие, кнопки заблокированы (повторное нажатие)", () => {
  const bar = buildLessonBar({ run: at("battle"), isHost: true, ctx: { battleFinished: true }, busy: true, entryCode: "X" });
  assert.equal(btn(bar, "advance").disabled, true);
  assert.equal(btn(bar, "skip").disabled, true);
});

test("итоговый тест: создать комнату, затем ссылка на неё; отчёт — на последнем этапе", () => {
  const mk = buildLessonBar({ run: at("final_test"), isHost: true, ctx: {}, entryCode: "X" });
  assert.ok(btn(mk, "final-room"));
  const withRoom = buildLessonBar({ run: { ...at("final_test"), finalRoomCode: "FIN999" }, isHost: true, ctx: {}, entryCode: "X" });
  assert.equal(btn(withRoom, "final-room"), null, "вторую комнату создать нельзя");
  assert.equal(link(withRoom, "open-final").href, "#room/FIN999");
  const done = buildLessonBar({ run: at("report"), isHost: true, ctx: {}, entryCode: "ABC123" });
  assert.equal(link(done, "open-report").href, "#lesson-report/ABC123");
  assert.equal(btn(done, "advance"), null, "после отчёта переходить некуда");
});

test("материал: ведущий видит число прочитавших; участник — ссылку и свой статус", () => {
  const host = buildLessonBar({ run: at("material"), isHost: true, ctx: {}, readers: { read: 3, total: 10 }, entryCode: "X" });
  assert.match(text(host), /Прочитали материал: 3 из 10/);
  const href = "#material/m1/free/ABC123";
  const p = buildLessonBar({ run: at("material"), isHost: false, materialHref: href, materialRead: false });
  assert.equal(link(p, "material").href, href);
  assert.match(text(p), /Материал ещё не прочитан/);
  const read = buildLessonBar({ run: at("entry_test"), isHost: false, materialHref: href, materialRead: true });
  assert.match(text(read), /Материал прочитан/, "вернуться к материалу можно и перед тестом");
  assert.equal(btn(p, "advance"), null, "участник не управляет занятием");
});

test("участник: подсказка этапа; ссылка на итоговый тест только когда комната создана", () => {
  const before = buildLessonBar({ run: at("final_test"), isHost: false });
  assert.match(text(before), /заключительный этап/);
  assert.equal(link(before, "go-final"), null);
  const after = buildLessonBar({ run: { ...at("final_test"), finalRoomCode: "FIN999" }, isHost: false });
  assert.equal(link(after, "go-final").href, "#join/FIN999");
});

test("пропущенный этап виден с причиной; нет run — панели нет", () => {
  const run = { ...at("final_test"), skipped: { battle: 1, practical: 1 }, skipReasons: { battle: "нет времени", practical: "Нет команд: Battle не проводилась." } };
  const bar = buildLessonBar({ run, isHost: true, ctx: {}, entryCode: "X" });
  assert.match(text(bar), /Battle двух команд пропущен: нет времени/);
  assert.equal(buildLessonBar({}).hidden, true);
});

// ---------- подключение к комнате ----------

const ctxFor = (over = {}) => {
  const r = { code: "ABC123", lesson: { ...at("practical") }, ...over.room };
  return { code: "ABC123", room: r, current: "host", screen: false, getRoom: () => r, getMe: () => ({ team: "a", isCaptain: true }), ...over };
};

test("комната: на этапе практики вид заменяется практикой (ведущий / участник / проектор)", () => {
  room.setLessonPlayersGetter(() => []);
  const host = room.lessonOverride(ctxFor());
  assert.equal(host.getAttribute("data-lesson-stage"), "practical");
  assert.ok(findOne(host, e => e.getAttribute && e.getAttribute("aria-label") === "Практика: управление"));
  assert.ok(findOne(host, e => e.className === "lesson-bar-holder"), "панель занятия над практикой");
  room.disposeLesson();
  const player = room.lessonOverride(ctxFor({ current: "player" }));
  assert.ok(findOne(player, e => e.className && String(e.className).includes("practical-player")));
  room.disposeLesson();
  const screen = room.lessonOverride(ctxFor({ current: "observer", screen: true }));
  assert.ok(findOne(screen, e => e.className && String(e.className).includes("practical-screen")));
  assert.equal(findOne(screen, e => e.className === "lesson-bar-holder"), null, "на проекторе нет административной панели");
  room.disposeLesson();
});

test("комната: не занятие / итоговая комната / другой этап — практика не подставляется", () => {
  assert.equal(room.lessonOverride({ ...ctxFor(), room: { lesson: null } }), null);
  assert.equal(room.lessonOverride({ ...ctxFor(), room: { lesson: { ...at("practical"), kind: "final" } } }), null);
  assert.equal(room.lessonOverride({ ...ctxFor(), room: { lesson: at("battle") } }), null);
  room.disposeLesson();
});

test("комната: оболочка добавляет панель сверху, на проекторе вид остаётся как есть", () => {
  const base = findOne(buildLessonBar({ run: at("battle"), isHost: false }), () => true) && (() => { const d = document.createElement("div"); d.className = "base-view"; return d; })();
  const r = { lesson: at("battle") };
  const wrapped = room.lessonShell(base, { code: "ABC123", room: r, current: "host", screen: false, getRoom: () => r });
  assert.equal(wrapped.getAttribute("data-lesson-stage"), "battle");
  assert.ok(findOne(wrapped, e => e.className === "lesson-bar-holder"));
  assert.ok(findAll(wrapped, e => e.className === "base-view").length === 1);
  const onScreen = room.lessonShell(base, { code: "ABC123", room: r, current: "observer", screen: true, getRoom: () => r });
  assert.strictEqual(onScreen, base);
  assert.strictEqual(room.lessonShell(base, { code: "ABC123", room: {}, current: "host", getRoom: () => ({}) }), base, "не занятие — без оболочки");
  room.disposeLesson();
});

test("комната: панель и практика создаются один раз, а не при каждой перерисовке", () => {
  const c = ctxFor();
  const first = room.lessonOverride(c);
  const second = room.lessonOverride(c);
  const holder = (root) => findOne(root, e => e.className === "lesson-bar-holder");
  assert.strictEqual(holder(first), holder(second), "панель — один и тот же элемент");
  const prac = (root) => findOne(root, e => e.className && String(e.className).includes("practical-host"));
  assert.strictEqual(prac(first), prac(second));
  room.disposeLesson();
});

test("страницы занятия ничего не пишут в Firestore при показе", () => {
  assert.deepEqual(globalThis.__FS_WRITES, []);
});
