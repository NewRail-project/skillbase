# AGENTS.md — Skillbase

Корпоративная LMS для обучения и проверки знаний железнодорожной отрасли (колледжи, депо, учебные центры): тесты, учебные материалы, Live-комнаты, аналитика, профили и организации, PWA. Дизайн — строгий корпоративный, три скина (education / operations / depot), тёмно-синяя/графитовая палитра.

## Стек и запуск
- Vanilla JS (ES-модули), без фреймворков, без сборки, без npm-зависимостей приложения. Firebase SDK v10.8.0 импортируется с gstatic CDN в `shared/firebase.js`; `node_modules` — только для firebase-tools.
- Локально: любой статический сервер от корня репозитория (например `python3 -m http.server 5500`). Все пути относительные — на GitHub Pages сайт живёт в подкаталоге `/skillbase/`.
- Прод: GitHub Pages из ветки `master` (github.com/NewRail-project/skillbase) + Firebase-проект `skillbase-07363` (Auth, Firestore). `firebase.json` описывает только правила и индексы Firestore — хостинг не в Firebase.
- `PROJECT_STRUCTURE.md` и README.md в `core/`, `ui/`, `shared/` устарели (упоминают несуществующие файлы) — источники истины: код, `firestore.rules`, `docs/DEVELOPMENT.md`.

## Проверки
Обязательны перед завершением любой задачи. Не заявляй «проверено», если команда фактически не выполнялась.
- `npm test` — unit-тесты на node:test (сейчас 357). Один файл: `node --test tests/<name>.test.js`.
- `npm run test:rules` — 125 кейсов `firestore.rules` через Rules API (projects.test), НЕ локальный эмулятор. Нужен `firebase login` (или `FIREBASE_ACCESS_TOKEN`); без входа скрипт падает — это значит «не проверено».
- `node scripts/check-imports.mjs` — статический граф импортов (core/shared/ui/configs): битые пути и экспорты. Регрессия прод-инцидента: один битый `export { x }` обрывает весь модульный граф → пустой экран на всех страницах.
- `node scripts/check-contrast.mjs` — контраст палитр (все пары ≥ 4.5:1).
- `node --check <файл>` для изменённых JS; `git diff --check`.
- Playwright-смоук (`tests/smoke/`) — отдельно от npm test: требует `npm i -D @playwright/test` и сервер на localhost:5500; Firebase подменяется in-memory стабом (`rooms.fixture.js`).

## Архитектура
- Старт: `index.html` → `shared/main.js`: тема → сайдбар → `initAuth()` в фоне (роутер не ждёт auth, показывает скелет) → `initRouter()` → подписка на State → регистрация Service Worker.
- Роутер `shared/app.js`: hash-таблица `routes` с флагами `auth` / `roles: STAFF|ADMIN` / `guestOnly` / `guest`. Контракт страницы: `export default function Page()` (может быть async, возвращает HTMLElement) + опциональный `export function cleanup()` для onSnapshot, таймеров и window-слушателей. Новый маршрут = запись в таблице + файл в `ui/pages/`.
- Состояние: `State` и `subscribe()` в `core/auth.js`; `profileStatus`: idle / loading / ready / missing / error / signed-out. Перерисовка ключуется `uid|profileStatus` — сохранение полей профиля не должно перерисовывать всю страницу.
- Разделение `core/` (критично для тестов): «чистые» модули без Firebase-импортов (test-schema, test-storage, scoring, material-logic, rooms-logic, live-auto, quiz, timing, shuffle, registration, grading, assignment-logic, analytics-logic, access, admin-roles, settings, guest, consent-docs) — именно их импортируют тесты Node; модули с Firestore (auth, editor, attempts, assign, rooms, materials, profile, admins, consents) — только UI-код. Новую логику класть в чистый модуль + тест: Node не может импортировать `shared/firebase.js` (https-импорты).
- DOM: только `h()` из `shared/dom.js`; без innerHTML, пользовательские данные — через textContent.
- Темы: `data-ui` (education / operations / depot) + `data-theme` (light / dark); палитры в `ui/css/tokens.css` и `ui/css/themes/`, точные значения — `docs/DESIGN.md`. `live.css` подключается точечно (room.js, launch.js), не в index.html. Тема применяется inline-скриптом до отрисовки (без вспышки), localStorage-ключ `sb-theme`.
- Конфиги: `configs/firebase.js` (публичная веб-конфигурация, в git) и `configs/organization.js`: `DEFAULT_ORG_ID` / `DEFAULT_GROUP_ID` ('default-org' / 'default-group') должны совпадать с константами в firestore.rules, иначе правило create для users/{uid} отклонит регистрацию.

## Firestore
- Схема — по `firestore.rules` (~1000 строк, default-deny): users, publicProfiles, tests (+subcollection versions), testKeys, activeAttempts, materials/pages, materialProgress, attempts, assignments, rooms (players, players/answers, scores, reveals, reactions, observers).
- Роли без custom claims: role и orgId читаются из `users/{uid}`; staff = teacher | admin; изоляция данных по orgId.
- Секретность ответов: правильные ответы не лежат в `tests/{id}` — `splitForStorage()` (core/editor.js) раскладывает на публичный тест и закрытый `testKeys/{id}`; студент читает keys только при открытой попытке и включённом `showCorrectAfterQuestion`, гостям — никогда.
- Индексы: `firestore.indexes.json`. Equality-запросы обслуживаются автоматикой Firestore, но неравенство (`!=`, `<`, `>`) в запросе требует составного индекса (equality-поля, затем поле неравенства последним); `getCountFromServer` требует те же индексы, что и `getDocs`. Добавил where с неравенством — дополни индексы и задеплой `firebase deploy --only firestore:indexes`, иначе в рантайме failed-precondition.

## Live-комнаты
- Режимы `auto` | `manual` (`rooms/{code}.mode`). Auto: ведущий пишет `autoStartedAt`, номер вопроса — функция серверного времени (чистый `core/live-auto.js`); правила Firestore пересчитывают окно ответа от `request.time` и отклоняют ответ «не на тот вопрос» / после окна.
- Бэкенда нет: `reveals/{позиция}` и `scores/{uid}` пишет страница ведущего; пересчёт идемпотентен. Cloud Functions в проекте нет.
- Состояния клиента: connecting → waiting → in_progress → completed (+ connection_error, closed); таймаут входа 15 с. Роли в комнате: player | observer. Подробности — `docs/LIVE.md`.

## Красные линии
- Не ослаблять `firestore.rules`; никаких `allow read, write: if true`. Изменения правил — только вместе с кейсами в `tools/rules-test.mjs`.
- Не обходить безопасность запросами: никакого чтения всей коллекции вместо индексированного запроса; чужие черновики, тесты других организаций и ответы до сдачи — недоступны клиенту.
- Не менять схему документов Firestore и не удалять пользовательские данные без явной необходимости; при проверках не трогать боевые данные Firebase.
- Авторизация (email/password, Google, гость-аноним), тесты, материалы, Live-комнаты — работающие функции: не считать их отсутствующими и не ломать регрессиями.

## Публикация — только по явной команде пользователя
- Без прямой команды запрещены: `git commit`, `git push`, `firebase deploy`, удаление веток/истории и данных Firebase. Изменения оставлять локально + отчёт.
- Деплой по команде: `node scripts/bump-version.mjs` (пишет `?v=` в index.html и `CACHE_VERSION` в sw.js; формат `1.0.0.YYYYMMDDHHmmss`) → проверки → commit → push → `firebase deploy --only firestore:rules,firestore:indexes`. Референс — `deploy-termux.sh`.
- Вложенные ES-модули не получают `?v=` намеренно (иначе двойная загрузка); свежесть вложенных модулей обеспечивается новым HTML + новым кэшем SW + однократным retry в app.js.

## Материал-книга (не ломать)
- Не менять без запроса: core/material-logic.js, core/materials.js, ui/pages/material.js, блок buildMaterialEditor в ui/pages/create-test.js.
- Функция paginateText (авторазбивка текста на страницы) и режим #material/<id>/free обязательны; тесты в tests/material-logic.test.js должны проходить.
- Перед коммитом: npm test.

## Стиль работы
- Мобильный экран — приоритет дизайна и вёрстки; адаптивность обязательна.
- Один промпт — одна задача; малые изолированные изменения; не дублировать функции, компоненты и CSS-правила; сохранять стиль и именование окружающего кода.
- Перед правкой модуля читать его код и зависимые модули; не переписывать работающее без необходимости.
- Ошибки, загрузка и пустые состояния обязательны (empty-state, confirmAction, toast); никаких бесконечных загрузок и заглушек вместо функциональности.
- Отчёт по задаче: что обнаружено / что изменено / почему так / какие проверки выполнены (фактически) / что осталось.
