// Работа с ролями через Firestore. Использует существующие users/{uid}.role,
// организации и группы; отдельной коллекции администраторов нет.

import {
  db, collection, doc, getDocs, query, where, updateDoc, serverTimestamp
} from "../shared/firebase.js";
import { ALL_ROLES } from "./admin-roles.js";

// Список пользователей организации. Правила Firestore разрешают сотруднику
// читать профили только своей организации, поэтому запрос всегда с orgId.
export async function listOrgUsers(orgId) {
  if (!orgId) return [];
  const snapshot = await getDocs(query(
    collection(db, "users"),
    where("orgId", "==", orgId)
  ));
  return snapshot.docs.map(item => ({ ...item.data(), uid: item.id }));
}

// Меняет только роль и updatedAt. Роль проверяется правилами: администратор
// может менять её только пользователям своей организации и не себе.
export async function setUserRole(uid, role) {
  if (!uid) throw new Error("Не указан пользователь.");
  if (!ALL_ROLES.includes(role)) throw new Error("Неизвестная роль.");
  await updateDoc(doc(db, "users", uid), {
    role,
    updatedAt: serverTimestamp()
  });
}
