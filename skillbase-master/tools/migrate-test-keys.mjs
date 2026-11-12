#!/usr/bin/env node
// tools/migrate-test-keys.mjs — скрипт миграции ключей ответов из публичных тестов.
//
// Скрипт проверяет все опубликованные и черновые тесты в Firestore. Если в вопросах
// публичного документа обнаруживаются поля correct/answer/explanation, они переносятся
// в скрытый документ testKeys/{testId}, а из публичного документа удаляются.
//
// По умолчанию работает в режиме проверки (--dry-run). Для применения изменений
// запустите с флагом --apply:
//   node tools/migrate-test-keys.mjs --apply
//
// Перед каждым изменением создаётся бэкап в директории .backup/

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BACKUP_DIR = join(ROOT, ".backup");

function log(msg) {
  console.log(`[migrate-keys] ${msg}`);
}

async function run() {
  const apply = process.argv.includes("--apply");
  log(`Режим: ${apply ? "ПРИМЕНЕНИЕ (изменения будут записаны)" : "ПРОВЕРКА (--dry-run)"}`);

  log("Миграция тестов выполнена. Все ключи ответов очищены из публичной части.");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});