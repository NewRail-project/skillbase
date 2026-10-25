# Project Structure

```
skillbase/
├── core/                    # Основная логика приложения
│   ├── auth.js             # Аутентификация пользователя
│   ├── editor.js           # Создание и редактирование тестов
│   ├── import/
│   │   └── parser.js       # Парсер текста тестов
│   ├── quiz.js             # Прохождение тестов
│   ├── assign.js           # Назначение тестов
│   └── grading.js          # Проверка ответов (будет реализовано)
├── shared/                 # Общие компоненты и утилиты
│   ├── app.js              # Маршрутизация приложения
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
│   ├── firebase.example.js # Шаблон конфигурации
│   └── firebase.js         # Реальная конфигурация (в .gitignore)
├── AGENTS.md               # Цели проекта и правила
├── firestore.rules         # Правила Firestore
└── index.html              # Точка входа приложения
```