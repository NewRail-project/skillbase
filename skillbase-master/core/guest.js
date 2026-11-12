// Гостевое прохождение теста по прямой ссылке.
//
// Гость — тот же анонимный пользователь Firebase, что и в Live-комнатах,
// но для теста ему достаточно ФИО: аватар не нужен. ФИО хранится в
// localStorage: случайное обновление страницы и повторное открытие ссылки
// не должны снова запрашивать то же самое в идущей гостевой сессии.
//
// Правила Firestore требуют от гостевой попытки обязательное поле
// userName (строка 2–120 символов после обрезки пробелов) — это
// единственная идентификация гостя для преподавателя в результатах.

const GUEST_NAME_KEY = "sb:guestName";
const GUEST_NAME_MIN = 2;
const GUEST_NAME_MAX = 120;

// Убирает лишние пробелы, оставляя ровно один между частями ФИО.
export function normalizeGuestNameParts({ surname = "", name = "", patronymic = "" } = {}) {
  const parts = [surname, name, patronymic]
    .map(part => String(part ?? "").trim().replace(/\s+/g, " "))
    .filter(Boolean);
  return parts.join(" ");
}

export function validateGuestName(value) {
  // Принимает и готовую строку ФИО, и разбор по частям ({surname,...}).
  const trimmed = typeof value === "string"
    ? value.trim().replace(/\s+/g, " ")
    : normalizeGuestNameParts(value);
  if (!trimmed) return { ok: false, error: "Укажите фамилию и имя." };
  if (trimmed.length < GUEST_NAME_MIN) {
    return { ok: false, error: `ФИО слишком короткое (минимум ${GUEST_NAME_MIN} символа).` };
  }
  if (trimmed.length > GUEST_NAME_MAX) {
    return { ok: false, error: `ФИО слишком длинное (максимум ${GUEST_NAME_MAX} символов).` };
  }
  return { ok: true, value: trimmed };
}

// ФИО гостя из формы: фамилия и имя обязательны, отчество — нет.
// Это текстовое требование сценария: правило Firestore проверяет только
// непустую строку, разбор на фамилию/имя остаётся заботой формы.
export function validateGuestForm({ surname = "", name = "", patronymic = "" } = {}) {
  const cleanSurname = normalizeGuestNameParts({ surname });
  const cleanName = normalizeGuestNameParts({ name });
  const cleanPatronymic = normalizeGuestNameParts({ patronymic });

  if (!cleanSurname) return { ok: false, error: "Укажите фамилию." };
  if (!cleanName) return { ok: false, error: "Укажите имя." };
  if (cleanSurname.length < GUEST_NAME_MIN || cleanName.length < GUEST_NAME_MIN) {
    return { ok: false, error: "Фамилия и имя — минимум 2 символа." };
  }
  return validateGuestName({
    surname: cleanSurname,
    name: cleanName,
    patronymic: cleanPatronymic
  });
}

export function getGuestName() {
  try {
    return String(localStorage.getItem(GUEST_NAME_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function saveGuestName(fullName) {
  const check = validateGuestName(fullName);
  if (!check.ok) return false;
  try {
    localStorage.setItem(GUEST_NAME_KEY, check.value);
    return true;
  } catch {
    return false;
  }
}

export function clearGuestName() {
  try {
    localStorage.removeItem(GUEST_NAME_KEY);
  } catch {
    // localStorage недоступен — очищать нечего.
  }
}
