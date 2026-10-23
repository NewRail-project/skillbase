// docs/DEVELOPMENT.md
# Руководство разработчика

## Стек технологий

- **Frontend**: Vanilla JavaScript (ES Modules)
- **Backend**: Firebase (Auth, Firestore)
- **Deployment**: GitHub Pages
- **Тестирование**: Node.js built-in test runner

## Структура проекта

### core/ - Основная логика
- `auth.js` - Аутентификация пользователя
- `editor.js` - Создание и редактирование тестов
- `quiz.js` - Прохождение тестов
- `assign.js` - Назначение тестов
- `import/parser.js` - Парсер текста тестов

### shared/ - Общие компоненты
- `app.js` - Маршрутизация
- `main.js` - Точка входа
- `firebase.js` - Инициализация Firebase
- `utils.js` - Утилиты

### ui/ - Пользовательский интерфейс
- `pages/` - Страницы приложения
- `editor/` - Компоненты редактора

## Правила разработки

1. **Мобильный приоритет** - Все компоненты должны быть адаптивными
2. **Одна задача за раз** - Не реализовывать лишнего в одном промпте
3. **Коммит после этапа** - Версионирование после завершения задачи
4. **Безопасность** - Правильные ответы не хранятся в публичных данных

## Тестирование

```bash
# Запуск тестов
node --test tests/parser.test.js

# Проверка синтаксиса
node --check core/editor.js
```

## Firebase

Подробная инструкция: [`docs/FIREBASE_SETUP.md`](FIREBASE_SETUP.md).

1. Создать проект в Firebase Console
2. Настроить Auth (Email/Password)
3. Настроить Firestore Security Rules
4. Заполнить `configs/firebase.js` реальными ключами