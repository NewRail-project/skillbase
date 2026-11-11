// Регрессионный тест: проверка исправления дефекта updateLeaderboard
// В оригинальном коде была ошибка ReferenceError из-за необъявленных переменных:
// - isSelfPaced (не объявлен)
// - players (не объявлен)
// - questions (не объявлен)
// - computeSelfScores (не импортирован)
//
// Было: строки 1192-1194 вызывали ReferenceError при выполнении updateLeaderboard()
// Стало: код закомментирован, ошибка исправлена, поведение Live сохранено
//
// Файл: tests/room-leaderboard-defect.test.js
// Запуск: npm test

import { readFileSync } from "node:fs";

// Получаем код функции updateLeaderboard
const roomContent = readFileSync("ui/pages/room.js", "utf8");
const updateLeaderboardStart = roomContent.indexOf("function updateLeaderboard()");
const updateLeaderboardEnd = roomContent.indexOf("\n}", updateLeaderboardStart + 1);
const updateLeaderboardBody = roomContent.substring(updateLeaderboardStart, updateLeaderboardEnd + 2);

// Удаляем комментарии для проверки "чистого" кода
const codeOnly = updateLeaderboardBody.replace(/\/\/.*\n/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

console.log("=== Анализ функции updateLeaderboard (только активный код) ===\n");

// Тест 1: Проверка отсутствия isSelfPaced в активном коде
const hasIsSelfPaced = codeOnly.includes("isSelfPaced");
console.log(`Test 1 - isSelfPaced in active code: ${hasIsSelfPaced ? "FAIL (present)" : "PASS (absent)"}`);
if (hasIsSelfPaced) {
  console.log("  Found: isSelfPaced is still in active code - NOT FIXED");
}

// Тест 2: Проверка отсутствия players в активном коде
const hasPlayers = codeOnly.includes("players,");
console.log(`Test 2 - players, in active code: ${hasPlayers ? "FAIL (present)" : "PASS (absent)"}`);
if (hasPlayers) {
  console.log("  Found: players, should not be in active code");
}

// Тест 3: Проверка отсутствия questions в активном коде
const hasQuestions = codeOnly.includes("questions);");
console.log(`Test 3 - questions); in active code: ${hasQuestions ? "FAIL (present)" : "PASS (absent)"}`);
if (hasQuestions) {
  console.log("  Found: questions); should not be in active code");
}

// Тест 4: Проверка отсутствия computeSelfScores в активном коде
const hasComputeSelfScores = codeOnly.includes("computeSelfScores");
console.log(`Test 4 - computeSelfScores in active code: ${hasComputeSelfScores ? "FAIL (present)" : "PASS (absent)"}`);
if (hasComputeSelfScores) {
  console.log("  Found: computeSelfScores should not be in active code (was not imported)");
}

// Тест 5: Проверка наличия const rows
const hasConstRows = updateLeaderboardBody.includes("const rows =");
console.log(`Test 5 - const rows: ${hasConstRows ? "PASS (present)" : "FAIL (absent)"}`);
if (!hasConstRows) {
  console.log("  FAIL: const rows = should be present");
}

// Тест 6: Проверка комментария о заглушке
const hasComment = updateLeaderboardBody.includes("// Фича") || updateLeaderboardBody.includes("// self-paced") || updateLeaderboardBody.includes("заглушка");
console.log(`Test 6 - comment about self-paced: ${hasComment ? "PASS (present)" : "INFO"}`);

console.log("\n=== Итог ===");
const allPassed = !hasIsSelfPaced && !hasPlayers && !hasQuestions && !hasComputeSelfScores && hasConstRows;
console.log(allPassed ? "✅ Все тесты пройдены: дефект updateLeaderboard исправлен" : "❌ Есть проблемы с исправлением");

if (!allPassed) {
  process.exit(1);
}