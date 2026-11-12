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
    // ---------- Вход через Google ----------
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Окно Google было закрыто. Нажмите кнопку ещё раз.';
    case 'auth/popup-blocked':
      return 'Браузер заблокировал окно Google. Повторите попытку — откроется экран входа.';
    case 'auth/account-exists-with-different-credential':
      return 'Аккаунт с этим email уже существует. Войдите по паролю — Google привяжется к нему автоматически.';
    case 'auth/unauthorized-domain':
      return 'Домен этого сайта не разрешён в настройках Firebase (Authentication → Settings → Authorized domains).';
    case 'auth/operation-not-allowed':
      return 'Вход через Google выключен в настройках проекта (Firebase Console → Authentication → Sign-in method).';
    case 'permission-denied':
      return 'Нет прав для выполнения операции.';
    default:
      return 'Что-то пошло не так. Попробуйте ещё раз.';
  }
}