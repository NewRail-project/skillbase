# Firebase: настройка и развёртывание

Этот документ описывает, что нужно сделать в Firebase Console и какие
команды выполнить при подключении проекта. В рамках разработки команды
`firebase deploy` и изменения Console **не выполнялись**.

## 1. Authentication

1. Firebase Console → Authentication → Sign-in method.
2. Включите **Email/Password**.
3. Authentication → Settings → Authorized domains:
   - `localhost` (для локальной проверки);
   - домен GitHub Pages, например `username.github.io`.
4. Регистрация в приложении создаёт пользователя Firebase Auth и документ
   `users/{uid}` с ролью `student` и организацией `default-org`.

## 2. Первый администратор

Самостоятельная регистрация всегда создаёт студента. Первого администратора
нужно назначить вручную:

1. Зарегистрируйтесь в приложении.
2. Firebase Console → Firestore → коллекция `users` → документ с вашим UID.
3. Установите:
   - `role`: `admin`
   - `orgId`: `default-org`
   - `fullName`: ваше имя
4. Перезайдите в приложение.

Для MVP используйте `default-org`: самостоятельная регистрация всегда создаёт
пользователя в этой организации, а правила не разрешают администратору менять
`orgId`. Отдельная организация настраивается вручную в Console (пользователи,
тесты и публичные профили должны получить одинаковый `orgId`).

Дальше роли и группы сотрудников меняются на странице «Пользователи».
Администратор не может менять собственную роль через интерфейс. После смены
роли или группы пользователю нужно обновить страницу (или войти заново),
чтобы приложение перечитало профиль.

## 3. Firestore

Правила и индексы лежат в репозитории:

- `firestore.rules` — доступ к пользователям, тестам, ключам, попыткам и назначениям;
- `firestore.indexes.json` — составные индексы для запросов.

Проверка и развёртывание (выполнять вручную, из корня проекта):

```bash
firebase login
firebase use --add          # выбрать проект
firebase deploy --only firestore:rules,firestore:indexes
```

Перед deploy полезно посмотреть предполагаемые изменения:

```bash
firebase deploy --only firestore:rules,firestore:indexes --dry-run
```

`--dry-run` может включать API в проекте. Если это нежелательно, сначала
разверните правила в тестовом проекте.

### Эмулятор

Для полноценной проверки правил нужен Firestore Emulator и Java:

```bash
firebase emulators:start --only firestore
```

В текущем окружении Java нет, поэтому проверки правил на эмуляторе не
выполнялись. Синтаксис и согласованность правил проверены статически.

## 4. Схема данных

### `users/{uid}`

`email`, `role` (`student|teacher|admin`), `orgId`, `fullName`, `groupId`,
`ui`, `themeMode`, `position`, `department`, `createdAt`, `updatedAt`.

### `publicProfiles/{uid}`

`displayName`, `avatar` (data URL), `orgId`, `updatedAt`. Используется для
имён в журнале и на экране проверки.

### `tests/{testId}`

Публичная часть теста: `title`, `description`, `instructions`, `settings`,
`questions` **без правильных ответов**, `authorId`, `orgId`, `status`,
`version`, `createdAt`, `updatedAt`, `publishedAt`.

### `testKeys/{testId}`

Закрытые ключи: `items` — объект `{"0": {type, points, correct|answer}, ...}`.
Читать могут только сотрудники той же организации; ученик не получает
правильные ответы даже при прямом запросе.

### `tests/{testId}/versions/{versionId}`

Снимок опубликованной версии. Создаётся при публикации, не изменяется.

### `attempts/{attemptId}`

`userId`, `userEmail`, `orgId`, `testId`, `testTitle`, `assignmentId`,
`answers`, `status` (`in_progress|submitted|graded`), `attemptNo`,
`startedAt`, `submittedAt`, `finishedAt`, `score`, `total`, `percent`,
`review`, `gradedBy`, `gradedAt`.

Ученик может создать только собственную попытку, менять ответы до отправки
и перевести её в `submitted`. Поля оценки (`score`, `total`, `percent`,
`gradedBy`, `gradedAt`) и статус `graded` доступны только сотруднику.

### `assignments/{assignmentId}`

`testId`, `testTitle`, `teacherId`, `groupId`, `orgId`, `deadline`,
`attemptsLimit`, `status` (`active|closed`), `createdAt`, `updatedAt`.

## 5. Ограничения текущего MVP

- Лимит попыток и дедлайн проверяются на клиенте и по правам доступа к
  назначению. Полное серверное ограничение количества попыток требует
  Cloud Function или транзакционного счётчика.
- Каталог показывает все опубликованные тесты организации. Дедлайн и лимит
  конкретного назначения применяются при переходе из «Заданий» (или с главной
  страницы). Прямой запуск того же теста из каталога использует настройки
  самого теста.
- Firestore Rules проверяют поля документа `tests`, но не обходят вложенный
  массив `questions`. Приложение выносит правильные ответы в `testKeys`; запись
  ключей в публичную часть в обход приложения правила не запрещают.
- Проверка ответов выполняется на стороне преподавателя: только у него
  есть доступ к `testKeys`.
- Автоматическая проверка `single`/`multiple` и точное сравнение `short`
  выполняются в `core/scoring.js`. Короткий ответ преподаватель может
  засчитать вручную; решение сохраняется в `attempts.review`.
- Изменение опубликованного теста сохраняется в тот же документ. Кнопка
  «Опубликовать» создаёт новую запись в `versions` и увеличивает `version`.
- Правильные ответы не попадают в публичный документ `tests` и не
  записываются в попытку.
