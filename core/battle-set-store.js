// core/battle-set-store.js — чтение и запись подготовленных вопросов Battle и
// ничьих (см. core/battle-set.js) в закрытый документ testKeys/{testId}__battle.
//
// Права: те же правила testKeys, что и у ключей теста — читают и пишут только
// сотрудники организации; студенту и гостю документ недоступен. Правила
// Firestore не менялись. Все функции безопасны для вызова без прав: чтение
// возвращает пустой набор, а не бросает исключение (обычный Live без Battle
// не должен зависеть от этих данных).
import { db, doc, getDoc, setDoc, serverTimestamp } from "../shared/firebase.js";
import { State, isStaff } from "./auth.js";
import {
  battleSetDocId, emptyBattleSet, normalizeBattleSet, toStoredSet, validateBattleSet
} from "./battle-set.js";

// Набор вопросов теста; пустой набор, если его нет или нет доступа.
export async function loadBattleSet(testId) {
  if (!testId || !isStaff()) return emptyBattleSet();
  try {
    const snap = await getDoc(doc(db, "testKeys", battleSetDocId(testId)));
    return snap.exists() ? normalizeBattleSet(snap.data().set) : emptyBattleSet();
  } catch (error) {
    console.warn("[Skillbase] Набор вопросов Battle не прочитан:", error?.code || error?.message || error);
    return emptyBattleSet();
  }
}

// Сохранение. Некорректный набор не записывается (ошибки возвращаются в UI).
export async function saveBattleSet(testId, set, { orgId } = {}) {
  const errors = validateBattleSet(set);
  if (errors.length) { const e = new Error(errors[0]); e.code = "validation"; e.errors = errors; throw e; }
  const uid = State?.user?.uid;
  if (!uid) throw new Error("Нужно войти в аккаунт.");
  await setDoc(doc(db, "testKeys", battleSetDocId(testId)), {
    kind: "battleSet",
    testId,
    orgId: orgId || State?.profile?.orgId,
    authorId: uid,
    set: toStoredSet(set),
    updatedAt: serverTimestamp()
  });
}

// Для удаления теста: ссылка на документ набора, если он существует.
// (Удалять несуществующий документ правила не позволяют — resource == null.)
export async function battleSetRefIfExists(testId) {
  try {
    const ref = doc(db, "testKeys", battleSetDocId(testId));
    return (await getDoc(ref)).exists() ? ref : null;
  } catch { return null; }
}
