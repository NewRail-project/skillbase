// tests/rating-page.test.js — фактическая работа страницы учебного рейтинга:
// выполняется настоящая ui/pages/leaderboard.js (Firebase подменён заглушками,
// DOM — минимальный), фильтры меняются как у пользователя.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { installFakeDom, byLabel, findAll, findOne, optionsOf, choose, text } from "./helpers/fake-dom.js";
import { makeFixture } from "./helpers/analytics-fixture.js";

register("./helpers/stub-loader.mjs", import.meta.url);
installFakeDom();
const lb = await import("../ui/pages/leaderboard.js");

const tick = () => new Promise(r => setTimeout(r, 0));
async function open({ profile = { uid: "staff1", role: "admin", orgId: "o1" }, leak = false, mutate = null } = {}) {
  const fx = makeFixture();
  if (mutate) mutate(fx);
  globalThis.__SB = { ...fx, profile, leak, calls: [], staff: true };
  const page = await lb.default();
  await tick(); await tick(); // подписка и список учеников приходят асинхронно
  return page;
}
const has = (el, cls) => el.className.split(/\s+/).includes(cls);
const cards = page => findAll(page, e => e.tag === "tr" && has(e, "rate-row"));
const rowOf = card => ({
  place: text(findOne(card, e => has(e, "rate-place"))),
  name: text(card.children[1]),
  score: text(findOne(card, e => has(e, "rate-score"))),
  count: text(card.children[3]),
  best: text(card.children[4]),
  medal: ["1", "2", "3"].find(n => has(card, `rate-medal-${n}`)) || null
});
const rows = page => cards(page).map(rowOf);
const groupValues = page => optionsOf(byLabel(page, "Фильтр по группе")).map(o => o.value).filter(Boolean);

test("рейтинг: карточки с местом, именем из ростера, баллом; медали у первых трёх", async () => {
  const page = await open({ leak: true }); // данные чужой организации «утекли»
  const r = rows(page);
  assert.deepEqual(r.map(x => [x.place, x.name, x.score]), [
    ["1", "Вера", "75 б."], ["2", "Анна", "65 б."], ["3", "Борис", "50 б."], ["4", "Глеб", "43 б."]
  ]);
  assert.deepEqual([r[1].count, r[1].best], ["3", "90 б."]);
  assert.deepEqual(r.map(x => x.medal), ["1", "2", "3", null]);
  assert.match(text(page), /Студентов в рейтинге: 4 · средний балл: 58 б\./);
  // Нет старой «нумерации» и служебных значений на экране; Live-карточек нет.
  assert.ok(!/\bnull\b|\bundefined\b|NaN/.test(text(page)));
  assert.equal(findAll(page, e => has(e, "lb-card")).length, 0);
  assert.equal(findAll(page, e => e.tag === "table").length, 1, "рейтинг — таблица (ФИО и оценки)");
  assert.deepEqual(findAll(page, e => e.tag === "th").map(text), ["Место", "ФИО", "Средний балл", "Попыток", "Лучший"]);
  assert.ok(!text(page).includes("Чужой") && !text(page).includes("Гость"));
  assert.equal(findAll(page, e => has(e, "rate-fill") && has(e, "is-low")).length, 2);
});

test("рейтинг: фильтр дисциплины перестраивает список и доступные группы", async () => {
  const page = await open();
  assert.deepEqual(groupValues(page), ["g1", "g2"]);
  choose(byLabel(page, "Фильтр по дисциплине"), "subjP");
  assert.deepEqual(rows(page).map(x => [x.name, x.score]), [["Вера", "80 б."], ["Глеб", "43 б."]]);
  assert.deepEqual(groupValues(page), ["g2"], "по Физике занималась только g2");
  choose(byLabel(page, "Фильтр по дисциплине"), "subjE");
  assert.equal(cards(page).length, 0);
  assert.match(text(page), /Нет результатов для отображения/);
  assert.deepEqual(groupValues(page), []);
});

test("рейтинг: смена дисциплины сбрасывает несовместимую группу", async () => {
  const page = await open();
  choose(byLabel(page, "Фильтр по дисциплине"), "subjM");
  choose(byLabel(page, "Фильтр по группе"), "g1");
  assert.deepEqual(rows(page).map(x => x.name), ["Анна", "Борис"]);
  assert.deepEqual(rows(page).map(x => x.place), ["1", "2"], "места считаются внутри выборки");
  choose(byLabel(page, "Фильтр по дисциплине"), "subjP"); // g1 по Физике нет
  assert.equal(optionsOf(byLabel(page, "Фильтр по группе")).find(o => o.selected).value, "");
  assert.deepEqual(rows(page).map(x => x.name), ["Вера", "Глеб"]);
});

test("рейтинг: преподаватель с teacherGroups видит только свои группы", async () => {
  const page = await open({ profile: { uid: "t1", role: "teacher", orgId: "o1", teacherGroups: ["g1"] } });
  assert.deepEqual(rows(page).map(x => x.name), ["Анна", "Борис"]);
  assert.deepEqual(groupValues(page), ["g1"]);
});

test("рейтинг: подписка одна, отписка при уходе, пустая организация без ошибок", async () => {
  const page = await open();
  assert.equal(globalThis.__SB.calls.filter(c => c[0] === "subscribeOrgAttempts").length, 1);
  lb.cleanup();
  assert.equal(globalThis.__SB.unsubscribed, 1);
  const empty = await open({ mutate: fx => { fx.attempts = []; fx.users = []; } });
  assert.match(text(empty), /Нет результатов для отображения/);
  assert.equal(cards(empty).length, 0);
});
