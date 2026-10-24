#!/usr/bin/env node

// Скрипт для запуска тестов Firestore правил

import { main } from './tools/rules-test.mjs';

(async () => {
    try {
        await main();
    } catch (err) {
        console.error("Ошибка при запуске тестов:", err.message);
        process.exit(1);
    }
})();