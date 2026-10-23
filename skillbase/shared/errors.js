export function authErrorMessage(err) {
  const code = err.code || err.message;
  switch (code) {
    case 'auth/invalid-email':
      return 'Некорректный email.';
    case 'auth/weak-password':
      return 'Пароль слишком слабый. Минимальная длина: 6 символов.';
    case 'auth/email-already-in-use':
      return 'Этот email уже зарегистрирован.';
    case 'auth/invalid-credential':
      return 'Неверные учетные данные.';
    case 'auth/user-not-found':
      return 'Пользователь не найден.';
    case 'auth/wrong-password':
      return 'Неверный пароль.';
    case 'auth/too-many-requests':
      return 'Слишком много попыток. Попробуйте позже.';
    case 'auth/network-request-failed':
      return 'Нет подключения к интернету. Проверьте соединение.';
    case 'auth/api-key-not-valid':
      return 'Ошибка конфигурации Firebase. Проверьте настройки.';
    case 'permission-denied':
      return 'Нет прав для выполнения операции.';
    default:
      return 'Что-то пошло не так. Попробуйте ещё раз.';
  }
}