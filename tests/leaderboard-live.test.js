// tests/leaderboard-live.test.js — рейтинг без перезагрузки страницы.
//
// ui/pages/leaderboard.js и core/attempts.js — браузерный код (Firebase),
// в Node не импортируются. Проверяем исходник: страница держит живую
// подписку (subscribeOrgAttempts), перерисовывает только список по
// подписи данных, снимает подписку в cleanup().
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const leaderboard = readFileSync(path.join(ROOT, "ui/pages/leaderboard.js"), "utf8");
const attempts = readFileSync(path.join(ROOT, "core/attempts.js"), "utf8");

test("leaderboard: живая подписка вместо разового чтения", () => {
  assert.match(leaderboard, /subscribeOrgAttempts\(State\.profile\.orgId/);
  assert.equal(leaderboard.includes("listOrgAttempts"), false,
    "разовое чтение заменено подпиской");
});

test("leaderboard: подписка снимается при уходе со страницы", () => {
  assert.match(leaderboard, /export function cleanup\(\)/);
  const cleanupBody = leaderboard.slice(
    leaderboard.indexOf("export function cleanup()"),
    leaderboard.indexOf("}", leaderboard.indexOf("activeUnsub()")) + 1);
  assert.match(cleanupBody, /activeUnsub\(\)/);
  // Подписка сохраняется в модульную переменную, а не в локальную страницы.
  assert.match(leaderboard, /activeUnsub = subscribeOrgAttempts/);
});

test("leaderboard: обновление по подписи данных, без пересборки всей страницы", () => {
  // Перерисовка списка пропускается, пока подпись строк не изменилась.
  assert.match(leaderboard, /sig === lastRowsSig\) return/);
  // Меняется только grid (список), а не контейнер страницы.
  const drawBody = leaderboard.slice(
    leaderboard.indexOf("function draw()"),
    leaderboard.indexOf("subjectSelect.onchange"));
  assert.match(drawBody, /grid\.textContent = ""/);
  assert.equal(drawBody.includes("page.textContent"), false);
  assert.equal(drawBody.includes("page.appendChild(grid)"), false);
});

test("attempts: subscribeOrgAttempts — зеркало listOrgAttempts на onSnapshot", () => {
  assert.match(attempts, /export function subscribeOrgAttempts\(orgId/);
  // Тот же запрос: orgId + опциональные subjectId/topicId, без orderBy —
  // составной индекс не требуется.
  const fn = attempts.slice(
    attempts.indexOf("export function subscribeOrgAttempts"),
    attempts.indexOf("// Точное число попыток организации"));
  assert.match(fn, /where\("orgId", "==", orgId\)/);
  assert.match(fn, /where\("subjectId", "==", subjectId\)/);
  assert.match(fn, /where\("topicId", "==", topicId\)/);
  assert.equal(fn.includes("orderBy"), false);
  assert.match(fn, /onSnapshot\(/);
  assert.match(fn, /sort\(byTimeDesc\)/);
});
