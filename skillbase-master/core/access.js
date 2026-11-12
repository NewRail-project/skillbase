// core/access.js — чистая логика доступа к попыткам (зеркало teacherCanSee
// из firestore.rules). Не зависит от Firebase, поэтому проверяется в Node.
//
// Правило: администратор видит всё. Автор теста видит попытки по своему тесту.
// Преподаватель без поля teacherGroups видит все группы организации; с полем —
// только попытки своих групп.

export function teacherCanSeeAttempt(attempt, profile, uid = null) {
  if (!profile) return false;
  if (profile.role === "admin") return true;
  if (profile.role !== "teacher") return false;
  if (uid && attempt?.testAuthorId === uid) return true;
  const groups = profile.teacherGroups;
  if (groups === undefined || groups === null) return true;
  return Array.isArray(groups) && groups.includes(attempt?.groupId);
}
