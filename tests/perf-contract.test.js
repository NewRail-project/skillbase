// tests/perf-contract.test.js — техническая оптимизация: контракты,
// которые нельзя молча сломать. Браузерный код (Firestore) в Node не
// импортируется — проверяем исходник по опыту room-leaderboard-defect.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

test("профиль: один запрос попыток на страницу, а не по блоку", () => {
  const src = read("ui/pages/profile.js");
  // renderReady создаёт общий промис; блоки его ждут, собственных
  // listMyAttempts вызовов больше нет.
  assert.equal(src.split("listMyAttempts(").length - 1, 1,
    "listMyAttempts должен вызываться один раз в renderReady");
  assert.match(src, /const attemptsPromise = listMyAttempts/);
  assert.match(src, /await attemptsPromise/);
});

test("subjects: кэш читается в getSubjects/getTopics и сбрасывается при записях", () => {
  const src = read("core/subjects.js");
  assert.match(src, /const refCache = createReferenceCache\(\)/);
  // Чтение через кэш: и getSubjects, и getTopics.
  assert.match(src, /const cached = refCache\.get\(cacheKey\);\s*\n\s*if \(cached\) return cached;/);
  assert.equal(src.split("refCache.clear()").length - 1 >= 4, true,
    "сброс кэша при create/update subject и topic (4 места: 2 create + 2 update)");
});

test("subjects: moveTopic — один writeBatch вместо двух последовательных updateDoc", () => {
  const src = read("core/subjects.js");
  const moveBody = src.slice(src.indexOf("export async function moveTopic"));
  assert.match(moveBody, /writeBatch\(db\)/);
  assert.match(moveBody, /batch\.commit\(\)/);
  assert.equal(moveBody.includes("await updateTopic("), false,
    "два последовательных updateDoc заменены батчем");
  assert.match(moveBody, /refCache\.clear\(\)/);
});

test("test-history: фильтр testId уходит в запрос, а не только на клиент", () => {
  const history = read("ui/pages/test-history.js");
  assert.match(history, /listOrgAttempts\(State\.profile\.orgId, \{ testId \}\)/);
  const attempts = read("core/attempts.js");
  const listBody = attempts.slice(
    attempts.indexOf("export async function listOrgAttempts"),
    attempts.indexOf("export function subscribeOrgAttempts"));
  assert.match(listBody, /where\("testId", "==", testId\)/);
});

test("publicProfiles: чанки читаются параллельно, состав чтений не менялся", () => {
  const src = read("core/profile.js");
  const body = src.slice(src.indexOf("export async function loadPublicProfiles"));
  assert.match(body, /Promise\.all\(/);
  assert.match(body, /unique\.slice\(i \* 20, \(i \+ 1\) \* 20\)/);
});

test("leaderboard: подписка снимается и не создаётся дважды при повторном входе", () => {
  const src = read("ui/pages/leaderboard.js");
  assert.match(src, /export function cleanup\(\)/);
  assert.match(src, /cleanup\(\); \/\/ защита от повторного входа/);
});
