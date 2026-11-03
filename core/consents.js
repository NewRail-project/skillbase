// Запись согласия с документами в Firestore (коллекция consents).
//
// Доказательством принятия остаются только данные в Firestore:
// localStorage (core/consent-docs.js) используется лишь как помощник
// повторных визитов той же гостевой сессии. Записи нельзя изменить
// или удалить — правила разрешают create и чтение своих записей.
import { addDoc, collection, db, serverTimestamp } from "../shared/firebase.js";
import { buildConsentFields, CONSENT_REQUIRED_KEYS } from "./consent-docs.js";

// Сохраняет факт согласия. type — один из CONSENT_TYPES.
// acceptedAt ставит сервер (serverTimestamp), поэтому дата и время
// принятия не подделываются клиентом; versions документов берутся
// из DOC_VERSIONS — того же источника, что показывают страницы.
// Возвращает true при удачной записи.
export async function saveConsent({ uid, type } = {}) {
  const check = buildConsentFields({ uid, type });
  if (!check.ok) throw new Error(check.error);
  const payload = { ...check.value, docs: { ...check.value.docs } };
  // Проверка комплектности — защита от будущих правок
  // CONSENT_REQUIRED_KEYS, при которых правила отклонят запись.
  for (const key of CONSENT_REQUIRED_KEYS) {
    if (!payload.docs[key]) throw new Error(`Не задана редакция документа ${key}.`);
  }
  await addDoc(collection(db, "consents"), {
    ...payload,
    acceptedAt: serverTimestamp()
  });
  return true;
}
