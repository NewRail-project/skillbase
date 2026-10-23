export function authErrorMessage(err) {
  const code = (err && (err.code || err.message)) || 'unknown';
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
    case 'auth/operation-not-allowed':
      return 'В Firebase не включён вход по Email/Password (Authentication → Sign-in method).';
    case 'auth/unauthorized-domain':
      return 'Домен сайта не добавлен в Firebase (Authentication → Settings → Authorized domains).';
    case 'auth/invalid-api-key':
      return 'Неверный apiKey в configs/firebase.js.';
    case 'auth/user-disabled':
      return 'Аккаунт отключён.';
    case 'unavailable':
      return 'Сервер недоступен. Проверьте интернет.';
    case 'permission-denied':
      return 'Нет прав для выполнения операции.';
    default:
      return `Что-то пошло не так (${code}). Попробуйте ещё раз.`;
  }
}