// Идентификаторы по умолчанию для самостоятельной регистрации.
//
// Это единственный источник значений для клиента. Они должны совпадать с
// константами в firestore.rules:
//   - orgId  — 'default-org'
//   - groupId — 'default-group'
//
// Если меняете значения, обновите firestore.rules и docs/FIREBASE_SETUP.md,
// иначе правило create для users/{uid} отклонит регистрацию.
//
// Сами документы organizations/{id} и groups/{id} не обязательны для работы
// приложения: оно хранит только строковые идентификаторы. Их можно создать
// в Firebase Console как справочник (см. docs/FIREBASE_SETUP.md).

export const DEFAULT_ORG_ID = "default-org";
export const DEFAULT_ORG_TITLE = "Skillbase";

export const DEFAULT_GROUP_ID = "default-group";
export const DEFAULT_GROUP_TITLE = "Общая группа";
