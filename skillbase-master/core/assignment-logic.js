// core/assignment-logic.js — чистая логика обучающих заданий и проверки
// знаний: бейджи, состояния, срочность, видимость для студента.
// Без DOM и Firebase, чтобы проверяться юнит-тестами в Node.

export const KIND_EXAM = "exam";
export const KIND_TRAINING = "training";
export const ASSIGNMENT_KINDS = [KIND_EXAM, KIND_TRAINING];

const DAY_MS = 86_400_000;

function toMs(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

// kind: "Обучение" | "Проверка" для бейджа.
export function assignmentKind(assignment) {
  const kind = String(assignment?.kind || "").trim();
  return ASSIGNMENT_KINDS.includes(kind) ? kind : KIND_EXAM;
}

export function assignmentKindLabel(assignment) {
  return assignmentKind(assignment) === KIND_TRAINING ? "Обучение" : "Проверка";
}

export function assignmentBadgeClass(assignment) {
  return assignmentKind(assignment) === KIND_TRAINING
    ? "badge badge-info"
    : "badge badge-warning";
}

// Видима студенту: startAt == null (нет расписания) или уже прошла.
export function isAssignmentVisible(assignment, now = Date.now()) {
  const startAt = toMs(assignment?.startAt);
  return startAt === null || now >= startAt;
}

// Состояние задания для списка.
// - done: по нему есть отправленная или проверенная попытка этого студента.
// - overdue: срок прошёл, а попытки нет.
// - dueToday: срок сегодня или меньше, чем через сутки.
// - open: обычное активное задание.
// - scheduled: startAt в будущем (студенту ещё не видно).
export function assignmentState(assignment, attempts, now = Date.now()) {
  const startAt = toMs(assignment?.startAt);
  if (startAt !== null && now < startAt) return "scheduled";

  const mine = (attempts || []).filter(a =>
    a.assignmentId && a.assignmentId === assignment.id
      && (a.status === "submitted" || a.status === "graded")
  );
  if (mine.length) return "done";

  const deadlineMs = toMs(assignment?.deadline);
  if (deadlineMs !== null && now > deadlineMs) return "overdue";
  if (deadlineMs !== null && deadlineMs - now < DAY_MS) return "dueToday";
  return "open";
}

export const STATE_LABEL = {
  scheduled: "Запланировано",
  done: "Выполнено",
  overdue: "Просрочено",
  dueToday: "Срок сегодня",
  open: "Доступно"
};

export const STATE_BADGE = {
  scheduled: "badge badge-neutral",
  done: "badge badge-success",
  overdue: "badge badge-danger",
  dueToday: "badge badge-warning",
  open: "badge badge-neutral"
};

// Порядок.dot для строки списка.
export const STATE_DOT = {
  scheduled: "muted",
  done: "ok",
  overdue: "warn",
  dueToday: "warn",
  open: "ok"
};

// Сортировка по срочности: просроченные первыми (давно просроченные
// сверху), затем срок сегодня, затем по ближайшему сроку, задания без
// срока и запланированные — в конце.
export function sortAssignments(assignments, attempts, now = Date.now()) {
  const weight = { scheduled: 4, open: 3, dueToday: 1, overdue: 0, done: 2 };
  return [...(assignments || [])].sort((a, b) => {
    const wa = weight[assignmentState(a, attempts, now)];
    const wb = weight[assignmentState(b, attempts, now)];
    if (wa !== wb) return wa - wb;
    const da = toMs(a?.deadline) ?? Infinity;
    const db = toMs(b?.deadline) ?? Infinity;
    if (da !== db) return da - db;
    return String(a?.title || a?.testTitle || "").localeCompare(
      String(b?.title || b?.testTitle || ""),
      "ru"
    );
  });
}

// Валидация задания перед записью (чистая; вызывается до addDoc).
export function validateAssignmentDraft({
  kind, deadline = null, note = "",
  materialText = "", materialUrl = ""
} = {}) {
  const errors = {};

  const kindValue = String(kind || "").trim();
  if (!ASSIGNMENT_KINDS.includes(kindValue)) {
    errors.kind = "Неизвестный тип задания.";
  }

  const noteValue = String(note ?? "");
  if (noteValue.length > 200) {
    errors.note = "Заметка не длиннее 200 символов.";
  }

  const textValue = String(materialText ?? "");
  if (textValue.length > 6000) {
    errors.materialText = "Материал не длиннее 6000 символов.";
  }

  const urlValue = String(materialUrl ?? "").trim();
  if (urlValue.length > 0) {
    if (urlValue.length > 500) {
      errors.materialUrl = "Ссылка не длиннее 500 символов.";
    } else if (!urlValue.startsWith("https://")) {
      errors.materialUrl = "Ссылка должна начинаться с https://";
    }
  }

  const deadlineValue = toMs(deadline);
  if (kindValue === KIND_TRAINING && deadlineValue === null) {
    errors.deadline = "Для обучающего задания укажите срок.";
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    values: {
      kind: kindValue,
      note: noteValue.slice(0, 200),
      materialText: textValue.slice(0, 6000),
      materialUrl: urlValue.slice(0, 500)
    }
  };
}

// Относительная подпись срока: «просрочено», «осталось N дн.» и т.д.
export function deadlineSubtitle(deadline, now = Date.now()) {
  const deadlineMs = toMs(deadline);
  if (deadlineMs === null) return "Срок не указан";
  const leftMs = deadlineMs - now;
  if (leftMs < 0) {
    const days = Math.floor(-leftMs / DAY_MS);
    return `просрочено${days > 0 ? ` ${days} дн. назад` : ""}`;
  }
  const days = Math.ceil(leftMs / DAY_MS);
  if (days <= 1) return "срок сегодня";
  return `осталось ${days} дн.`;
}
