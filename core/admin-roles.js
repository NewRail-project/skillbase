// Чистая логика управления администраторами.
//
// Не импортирует Firebase: проверки можно тестировать в Node. Роли остаются
// прежними (student | teacher | admin) и живут в users/{uid}.role — отдельной
// системы ролей нет.
//
// Область действия роли — организация: администратор может менять роли только
// пользователям своей организации. Это же проверяют firestore.rules.

export const ADMIN_ROLE = "admin";
export const STAFF_ROLES = ["teacher", "admin"];
export const ALL_ROLES = ["student", "teacher", "admin"];

export const ROLE_LABELS = {
  student: "Студент",
  teacher: "Преподаватель",
  admin: "Администратор"
};

// Роль, которая остаётся после снятия административных прав.
// По умолчанию — преподаватель; администратор может выбрать студента.
export const REVOKE_ROLES = ["teacher", "student"];

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function isSameOrg(actor, target) {
  return Boolean(actor?.orgId) && actor.orgId === target?.orgId;
}

export function countAdmins(users = [], orgId) {
  return users.filter(user =>
    user?.role === ADMIN_ROLE && (!orgId || user.orgId === orgId)
  ).length;
}

// Поиск только по точному email (без учёта регистра и пробелов).
// Пользователи других организаций в список не попадают: их отсекает запрос.
export function findUserByEmail(users = [], email) {
  const needle = normalizeEmail(email);
  if (!needle) return null;
  return users.find(user => normalizeEmail(user.email) === needle) || null;
}

function baseCheck(actor, target) {
  if (!actor || actor.role !== ADMIN_ROLE) {
    return { ok: false, code: "not_admin", error: "Только администратор может менять роли." };
  }
  if (!target) {
    return { ok: false, code: "not_found", error: "Пользователь не найден." };
  }
  if (!isSameOrg(actor, target)) {
    return { ok: false, code: "other_org", error: "Пользователь из другой организации." };
  }
  return null;
}

export function canAssignAdmin({ actor, target, users = [] } = {}) {
  const base = baseCheck(actor, target);
  if (base) return base;

  if (target.role === ADMIN_ROLE) {
    return { ok: false, code: "already_admin", error: "Пользователь уже администратор." };
  }

  return { ok: true, code: "ok" };
}

export function canRevokeAdmin({ actor, target, users = [] } = {}) {
  const base = baseCheck(actor, target);
  if (base) return base;

  if (target.role !== ADMIN_ROLE) {
    return { ok: false, code: "not_admin_target", error: "Пользователь не администратор." };
  }

  // Правила Firestore запрещают менять собственную роль. Это же правило
  // гарантирует, что последний администратор не снимет права сам себе.
  if (actor.uid && target.uid && actor.uid === target.uid) {
    return {
      ok: false,
      code: "self",
      error: "Нельзя снять роль администратора с себя. Это защищает организацию от потери последнего администратора."
    };
  }

  if (countAdmins(users, actor.orgId) <= 1) {
    return {
      ok: false,
      code: "last_admin",
      error: "Это последний администратор организации — снять роль нельзя."
    };
  }

  return { ok: true, code: "ok" };
}

export function roleAfterRevoke(choice) {
  return REVOKE_ROLES.includes(choice) ? choice : "teacher";
}
