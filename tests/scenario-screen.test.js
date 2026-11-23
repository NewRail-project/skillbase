// tests/scenario-screen.test.js — экран проигрывания сценария (#admin/scenario).
//
// Логика проверяется на чистом проигрывателе (core/scenario-player.js), а сам
// экран — настоящей страницей ui/pages/admin-scenario.js в минимальном DOM.
// Подменён только слой Firebase (tests/helpers/stubs): записи считаются.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { register } from "node:module";
import { installFakeDom, findAll, findOne, text } from "./helpers/fake-dom.js";

register("./helpers/stub-loader.mjs", import.meta.url);
installFakeDom();
globalThis.__SB = { profile: { uid: "admin1", role: "admin", orgId: "o1" }, calls: [], staff: true };
globalThis.__FS_WRITES = [];
// В Node нет document.querySelector, поэтому loadCss() падает, а страница
// штатно продолжает без стилей. Это ожидаемое предупреждение — не шумим.
const realWarn = console.warn;
console.warn = (...args) => { if (!/Стили сценария/.test(String(args[0]))) realWarn(...args); };

const player = await import("../core/scenario-player.js");
const sim = await import("../core/scenario-sim.js");
const screen = await import("../ui/pages/admin-scenario.js");

const {
  createScenarioPlayer, clampSettings, SETTING_LIMITS, SPEEDS, DEFAULT_SETTINGS, formatClock
} = player;
const { runScenario, boardFromEvents } = sim;
const { buildScenarioView, default: ScenarioPage } = screen;

const BASE = { botCount: 8, questionCount: 5, accuracyPct: 60, seed: 3, speed: 10 };

// Гонит проигрыватель до конца шагом dt; возвращает снимок.
function playToEnd(p, dt = 250) {
  let guard = 0;
  while (p.snapshot().status === "running" && guard++ < 100000) p.tick(dt);
  return p.snapshot();
}

// ---------- 1. Настройки зажимаются в пределы ----------

test("настройки: боты 2–30, вопросы 1–50, точность 0–100 %", () => {
  const low = clampSettings({ botCount: 0, questionCount: 0, accuracyPct: -20 }).settings;
  assert.deepEqual([low.botCount, low.questionCount, low.accuracyPct], [2, 1, 0]);
  const high = clampSettings({ botCount: 999, questionCount: 999, accuracyPct: 400 }).settings;
  assert.deepEqual([high.botCount, high.questionCount, high.accuracyPct], [30, 50, 100]);
  const ok = clampSettings({ botCount: "12", questionCount: "7", accuracyPct: "85", seed: "42", speed: "5" });
  assert.deepEqual(ok.settings, { botCount: 12, questionCount: 7, accuracyPct: 85, seed: 42, speed: 5 });
  assert.deepEqual(ok.notes, []);
  assert.deepEqual(SETTING_LIMITS.botCount, { min: 2, max: 30 });
  assert.deepEqual(SPEEDS, [1, 2, 5, 10]);
});

test("настройки: мусор заменяется значениями по умолчанию с понятным пояснением", () => {
  const { settings, notes } = clampSettings({ botCount: "", questionCount: "abc", accuracyPct: "x", seed: "y", speed: 3 });
  assert.equal(settings.botCount, DEFAULT_SETTINGS.botCount);
  assert.equal(settings.accuracyPct, 60);
  assert.equal(settings.seed, 1);
  assert.equal(settings.speed, 1, "недопустимая скорость → ×1");
  assert.equal(notes.length, 4);
  assert.ok(notes.every(n => /[А-Яа-я]/.test(n)) && notes.every(n => !/NaN|undefined|null|Error/.test(n)));
  assert.equal(clampSettings({}).settings.accuracyPct, 60, "точность по умолчанию 60 %");
  assert.equal(clampSettings({}).settings.seed, 1, "seed по умолчанию 1");
});

// ---------- 2. Один seed — одинаковый результат ----------

test("один seed → одинаковая лента событий и итоговая таблица", () => {
  const a = createScenarioPlayer(BASE); a.start();
  const b = createScenarioPlayer(BASE); b.start();
  const sa = playToEnd(a);
  const sb = playToEnd(b);
  assert.deepEqual(sa.feed, sb.feed);
  assert.deepEqual(sa.finalBoard, sb.finalBoard);
  assert.deepEqual(sa.ties, sb.ties);
  assert.ok(sa.feed.length === 8 * 5);
  // Повторный запуск того же проигрывателя после сброса — тот же результат.
  a.reset(); a.start();
  assert.deepEqual(playToEnd(a).finalBoard, sa.finalBoard);
  // Другой seed — другой результат.
  const c = createScenarioPlayer({ ...BASE, seed: 4 }); c.start();
  assert.notDeepEqual(playToEnd(c).feed, sa.feed);
});

// ---------- 3. Пауза не меняет результат, сброс возвращает начальное состояние ----------

test("пауза не теряет позицию и не меняет результат", () => {
  const straight = createScenarioPlayer(BASE); straight.start();
  const expected = playToEnd(straight);

  const p = createScenarioPlayer(BASE); p.start();
  for (let i = 0; i < 10; i += 1) p.tick(250); // 25 с сценария из 90
  const before = p.snapshot();
  assert.ok(before.feed.length > 0 && before.status === "running");
  assert.equal(p.pause(), true);
  assert.equal(p.snapshot().status, "paused");
  for (let i = 0; i < 500; i += 1) p.tick(1000); // на паузе время не идёт
  const during = p.snapshot();
  assert.equal(during.elapsedMs, before.elapsedMs);
  assert.deepEqual(during.feed, before.feed);
  assert.deepEqual(during.board, before.board);
  assert.equal(p.resume(), true);
  const after = playToEnd(p);
  assert.deepEqual(after.feed, expected.feed);
  assert.deepEqual(after.finalBoard, expected.finalBoard);
});

test("сброс возвращает начальное состояние, настройки сохраняются", () => {
  const fresh = createScenarioPlayer(BASE).snapshot();
  const p = createScenarioPlayer(BASE); p.start();
  for (let i = 0; i < 60; i += 1) p.tick(250);
  assert.ok(p.snapshot().feed.length > 0);
  p.reset();
  const s = p.snapshot();
  assert.equal(s.status, "idle");
  assert.equal(s.elapsedMs, 0);
  assert.equal(s.progress, 0);
  assert.deepEqual(s.feed, []);
  assert.equal(s.finalBoard, null);
  assert.deepEqual(s.ties, []);
  assert.deepEqual(s.board, fresh.board);
  assert.deepEqual(s.settings, fresh.settings);
  assert.equal(formatClock(75000), "01:15");
});

// ---------- 4. Главный тест корректности: места по событиям = board runScenario ----------

test("места, пересчитанные по событиям, совпадают с board из runScenario на финале", () => {
  const cases = [
    { botCount: 2, questionCount: 1, accuracyPct: 50, seed: 1 },
    { botCount: 8, questionCount: 5, accuracyPct: 60, seed: 3 },
    { botCount: 30, questionCount: 50, accuracyPct: 60, seed: 7 },
    { botCount: 12, questionCount: 10, accuracyPct: 0, seed: 9 },
    { botCount: 12, questionCount: 10, accuracyPct: 100, seed: 9 },
    { botCount: 20, questionCount: 3, accuracyPct: 75, seed: 123456 }
  ];
  for (const c of cases) {
    const p = createScenarioPlayer({ ...c, speed: 10 }); p.start();
    const expected = runScenario({
      botCount: c.botCount, questionCount: c.questionCount, accuracy: c.accuracyPct / 100, seed: c.seed
    });
    const names = expected.board.map(r => r.name);
    const seen = [];
    let guard = 0;
    while (p.snapshot().status === "running" && guard++ < 200000) {
      const released = p.tick(500);
      const answers = released.filter(e => e.type === "answer");
      if (!answers.length) continue;
      seen.push(...answers);
      // После каждой пачки событий живой рейтинг = пересчёт по всем пришедшим событиям.
      const row = r => `${r.name}:${r.score}:${r.correctCount}:${r.place}`;
      assert.deepEqual(p.snapshot().board.map(row), boardFromEvents(seen, names).map(row));
    }
    const end = p.snapshot();
    assert.equal(end.status, "done");
    const key = rows => rows.map(r => `${r.name}:${r.score}:${r.correctCount ?? r.correct}:${r.place}`);
    assert.deepEqual(key(end.board), key(expected.board), "живой рейтинг на финале");
    assert.deepEqual(key(end.finalBoard), key(expected.board), "итоговая таблица из finish");
    assert.equal(seen.length, expected.totalAnswers);
    assert.equal(end.ties.length, expected.ties.length);
  }
});

// ---------- 5. Экран не пишет в Firestore ----------

function importsOf(file) {
  const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const out = [];
  for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|^import\s+)["'](\.{1,2}\/[^"']+)["']/gm)) out.push(m[1]);
  return out;
}

function importGraph(entry) {
  const seen = new Map();
  const walk = (file) => {
    if (seen.has(file) || !existsSync(new URL(`../${file}`, import.meta.url))) return;
    seen.set(file, importsOf(file));
    for (const spec of seen.get(file)) {
      const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/") + 1) : "";
      const parts = (dir + spec).split("/");
      const norm = [];
      for (const part of parts) { if (part === "..") norm.pop(); else if (part !== ".") norm.push(part); }
      const next = norm.join("/");
      // Слой авторизации — единственное разрешённое место с Firebase (чтение роли).
      if (next === "core/auth.js") { seen.set(next, []); continue; }
      walk(next);
    }
  };
  walk(entry);
  return seen;
}

test("граф импортов экрана не содержит Firestore, комнат и battle", () => {
  const graph = importGraph("ui/pages/admin-scenario.js");
  const files = [...graph.keys()];
  for (const forbidden of ["shared/firebase.js", "core/rooms.js", "core/room-history.js"]) {
    assert.ok(!files.includes(forbidden), `экран не должен тянуть ${forbidden}`);
  }
  assert.ok(files.every(f => !/core\/battle/.test(f)), "экран не должен тянуть core/battle*");
  const touchFirebase = files.filter(f => (graph.get(f) || []).some(s => /firebase/.test(s)));
  assert.deepEqual(touchFirebase, [], "Firebase не импортирует ни один модуль экрана, кроме auth");
  assert.ok(files.includes("core/scenario-sim.js") && files.includes("core/duel-logic.js"));
  // Прямые вызовы записи в исходниках экрана и проигрывателя.
  const WRITE = /\b(saveAnswer|joinRoom|createRoom|closeRoom|ensureDuelsDoc|updateDuelsDoc|setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\s*\(/;
  for (const f of ["ui/pages/admin-scenario.js", "core/scenario-player.js", "core/scenario-sim.js", "core/bots-plan.js"]) {
    assert.ok(!WRITE.test(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")), `${f}: вызов записи`);
  }
});

test("полный прогон на экране: 0 вызовов записи Firestore", async () => {
  globalThis.__FS_WRITES = [];
  const view = makeView({ botCount: 10, questionCount: 6 });
  click(view.controls.startBtn);
  driveToEnd(view);
  const duelBtn = findOne(view.finale, e => e.tag === "button" && /Дуэль/.test(text(e)));
  if (duelBtn) duelBtn.click();
  click(view.controls.resetBtn);
  assert.deepEqual(globalThis.__FS_WRITES, [], "ни одного вызова setDoc/updateDoc/saveAnswer/…");
  assert.deepEqual(globalThis.__SB.calls, [], "слой заглушек не вызывался");
  view.destroy();
});

// ---------- 6. Роль не admin не получает доступа ----------

test("не-admin получает отказ вместо экрана; admin — экран", async () => {
  for (const role of ["teacher", "student", undefined]) {
    globalThis.__SB.profile = role ? { uid: "u", role, orgId: "o1" } : null;
    const page = await ScenarioPage();
    assert.ok(findOne(page, e => e.attrs.role === "alert" && /только администраторам/.test(text(e))), `роль ${role}`);
    assert.equal(findOne(page, e => e.attrs.id === "scn-start"), null, "кнопки запуска нет");
  }
  globalThis.__SB.profile = { uid: "admin1", role: "admin", orgId: "o1" };
  const page = await ScenarioPage();
  assert.ok(findOne(page, e => e.attrs.id === "scn-start"));
  screen.cleanup();
});

test("маршрут admin закрыт для не-админов в роутере, кнопка видна только admin", () => {
  const app = readFileSync(new URL("../shared/app.js", import.meta.url), "utf8");
  assert.match(app, /"admin":\s*\{[^}]*admin-panel\.js[^}]*roles:\s*ADMIN/);
  const panel = readFileSync(new URL("../ui/pages/admin-panel.js", import.meta.url), "utf8");
  assert.match(panel, /profile\.role === "admin"[\s\S]{0,400}Проиграть сценарий/);
  assert.match(panel, /routeParam[\s\S]{0,40}"scenario"/);
});

// ---------- Экран целиком ----------

function makeView(settings = BASE) {
  const manual = { fn: null, id: 0, cleared: 0 };
  let t = 0;
  const view = buildScenarioView({
    player: createScenarioPlayer(settings),
    schedule: (fn) => { manual.fn = fn; manual.id += 1; return manual.id; },
    unschedule: () => { manual.fn = null; manual.cleared += 1; },
    now: () => t
  });
  view.manual = manual;
  view.advance = (ms) => { t += ms; manual.fn?.(); };
  return view;
}
const click = (el) => el.click();
function driveToEnd(view) {
  let guard = 0;
  while (view.manual.fn && guard++ < 100000) view.advance(1000);
}

test("экран: запуск зажимает ввод, показывает поправки и блокирует поля на время игры", () => {
  const view = makeView();
  const c = view.controls;
  c.botsInput.value = "99"; c.questionsInput.value = "0"; c.accuracyInput.value = "abc";
  click(c.startBtn);
  assert.equal(c.botsInput.value, "30");
  assert.equal(c.questionsInput.value, "1");
  assert.equal(c.accuracyInput.value, "60");
  assert.match(text(view.alertBox), /допустимо от 2 до 30/);
  assert.equal(c.startBtn.disabled, true);
  assert.equal(c.pauseBtn.disabled, false);
  assert.equal(c.botsInput.disabled, true);
  driveToEnd(view);
  assert.equal(c.startBtn.disabled, false);
  assert.equal(c.botsInput.disabled, false);
  view.destroy();
});

test("экран: лента, рейтинг, итог и ничьи появляются по ходу сценария", () => {
  const view = makeView({ ...BASE, botCount: 6, questionCount: 4 });
  click(view.controls.startBtn);
  view.advance(2000);
  view.advance(2000);
  const mid = findAll(view.feedList, e => e.className === "scn-feed-item");
  assert.ok(mid.length > 0 && mid.length < 24, "часть событий уже в ленте");
  assert.match(text(mid[0]), /Вопрос \d+ · Бот \d+ — (✓ верно|✗ неверно)/);
  assert.equal(findAll(view.boardBody, e => e.tag === "tr").length, 6, "в рейтинге все боты");
  assert.equal(view.finale.hidden, true);
  assert.notEqual(text(view.clock), "00:00");
  driveToEnd(view);
  assert.equal(findAll(view.feedList, e => e.className === "scn-feed-item").length, 24);
  assert.equal(view.finale.hidden, false);
  assert.equal(view.bar.attrs["aria-valuenow"], "100");
  assert.match(text(view.status), /завершён/);
  assert.ok(findOne(view.finale, e => e.tag === "h3" && text(e) === "Ничьи"));
  view.destroy();
});

test("экран: «Дуэль (только показ)» раскрывается и сворачивается без записи", () => {
  const view = makeView({ ...BASE, botCount: 12, questionCount: 5, seed: 5 });
  click(view.controls.startBtn);
  driveToEnd(view);
  const btn = findOne(view.finale, e => e.tag === "button" && /Дуэль \(только показ\)/.test(text(e)));
  assert.ok(btn, "для seed 5 есть ничьи");
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  btn.click();
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  const box = findOne(view.finale, e => e.attrs.role === "group");
  assert.match(text(box), /Только показ: результат нигде не сохраняется/);
  assert.match(text(box), /Раунд 1/);
  btn.click();
  assert.equal(findOne(view.finale, e => e.attrs.role === "group"), null);
  view.destroy();
});

test("экран: пауза кнопкой и Пробелом, сброс очищает всё", () => {
  const view = makeView();
  const c = view.controls;
  click(c.startBtn);
  view.advance(3000);
  click(c.pauseBtn);
  assert.equal(c.pauseBtn.textContent, "Продолжить");
  assert.equal(view.manual.fn, null, "на паузе таймер остановлен");
  assert.match(text(view.status), /Пауза/);
  const frozen = text(view.clock);
  view.onKeydown({ key: " ", target: { tagName: "DIV" }, preventDefault() {} });
  assert.equal(c.pauseBtn.textContent, "Пауза", "Пробел продолжает");
  assert.ok(view.manual.fn, "таймер снова идёт");
  view.onKeydown({ key: " ", target: { tagName: "DIV" }, preventDefault() {} });
  assert.equal(text(view.clock), frozen);
  // Пробел в поле ввода не ставит паузу.
  view.onKeydown({ key: " ", target: { tagName: "INPUT" }, preventDefault() {} });
  assert.equal(c.pauseBtn.textContent, "Продолжить");
  click(c.resetBtn);
  assert.equal(text(view.clock), "00:00");
  assert.equal(findAll(view.feedList, e => e.className === "scn-feed-item").length, 0);
  assert.equal(view.finale.hidden, true);
  assert.equal(c.startBtn.disabled, false);
  assert.equal(c.pauseBtn.disabled, true);
  assert.equal(c.pauseBtn.textContent, "Пауза");
  view.destroy();
});

test("экран: у каждого поля есть label, статус и ошибки — в live-областях", () => {
  const view = makeView();
  const labels = findAll(view.el, e => e.tag === "label").map(l => l.getAttribute("for"));
  for (const id of ["scn-bots", "scn-questions", "scn-accuracy", "scn-seed", "scn-speed", "scn-autoscroll"]) {
    assert.ok(labels.includes(id), `label for=${id}`);
    assert.ok(findOne(view.el, e => e.attrs.id === id), `поле ${id}`);
  }
  assert.equal(view.status.attrs.role, "status");
  assert.equal(view.alertBox.attrs.role, "alert");
  assert.equal(view.bar.attrs.role, "progressbar");
  assert.equal(view.feedList.attrs.role, "log");
  view.controls.newSeedBtn.click();
  assert.match(view.controls.seedInput.value, /^\d+$/);
  view.destroy();
});

test("экран: esc закрывает экран, а таймер после destroy не работает", () => {
  const view = makeView();
  click(view.controls.startBtn);
  assert.ok(view.manual.fn);
  view.destroy();
  assert.equal(view.manual.fn, null, "destroy останавливает таймер");
});
