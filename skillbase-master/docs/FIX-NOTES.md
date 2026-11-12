# Что исправлено (аудит)
1. shared/firebase.js не экспортировал signInWithEmailAndPassword, doc, getDoc и др. -> core/auth.js падал на импорте -> пустой экран.
2. configs/firebase.js был в .gitignore -> на GitHub Pages файла нет -> приложение не стартует.
3. Кнопки «Войти»/«Зарегистрироваться» были disabled навсегда.
4. Роутер не понимал #quiz/ID, не ждал async-страницы, не было страниц тестов в меню.
5. core/editor.js использовал старый compat API (db.collection) -> создание теста падало.
6. Любой пользователь мог сделать себя admin (профиль + правила). Теперь роль меняет только админ (#users).
7. Правила Firestore переписаны (попытки, ключи, роли). Правильные ответы лежат в testKeys, студенту недоступны.
8. XSS: текст вопросов теперь экранируется.
9. Удалён мёртвый код (assign.js, quiz.js, заглушки-страницы, .bak, вложенный zip).
Первый админ: Firebase Console -> Firestore -> users/<uid> -> role = admin.
