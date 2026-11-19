import test from "node:test";
import assert from "node:assert/strict";
import { installFakeDom, findAll, text } from "./helpers/fake-dom.js";
import { buildBattlePrep } from "../ui/components/battle-prep.js";

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
  const r1 = buildBattlePrep({ players, ranking: tied, onToast: (m) => msgs.push(m) });
  btn(r1, "Распределить команды").click();
  assert.match(msgs[0], /Дуэл/);
  const r2 = buildBattlePrep({ players, ranking: tied, duelWinners: ["u3"] });
  btn(r2, "Распределить команды").click();
  assert.equal(count(r2, "b") > 0, true);
});
