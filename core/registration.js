// Чистые правила регистрации и профиля.
//
// Модуль намеренно не импортирует Firebase: его можно тестировать в Node
// (tests/registration.test.js), а auth.js и страницы используют как единый
// источник проверок. Ничего не пишет в Firestore.

import {
  DEFAULT_ORG_ID,
  DEFAULT_GROUP_ID
} from "../configs/organization.js";

export const FULL_NAME_MIN = 2;
export const FULL_NAME_MAX = 120;
export const PASSWORD_MIN = 6;

export const DEFAULT_UI = "education";
export const VALID_UI = ["education", "operations", "depot"];
export const VALID_ROLES = ["student", "teacher", "admin"];

export function safeUi(value) {
  return VALID_UI.includes(value) ? value : DEFAULT_UI;
}

// ФИО: обрезаем пробелы по краям, пустое значение недопустимо.
export function validateFullName(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return { ok: false, error: "Укажите ФИО" };
  if (trimmed.length < FULL_NAME_MIN) {
    return { ok: false, error: `ФИО слишком короткое (минимум ${FULL_NAME_MIN} символа)` };
  }
  if (trimmed.length > FULL_NAME_MAX) {
    return { ok: false, error: `ФИО слишком длинное (максимум ${FULL_NAME_MAX} символов)` };
  }
  return { ok: true, value: trimmed };
}

export function validateEmail(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return { ok: false, error: "Укажите email" };
  // Достаточно грубая проверка: точный формат всё равно проверит Firebase Auth.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: "Некорректный email" };
  }
  return { ok: true, value: trimmed };
}

export function validatePassword(value) {
  const password = String(value ?? "");
  if (!password) return { ok: false, error: "Укажите пароль" };
  if (password.length < PASSWORD_MIN) {
    return { ok: false, error: `Пароль должен быть не короче ${PASSWORD_MIN} символов` };
  }
  return { ok: true, value: password };
}

// Проверка всей формы регистрации. Возвращает ошибки по полям, чтобы страница
// показала их рядом с inputs, и очищенные значения.
export function validateRegistration({ fullName, email, password, confirmPassword } = {}) {
  const errors = {};
  const values = {};

  const name = validateFullName(fullName);
  if (!name.ok) errors.fullName = name.error;
  else values.fullName = name.value;

  const mail = validateEmail(email);
  if (!mail.ok) errors.email = mail.error;
  else values.email = mail.value;

  const pass = validatePassword(password);
  if (!pass.ok) errors.password = pass.error;
  else values.password = pass.value;

  if (!errors.password && password !== confirmPassword) {
    errors.confirmPassword = "Пароли не совпадают";
  }

  return { ok: Object.keys(errors).length === 0, errors, values };
}

// Документ users/{uid} для самостоятельной регистрации.
// Роль всегда student: клиент не может назначить себе staff-роль.
// Организация и группа берутся из конфигурации проекта.
export function buildRegistrationProfile({
  email,
  fullName,
  position,
  department,
  ui
} = {}) {
  const name = validateFullName(fullName);
  if (!name.ok) throw new Error(name.error);

  const mail = validateEmail(email);
  if (!mail.ok) throw new Error(mail.error);

  const profile = {
    email: mail.value,
    role: "student",
    orgId: DEFAULT_ORG_ID,
    groupId: DEFAULT_GROUP_ID,
    fullName: name.value,
    ui: safeUi(ui)
  };

  const pos = String(position ?? "").trim();
  if (pos) profile.position = pos.slice(0, FULL_NAME_MAX);
  const dep = String(department ?? "").trim();
  if (dep) profile.department = dep.slice(0, FULL_NAME_MAX);

  return profile;
}

// Публичная часть профиля (publicProfiles/{uid}) — имя для журнала,
// проверки и списков участников. Аватар сюда не входит.
export function buildPublicProfile({ fullName, orgId = DEFAULT_ORG_ID } = {}) {
  const name = validateFullName(fullName);
  if (!name.ok) throw new Error(name.error);
  return { displayName: name.value, orgId: orgId || DEFAULT_ORG_ID };
}

// Приводит документ users/{uid} к виду, с которым работает интерфейс.
export function normalizeProfileData(data, user) {
  const src = data || {};
  return {
    ...src,
    uid: user.uid,
    email: src.email || user.email || "",
    role: VALID_ROLES.includes(src.role) ? src.role : "student",
    orgId: src.orgId || DEFAULT_ORG_ID,
    groupId: src.groupId || null,
    ui: safeUi(src.ui)
  };
}

// Старые аккаунты могли быть созданы без ФИО — им нужно предложить заполнить
// поле, но не создавать новую учётную запись.
export function needsFullName(profile) {
  return !profile || !String(profile.fullName || "").trim();
}
