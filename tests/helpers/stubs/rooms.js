// Заглушка core/rooms.js: закрытие брошенных комнат для тестов удаления.
export async function closeAbandonedRooms() {
  globalThis.__SB.calls.push(["closeAbandonedRooms"]);
}
