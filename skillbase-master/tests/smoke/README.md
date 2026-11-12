# tests/smoke — Playwright-смоук Live-комнат

Сценарий: ведущий, два участника, наблюдатель; три вопроса
(single, multiple, short), автопроверка таблицы results, обучающее
задание и тест без лимита времени. Firebase подменяется на
in-memory `window.__stub` (rooms.fixture.js) до загрузки приложения.

## Запуск

```bash
npm i -D @playwright/test
npx playwright install chromium
npx playwright test tests/smoke/rooms.spec.js
```

Приложение должно быть запущено локально (`firebase serve` или любой
static-сервер каталога репозитория) на http://localhost:5500 — иначе
укажите `APP_URL=http://host:port/index.html`.

## Оговорка

- Хarness включает подмену сетевого слоя только для smoke-запуска;
  в продакшане (`index.html`) никаких `__stub` нет.
- Селекторы привязаны к текущему интерфейсу: `#join/<code>`,
  `#launch/<testId>`, `.room-code-badge`, `.room-question`,
  `.room-status`, `.option input[type=radio|checkbox]`,
  `table.table`. При переименовании классов обновить spec.
