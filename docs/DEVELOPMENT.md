// docs/DEVELOPMENT.md
# Руководство разработчика

## Стек технологий

- **Frontend**: Vanilla JavaScript (ES Modules)
- **Backend**: Firebase (Auth, Firestore)
- **Deployment**: GitHub Pages
- **Тестирование**: Node.js built-in test runner

## Структура проекта

### core/ - Основная логика
- `auth.js` - Аутентификация пользователя, загрузка профиля
- `registration.js` - Чистые проверки регистрации, ФИО, организация и группа по умолчанию
- `admin-roles.js` - Чистые проверки назначения и снятия административной роли
- `admins.js` - Список пользователей организации и изменение роли через Firestore
- `profile.js` - Имена, публичные профили, аватары, статистика
- `editor.js` - Создание и редактирование тестов
- `quiz.js` - Прохождение тестов
- `assign.js` - Назначение тестов
- `import/parser.js` - Парсер текста тестов

### configs/ - Конфигурация
- `organization.js` - `DEFAULT_ORG_ID` и `DEFAULT_GROUP_ID` для регистрации
- `firebase.js` - Ключи проекта Firebase

### shared/ - Общие компоненты
- `app.js` - Маршрутизация
- `return-to.js` - Возврат к тесту после входа или регистрации
- `main.js` - Точка входа
- `firebase.js` - Инициализация Firebase
- `utils.js` - Утилиты

### ui/ - Пользовательский интерфейс
- `pages/` - Страницы приложения
- `pages/admins.js` - Управление администраторами организации
- `components/confirm.js` - Модальное подтверждение опасных действий
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