// core/test-delete-logic.js — чистая логика удаления теста.
// Не зависит от Firebase: решения о правах и план очистки проверяются
// в Node (tests/test-delete.test.js), как assignment-logic.js.

// Статус мягкого удаления: документ tests остаётся в Firestore ради
// попыток, истории и аналитики, но исчезает из каталога и страницы
// «Мои тесты» (см. listMyTests / listPublishedTests).
export const DELETED_STATUS = "deleted";

// Кто имеет право удалить тест: автор или администратор его организации.
// Такое же ограничение дублируется в firestore.rules (update tests).
export function canDeleteTest(test, session = {}) {
  const uid = session?.uid || "";
  const role = session?.role || "";
  const orgId = session?.orgId || "";

  if (!uid) {
    return { allowed: false, reason: "Нужно войти в аккаунт." };
  }
  if (!test || !test.id) {
    return { allowed: false, reason: "Тест не выбран." };
  }
  if (role !== "teacher" && role !== "admin") {
    return {
      allowed: false,
      reason: "Удалять тесты могут только преподаватели и администраторы."
    };
  }
  const sameOrg = Boolean(test.orgId) && test.orgId === orgId;
  const isAuthor = test.authorId === uid;

  if (isAuthor && (sameOrg || !test.orgId)) {
    return { allowed: true };
  }
  if (role === "admin" && sameOrg) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: isAuthor
      ? "Удалять тесты можно только в своей организации."
      : "Удалить можно только свой тест или тест своей организации."
  };
}

// План очистки связанных документов: какие активные задания закрыть,
// какие открытые Live-комнаты закрыть (и какие закрыть не удастся).
// Правила Firestore: закрыть задание может его преподаватель или админ
// организации; закрыть комнату — только её ведущий.
export function deletionPlan({ test, session = {}, assignments = [], rooms = [] }) {
  const uid = session?.uid || "";
  const isAdmin = session?.role === "admin";
  const openAssignments = (assignments || []).filter(a =>
    a && a.testId === test.id && (a.status === "active" || !a.status));
  const activeRooms = (rooms || []).filter(r =>
    r && r.testId === test.id && r.status !== "closed");

  return {
    closeAssignmentIds: openAssignments
      .filter(a => isAdmin || a.teacherId === uid)
      .map(a => a.id),
    // Задания другого преподавателя: без прав админа закрыть нельзя.
    foreignAssignmentIds: openAssignments
      .filter(a => !isAdmin && a.teacherId !== uid)
      .map(a => a.id),
    closeRoomCodes: activeRooms
      .filter(r => r.hostId === uid)
      .map(r => r.code || r.id),
    // Комнаты чужих ведущих: правила разрешают закрытие только ведущему.
    foreignRooms: activeRooms
      .filter(r => r.hostId !== uid)
      .map(r => ({ code: r.code || r.id, hostName: r.hostName || "" }))
  };
}

// Настройки теста после удаления: доступ студента к ключам по настройке
// showCorrectAfterQuestion закрывается (настройка и так требует активной
// попытки, но при удалении теста не оставляем даже теоретический доступ).
export function sanitizedSettingsAfterDelete(settings) {
  return { ...(settings && typeof settings === "object" ? settings : {}), showCorrectAfterQuestion: false };
}

// Понятное объяснение ошибки удаления для тоста: не скрываем причину.
// Разбираем и код ошибки, и текст сообщения: SDK иногда отдаёт код
// только внутри message (например "_firestore/FAILED_PRECONDITION").
export function explainDeleteError(err) {
  const code = err && err.code;
  const message = typeof err?.message === "string" ? err.message.toLowerCase() : "";

  if (code === "permission-denied" || message.includes("permission_denied")) {
    return "Правила Firestore не разрешают удаление этого теста. Удалять может только автор или администратор организации.";
  }
  if (code === "unavailable" || code === "offline" || message.includes("unavailable")) {
    return "Нет связи с Firestore. Тест не удалён — попробуйте ещё раз.";
  }
  if (
    typeof navigator !== "undefined" && navigator.onLine === false
  ) {
    return "Нет подключения к интернету. Тест не удалён.";
  }
  if (code === "failed-precondition" || message.includes("failed_precondition")) {
    return "Firestore отклонил запрос: правила или индексы изменились. Обновите страницу.";
  }
  if (code === "aborted" || code === "deadline-exceeded" || message.includes("deadline_exceeded")) {
    return "Сеть заняла слишком много времени. Попробуйте удалить тест ещё раз.";
  }
  return (err && err.message) || "Не удалось удалить тест.";
}
