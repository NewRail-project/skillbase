# Project Structure

```
skillbase/
├── core/                    # Основная логика приложения
│   ├── auth.js             # Аутентификация пользователя
│   ├── admin-roles.js      # Проверки назначения и снятия администратора
│   ├── admins.js           # Роли пользователей организации в Firestore
│   ├── registration.js     # Проверки регистрации, ФИО, организация и группа по умолчанию
│   ├── editor.js           # Создание и редактирование тестов
│   ├── import/
│   │   └── parser.js       # Парсер текста тестов
│   ├── quiz.js             # Прохождение тестов
│   ├── assign.js           # Назначение тестов
│   └── grading.js          # Проверка ответов (будет реализовано)
├── shared/                 # Общие компоненты и утилиты
│   ├── app.js              # Маршрутизация приложения
│   ├── return-to.js        # Возврат к тесту после входа или регистрации
│   ├── main.js             # Точка входа приложения
│   ├── firebase.js         # Инициализация Firebase
│   ├── firebase-config.js  # Конфигурация Firebase
│   └── utils.js            # Утилиты
├── ui/                     # Пользовательский интерфейс
│   ├── pages/              # Страницы приложения
│   │   ├── home.js         # Главная страница
│   │   ├── login.js        # Страница входа
│   │   ├── register.js     # Страница регистрации
│   │   ├── profile.js      # Профиль пользователя
│   │   ├── admins.js       # Управление администраторами организации
│   │   ├── assignments.js  # Задания ученика
│   │   ├── teacher-results.js # Результаты преподавателя
│   │   ├── quiz.js         # Прохождение теста
│   │   └── ...             # Другие страницы
│   ├── editor/             # Компоненты редактора
│   │   ├── EditorComponent.js
│   │   ├── EditorStyles.css
│   │   └── index.html
│   ├── authContext.js      # Контекст аутентификации
│   └── network-status.js   # Статус сети
├── tests/                  # Тесты
│   └── parser.test.js      # Тесты для парсера
├── docs/                   # Документация
│   └── stage0.md           # Требования проекта
├── configs/                # Конфигурация
│   ├── organization.js     # ID организации и группы по умолчанию
│   ├── firebase.example.js # Шаблон конфигурации
│   └── firebase.js         # Реальная конфигурация (в .gitignore)
├── AGENTS.md               # Цели проекта и правила
├── firestore.rules         # Правила Firestore
└── index.html              # Точка входа приложения
```
## Слайды учебного материала
- `core/slides-logic.js` — чистая логика слайдов (лимиты, сжатие, сигнатуры страниц); слайд = страница книги с блоком `image` и `slide: true`.
- `core/slides-client.js` — браузерная часть: ленивая загрузка pdf.js 3.11.174 (cdnjs, SRI), рендер PDF и сжатие картинок через canvas.
- `core/material-library.js: saveLibraryPagesDiff` — запись только изменившихся страниц с прогрессом.
- Тесты: `tests/slides-logic.test.js`. Предложения без применения: `docs/proposals/`.

## Проигрывание сценария (админ-панель)
- `core/bots-plan.js` — план ответов ботов (seed, до 30 ботов, задержка 800–15000 мс).
- `core/scenario-sim.js` — `runScenario`, общее правило мест `rankBoard`, `boardFromEvents`.
- `core/scenario-player.js` — настройки (`clampSettings`), шкала времени, пауза, сброс, живой рейтинг, «дуэль только показ».
- `ui/pages/admin-scenario.js` + `ui/css/scenario.css` — экран `#admin/scenario` (только admin); подключается из `ui/pages/admin-panel.js`.
- Всё только в памяти браузера: Firestore, `core/rooms.js` и `core/battle*.js` не импортируются.
- Тесты: `tests/bots-plan.test.js`, `tests/scenario-sim.test.js`, `tests/scenario-screen.test.js`.
