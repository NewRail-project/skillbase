// Заглушка core/rooms.js: закрытие брошенных комнат для тестов удаления.
export async function closeAbandonedRooms() {
  globalThis.__SB.calls.push(["closeAbandonedRooms"]);
}

// Функции записи комнат: в тесте только считаются (globalThis.__FS_WRITES) и
// падают. Нужны, чтобы тест «страница не пишет в Firestore» мог поймать вызов.
function writer(name) {
  return async () => {
    (globalThis.__FS_WRITES ||= []).push(name);
    throw new Error(`core/rooms.js: ${name} недоступен в тесте`);
  };
}
export const saveAnswer = writer("saveAnswer");
export const joinRoom = writer("joinRoom");
export const createRoom = writer("createRoom");
export const closeRoom = writer("closeRoom");
export const ensureDuelsDoc = writer("ensureDuelsDoc");
export const updateDuelsDoc = writer("updateDuelsDoc");
