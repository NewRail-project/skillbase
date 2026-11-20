import test from "node:test";
import assert from "node:assert/strict";
import { installFakeDom, findAll, text, choose } from "./helpers/fake-dom.js";
import { buildBattlePrep } from "../ui/components/battle-prep.js";
import { buildDuelsDoc, applyDecision } from "../core/duel-logic.js";

installFakeDom();
const players = Array.from({ length: 9 }, (_, i) => ({ uid: "u" + (i + 1), displayName: "Игрок " + (i + 1) }));
const ranking = players.map((p, i) => ({ uid: p.uid, score: 100 - i * 5 }));
const btn = (root, label) => findAll(root, (e) => e.tag === "button" && text(e) === label)[0];
const group = (root, team) => findAll(root, (e) => e.attrs?.["data-team"] === team)[0];
const count = (root, team) => findAll(group(root, team), (e) => e.tag === "li").length;

test("панель: распределение — капитаны по рейтингу, равные команды, резерв", () => {
  let started = null;
  const root = buildBattlePrep({ players, ranking, onStart: (x) => { started = x; } });
  btn(root, "Распределить команды").click();
  assert.equal(count(root, "a"), 4);
  assert.equal(count(root, "b"), 4);
  assert.equal(count(root, "reserve"), 1);
  btn(root, "Запустить битву").click();
  assert.equal(started.roster.captains.a, "u1");
  assert.equal(started.roster.captains.b, "u2");
  assert.equal(started.settings.minPlayers, 8);
});

test("панель: игрока можно переместить в резерв, капитана — нет", () => {
  const root = buildBattlePrep({ players, ranking });
  btn(root, "Распределить команды").click();
  const row = findAll(group(root, "a"), (e) => e.tag === "li")[1];
  findAll(row, (e) => e.tag === "button" && text(e) === "→ резерв")[0].click();
  assert.equal(count(root, "a"), 3);
  assert.equal(count(root, "reserve"), 2);
  const capRow = findAll(group(root, "a"), (e) => e.tag === "li")[0];
  assert.equal(findAll(capRow, (e) => e.tag === "button").length, 0);
});

test("панель: меньше 8 участников — предупреждение, составы не строятся", () => {
  const msgs = [];
  const root = buildBattlePrep({ players: players.slice(0, 7), ranking, onToast: (m) => msgs.push(m) });
  btn(root, "Распределить команды").click();
  assert.match(msgs[0], /минимум 8/);
  assert.equal(findAll(root, (e) => e.attrs?.["data-team"]).length, 0);
});

test("панель: ничья за 2-е место требует Дуэли, после неё составы строятся", () => {
  const tied = [{ uid: "u1", score: 90 }, { uid: "u2", score: 80 }, { uid: "u3", score: 80 }, ...players.slice(3).map((p) => ({ uid: p.uid, score: 10 }))];
  const msgs = [];
  // Без разрешённой «Дуэли» — панель просит её провести (не придумывает победителя).
  const r1 = buildBattlePrep({ players, ranking: tied, onToast: (m) => msgs.push(m) });
  btn(r1, "Распределить команды").click();
  assert.match(msgs[0], /Дуэл/);
  // С разрешённой «Дуэли» (победитель u3) — составы строятся, капитаны u1 и u3.
  const doc = buildDuelsDoc({
    rows: [{ uid: "u2", score: 80, correctCount: 0 }, { uid: "u3", score: 80, correctCount: 0 }],
    questionCount: 2
  });
  const duelGroup = doc.groups[0];
  const decided = applyDecision(duelGroup, {
    order: ["u3", "u2"], reason: "решение", authorUid: "t", authorName: "Т", at: 1
  }, 2);
  const resolvedDoc = { ...doc, groups: [decided] };
  const r2 = buildBattlePrep({ players, ranking: tied, duelsDoc: resolvedDoc });
  btn(r2, "Распределить команды").click();
  assert.equal(count(r2, "b") > 0, true);
  // Победитель дуэли (u3) стал капитаном B, u1 — капитаном A.
  assert.equal(findAll(group(r2, "a"), (e) => e.tag === "li").length, 4);
});

test("панель: отдельный набор вопросов предлагается из списка и уходит в настройки запуска", async () => {
  let started = null;
  const root = buildBattlePrep({
    players, ranking, currentTestId: "live1", settings: { battleTestId: "bank1" },
    loadBanks: async () => [{ id: "live1", title: "Этот тест" }, { id: "bank1", title: "Банк битвы" }, { id: "bank2", title: "Другой банк" }],
    onStart: (x) => { started = x; }
  });
  await new Promise((r) => setImmediate(r));
  const opts = findAll(root, (e) => e.tag === "option").map((o) => text(o));
  assert.ok(opts.includes("Банк битвы") && opts.includes("Другой банк"));
  assert.ok(!opts.includes("Этот тест")); // текущий тест — это пункт «Вопросы этого теста»
  btn(root, "Распределить команды").click();
  btn(root, "Запустить битву").click();
  assert.equal(started.settings.battleTestId, "bank1");
});

test("панель: без отдельного набора battleTestId не добавляется", () => {
  let started = null;
  const root = buildBattlePrep({ players, ranking, onStart: (x) => { started = x; } });
  btn(root, "Распределить команды").click();
  btn(root, "Запустить битву").click();
  assert.equal("battleTestId" in started.settings, false);
});

test("панель: изменение веса Live пересчитывает Battle так, чтобы сумма была 100%", () => {
  // Вес Battle не имеет отдельного поля — он вычисляется из weightLive.
  // Если oninput переписывался (баг), weightBattle оставался 0.4 и при
  // weightLive=0.7 сумма была бы 1.1 — normalizeSettings ругался бы.
  const distributeBtn = (root) => findAll(root, (e) => e.tag === "button" && /распределить/i.test(e.textContent))[0];
  const msgs = [];
  const root = buildBattlePrep({ players, ranking, onToast: (m) => msgs.push(m) });
  const inputs = findAll(root, (e) => e.tag === "input" && e.attrs?.type === "number");
  const live = inputs.find((e) => e.attrs?.min === "0" && e.attrs?.max === "1" && e.attrs?.step === "0.05");
  assert.equal(live.attrs.value, "0.6");
  live.attrs.value = "0.7";
  live.dispatch("input", { target: { value: "0.7" } });
  msgs.length = 0;
  distributeBtn(root).click();
  assert.equal(msgs.length, 0, "после weightLive=0.7 (Battle=0.3) сумма 1, ошибок нет");
  // Другое значение тоже синхронизируется.
  live.attrs.value = "0.3";
  live.dispatch("input", { target: { value: "0.3" } });
  msgs.length = 0;
  distributeBtn(root).click();
  assert.equal(msgs.length, 0, "после weightLive=0.3 (Battle=0.7) сумма 1, ошибок нет");
});

test("панель: oninput веса Live не переписывается — Battle пересчитывается для любого значения", () => {
  // Баг: num() расставлял oninput после ...attrs, поэтому переданный в
  // attrs oninput (пересчёт weightBattle) терялся. Тогда при weightLive=0.25
  // weightBattle оставался 0.4 → сумма 0.65 → normalizeSettings ругался.
  // После исправления weightBattle = 1 - weightLive, сумма всегда 1.
  const cases = [0.25, 0.95, 0.1, 0.0, 1.0];
  for (const w of cases) {
    const msgs = [];
    const root = buildBattlePrep({ players, ranking, onToast: (m) => msgs.push(m) });
    const inputs = findAll(root, (e) => e.tag === "input" && e.attrs?.type === "number");
    const live = inputs.find((e) => e.attrs?.min === "0" && e.attrs?.max === "1" && e.attrs?.step === "0.05");
    live.attrs.value = String(w);
    live.dispatch("input", { target: { value: String(w) } });
    msgs.length = 0;
    btn(root, "Распределить команды").click();
    assert.equal(msgs.length, 0, `weightLive=${w}: Battle=${1 - w}, сумма 1, ошибок нет`);
  }
});

// --- Сохранение и восстановление настроек битвы ---
test("панель: настройки восстанавливаются из saved при инициализации", () => {
  const saved = {
    battleTestId: "test123",
    questionCount: 15,
    questionSeconds: 45
  };
  const root = buildBattlePrep({
    players, ranking,
    loadBanks: async () => [{ id: "test123", title: "Тест 123" }, { id: "bank1", title: "Банк 1" }],
    settings: saved
  });
  // Проверяем, что поля инициализируются сохранёнными значениями
  const inputs = findAll(root, (e) => e.tag === "input" && e.attrs?.type === "number");
  const countInput = inputs.find((e) => e.attrs?.min === "1" && e.attrs?.max === "50");
  const secondsInput = inputs.find((e) => e.attrs?.min === "5" && e.attrs?.max === "3600");
  assert.equal(countInput.attrs.value, "15");
  assert.equal(secondsInput.attrs.value, "45");
  // Проверяем, что select для battleTestId выбран
  const selects = findAll(root, (e) => e.tag === "select");
  const bankSelect = selects.find((e) => e.textContent.includes("Тест 123"));
  assert.equal(bankSelect.value, "test123");
});

test("панель: изменение questionCount вызывает onSaveSettings с новым значением", () => {
  let saved = null;
  const root = buildBattlePrep({ players, ranking, onSaveSettings: (s) => { saved = s; } });
  const inputs = findAll(root, (e) => e.tag === "input" && e.attrs?.type === "number");
  const countInput = inputs.find((e) => e.attrs?.min === "1" && e.attrs?.max === "50");
  countInput.attrs.value = "20";
  countInput.dispatch("input", { target: { value: "20" } });
  assert.equal(saved.questionCount, 20);
  assert.equal(saved.battleTestId, ""); // не менялся
  assert.equal(saved.questionSeconds, 30); // не менялся
});

test("панель: изменение questionSeconds вызывает onSaveSettings", () => {
  let saved = null;
  const root = buildBattlePrep({ players, ranking, onSaveSettings: (s) => { saved = s; } });
  const inputs = findAll(root, (e) => e.tag === "input" && e.attrs?.type === "number");
  const secondsInput = inputs.find((e) => e.attrs?.min === "5" && e.attrs?.max === "3600");
  secondsInput.attrs.value = "60";
  secondsInput.dispatch("input", { target: { value: "60" } });
  assert.equal(saved.questionSeconds, 60);
});

test("панель: выбор battleTestId вызывает onSaveSettings", async () => {
  let saved = null;
  const root = buildBattlePrep({
    players, ranking,
    loadBanks: async () => [{ id: "bank1", title: "Банк 1" }, { id: "bank2", title: "Банк 2" }],
    onSaveSettings: (s) => { saved = s; }
  });
  await new Promise((r) => setImmediate(r));
  const selects = findAll(root, (e) => e.tag === "select");
  const bankSelect = selects.find((e) => e.textContent.includes("Банк 1"));
  choose(bankSelect, "bank2");
  assert.equal(saved.battleTestId, "bank2");
});

test("панель: при отсутствии настроек используются умолчания", () => {
  const root = buildBattlePrep({ players, ranking });
  const inputs = findAll(root, (e) => e.tag === "input" && e.attrs?.type === "number");
  const countInput = inputs.find((e) => e.attrs?.min === "1" && e.attrs?.max === "50");
  const secondsInput = inputs.find((e) => e.attrs?.min === "5" && e.attrs?.max === "3600");
  assert.equal(countInput.attrs.value, "10"); // DEFAULT_BATTLE_SETTINGS.questionCount
  assert.equal(secondsInput.attrs.value, "30"); // DEFAULT_BATTLE_SETTINGS.questionSeconds
  const selects = findAll(root, (e) => e.tag === "select");
  const bankSelect = selects.find((e) => e.textContent.includes("Вопросы этого теста"));
  assert.equal(bankSelect.value, ""); // пусто по умолчанию
});
