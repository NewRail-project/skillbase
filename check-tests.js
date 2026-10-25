import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd());
const DB = "/databases/(default)/documents";
const ORG = "default-org";
const ISO = "2026-01-01T00:00:00Z";

// Функция для чтения файла тестов
const rulesTestContent = readFileSync(join(ROOT, "tools/rules-test.mjs"), "utf8");
console.log("Файл тестов прочитан успешно");

// Проверим, что файл содержит тесты
const testCasesRegex = /const cases = \[(.*?)\];/s;
const match = testCasesRegex.exec(rulesTestContent);
if (match) {
    console.log("Найдены тесты в файле");
    const casesContent = match[1];
    console.log("Количество тестов:", casesContent.split("readCase").length - 1);
} else {
    console.log("Тесты не найдены в файле");
}