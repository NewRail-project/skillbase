import test from "node:test";
import assert from "node:assert/strict";
import {
  validateFullName,
  validateEmail,
  validatePassword,
  validateRegistration,
  buildRegistrationProfile,
  buildPublicProfile,
  normalizeProfileData,
  needsFullName,
  safeUi,
  DEFAULT_UI,
  VALID_UI,
  SETUP_STYLES,
  profileSetupIncomplete
} from "../core/registration.js";
import {
  DEFAULT_ORG_ID,
  DEFAULT_GROUP_ID
} from "../configs/organization.js";

test("ФИО обрезается по краям", () => {
  assert.deepEqual(validateFullName("  Иванов Иван Иванович  "), {
    ok: true,
    value: "Иванов Иван Иванович"
  });
});

test("ФИО из одних пробелов недопустимо", () => {
  for (const value of ["", "   ", "\n\t", null, undefined]) {
    const result = validateFullName(value);
    assert.equal(result.ok, false);
    assert.ok(result.error);
  }
});

test("ФИО короче 2 и длиннее 120 символов отклоняется", () => {
  assert.equal(validateFullName(" И ").ok, false);
  assert.equal(validateFullName("И".repeat(121)).ok, false);
  assert.equal(validateFullName("И".repeat(120)).ok, true);
});

test("email проверяется на пустоту и формат", () => {
  assert.equal(validateEmail("").ok, false);
  assert.equal(validateEmail("не-почта").ok, false);
  assert.deepEqual(validateEmail("  user@example.com "), { ok: true, value: "user@example.com" });
});

test("пароль короче 6 символов отклоняется", () => {
  assert.equal(validatePassword("12345").ok, false);
  assert.equal(validatePassword("123456").ok, true);
});

test("регистрация требует совпадения паролей", () => {
  const result = validateRegistration({
    fullName: "Иван Иванов",
    email: "ivan@example.com",
    password: "secret1",
    confirmPassword: "secret2"
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.confirmPassword);
  assert.equal(result.values.fullName, "Иван Иванов");
});

test("регистрация возвращает очищенные значения", () => {
  const result = validateRegistration({
    fullName: "  Иван Иванов ",
    email: " ivan@example.com ",
    password: "secret1",
    confirmPassword: "secret1"
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, {});
  assert.equal(result.values.fullName, "Иван Иванов");
  assert.equal(result.values.email, "ivan@example.com");
});

test("профиль регистрации получает организацию и группу по умолчанию", () => {
  const profile = buildRegistrationProfile({
    email: "ivan@example.com",
    fullName: " Иван Иванов ",
    ui: "operations"
  });
  assert.equal(profile.orgId, DEFAULT_ORG_ID);
  assert.equal(profile.groupId, DEFAULT_GROUP_ID);
  assert.equal(profile.fullName, "Иван Иванов");
  assert.equal(profile.email, "ivan@example.com");
  assert.equal(profile.ui, "operations");
  assert.ok(DEFAULT_ORG_ID);
  assert.ok(DEFAULT_GROUP_ID);
});

test("роль при регистрации всегда student", () => {
  const profile = buildRegistrationProfile({
    email: "ivan@example.com",
    fullName: "Иван Иванов",
    role: "admin",
    orgId: "evil-org",
    groupId: "evil-group"
  });
  assert.equal(profile.role, "student");
  assert.equal(profile.orgId, DEFAULT_ORG_ID);
  assert.equal(profile.groupId, DEFAULT_GROUP_ID);
});

test("неизвестный скин заменяется на базовый", () => {
  assert.equal(safeUi("unknown"), DEFAULT_UI);
  const profile = buildRegistrationProfile({
    email: "ivan@example.com",
    fullName: "Иван Иванов",
    ui: "unknown"
  });
  assert.equal(profile.ui, DEFAULT_UI);
});

test("необязательные должность и подразделение сохраняются без пробелов", () => {
  const profile = buildRegistrationProfile({
    email: "ivan@example.com",
    fullName: "Иван Иванов",
    position: "  Машинист ",
    department: " Депо "
  });
  assert.equal(profile.position, "Машинист");
  assert.equal(profile.department, "Депо");

  const empty = buildRegistrationProfile({ email: "ivan@example.com", fullName: "Иван Иванов" });
  assert.equal("position" in empty, false);
  assert.equal("department" in empty, false);
});

test("профиль регистрации не проходит без ФИО", () => {
  assert.throws(
    () => buildRegistrationProfile({ email: "ivan@example.com", fullName: "   " }),
    /Укажите ФИО/
  );
});

test("публичный профиль содержит имя и организацию", () => {
  assert.deepEqual(buildPublicProfile({ fullName: " Иван Иванов " }), {
    displayName: "Иван Иванов",
    orgId: DEFAULT_ORG_ID
  });
});

test("нормализация сохраняет организацию, группу и роль", () => {
  const profile = normalizeProfileData(
    { email: "ivan@example.com", role: "teacher", orgId: "org-2", groupId: "g-2", ui: "depot" },
    { uid: "u1", email: "ivan@example.com" }
  );
  assert.equal(profile.uid, "u1");
  assert.equal(profile.role, "teacher");
  assert.equal(profile.orgId, "org-2");
  assert.equal(profile.groupId, "g-2");
  assert.equal(profile.ui, "depot");
});

test("нормализация старых профилей подставляет безопасные значения", () => {
  const profile = normalizeProfileData({}, { uid: "u1", email: "old@example.com" });
  assert.equal(profile.role, "student");
  assert.equal(profile.orgId, DEFAULT_ORG_ID);
  assert.equal(profile.groupId, null);
  assert.equal(profile.ui, DEFAULT_UI);
  assert.equal(profile.email, "old@example.com");
});

test("неизвестная роль не даёт прав staff", () => {
  const profile = normalizeProfileData({ role: "superuser" }, { uid: "u1" });
  assert.equal(profile.role, "student");
});

test("нужно ли заполнить ФИО у старого аккаунта", () => {
  assert.equal(needsFullName(null), true);
  assert.equal(needsFullName({}), true);
  assert.equal(needsFullName({ fullName: "   " }), true);
  assert.equal(needsFullName({ fullName: "Иван" }), false);
});

// ---------- Google-вход: экран первоначальной настройки ----------

// Незавершённый профиль: документа нет или ФИО пустое — нужно открыть
// #setup. Гостям настройка не нужна; сетевая ошибка ≠ незавершённость
// (иначе цикл редиректов вместо честного сообщения).
test("profileSetupIncomplete: стиль гейта на экран настройки", () => {
  const ANON = true;
  assert.equal(profileSetupIncomplete("missing", null, false), true,
    "нет документа users/{uid} — показать настройку");
  assert.equal(profileSetupIncomplete("ready", { fullName: "" }, false), true,
    "документ есть, ФИО пустое — показать настройку");
  assert.equal(profileSetupIncomplete("ready", { fullName: "Иван" }, false), false,
    "готовый профиль — сразу в приложение");
  assert.equal(profileSetupIncomplete("missing", null, ANON), false,
    "гостю настройка профиля не нужна");
  assert.equal(profileSetupIncomplete("error", null, false), false,
    "сети/правила недоступны — не посылать на настройку");
});

// Стили на экране настройки — существующие скины data-ui, без дубликатов:
// иначе предпросмотр ссылался бы на несуществующую тему.
test("SETUP_STYLES: три существующих уникальных скина", () => {
  assert.equal(SETUP_STYLES.length, 3);
  const values = SETUP_STYLES.map(([v]) => v);
  assert.deepEqual(new Set(values).size, 3);
  for (const value of values) {
    assert.ok(VALID_UI.includes(value), `скин ${value} существует в theme.css`);
  }
  // Предпросмотр и живое применение обязаны быть определены для каждого
  // значения (radius/gap в setup-profile.js) — проверяем через safeUi.
  assert.equal(safeUi(values[0]), values[0]);
});
