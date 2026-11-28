// core/lesson-plan.js — сценарий занятия: план, этапы и переходы между ними.
// Чистый модуль без DOM и Firebase.
//
// Занятие = связка уже существующих механизмов:
//   материал → входной тест (Live) → Battle → практика (таблицы) → итоговый тест (Live) → отчёт.
// План (с ключами практики) хранится в закрытом документе для сотрудников
// (core/lesson-store.js); ход занятия — поле `lesson` документа входной комнаты.
import { normalizeTask, validateTask, emptyTask, TEAMS, encodeTask } from "./practical.js";
import { sanitizeBattlePreset, DEFAULT_BATTLE_SETTINGS } from "./battle-logic.js";
import { validateTest } from "./test-schema.js";

export const PLAN_VERSION = 1;
export const STAGES = Object.freeze(["material", "entry_test", "battle", "practical", "reinforcement", "final_test", "report"]);
export const STAGE_LABEL = Object.freeze({
  material: "Теоретический материал",
  entry_test: "Входной тест",
  battle: "Battle двух команд",
  practical: "Практическая диагностика",
  reinforcement: "Закрепление материала",
  final_test: "Итоговый тест",
  report: "Итоговый отчёт"
});
// Этапы, которые можно отключить в плане (отчёт есть всегда).
export const OPTIONAL_STAGES = Object.freeze(["material", "entry_test", "battle", "practical", "reinforcement", "final_test"]);
// Стандартные значения включения этапов: старые планы без поля получают значения из константы.
export const DEFAULT_STAGE_ON = Object.freeze({
  material: true, entry_test: true, battle: true, practical: true, reinforcement: false, final_test: true, report: true
});

export const DEFAULT_GRADING = Object.freeze({
  // Веса компонентов рекомендуемой оценки (используются только имеющиеся данные).
  weights: Object.freeze({ entry: 20, battle: 25, practical: 15, final: 40 }),
  // Пороги перевода процента в пятибалльную оценку.
  thresholds: Object.freeze({ five: 85, four: 70, three: 50 })
});

const clip = (v, n) => String(v ?? "").trim().slice(0, n);

export function emptyPlan() {
  return {
    version: PLAN_VERSION,
    topic: "", subjectName: "",
    materialId: "", materialTitle: "",
    entryTestId: "", entryTestTitle: "",
    finalTestId: "", finalTestTitle: "",
    stages: { ...DEFAULT_STAGE_ON },
    // Параметры Battle (как на экране запуска Live): набор вопросов (пусто — вопросы
    // входного теста), число вопросов и время на вопрос.
    battle: { battleTestId: "", questionCount: DEFAULT_BATTLE_SETTINGS.questionCount, questionSeconds: DEFAULT_BATTLE_SETTINGS.questionSeconds },
    tasks: { a: emptyTask(), b: emptyTask() },
    reinforcement: { questions: [] },
    grading: { weights: { ...DEFAULT_GRADING.weights }, thresholds: { ...DEFAULT_GRADING.thresholds } }
  };
}

export function normalizePlan(raw) {
  const base = emptyPlan();
  if (!raw || typeof raw !== "object") return base;
  const stages = {};
  for (const s of OPTIONAL_STAGES) stages[s] = raw.stages?.[s] === undefined ? DEFAULT_STAGE_ON[s] : raw.stages[s] === true;
  const w = raw.grading?.weights || {};
  const th = raw.grading?.thresholds || {};
  const weight = (k) => (Number.isFinite(Number(w[k])) && Number(w[k]) >= 0 ? Number(w[k]) : DEFAULT_GRADING.weights[k]);
  const thr = (k) => (Number.isFinite(Number(th[k])) ? Math.min(100, Math.max(0, Number(th[k]))) : DEFAULT_GRADING.thresholds[k]);
  return {
    version: PLAN_VERSION,
    topic: clip(raw.topic, 160), subjectName: clip(raw.subjectName, 120),
    materialId: clip(raw.materialId, 120), materialTitle: clip(raw.materialTitle, 160),
    entryTestId: clip(raw.entryTestId, 120), entryTestTitle: clip(raw.entryTestTitle, 160),
    finalTestId: clip(raw.finalTestId, 120), finalTestTitle: clip(raw.finalTestTitle, 160),
    stages,
    reinforcement: { questions: normalizeReinforcementQuestions(raw.reinforcement?.questions) },
    battle: { battleTestId: "", ...sanitizeBattlePreset(raw.battle || {}) },
    tasks: { a: normalizeTask(raw.tasks?.a), b: normalizeTask(raw.tasks?.b) },
    grading: {
      weights: { entry: weight("entry"), battle: weight("battle"), practical: weight("practical"), final: weight("final") },
      thresholds: { five: thr("five"), four: thr("four"), three: thr("three") }
    }
  };
}

const MAX_REINFORCEMENT_QUESTIONS = 200;

function normalizeReinforcementQuestions(raw) {
  if (!Array.isArray(raw)) return [];
  const result = [];
  for (const q of raw) {
    if (typeof q !== "object" || q === null) continue;
    const question = { ...q };
    // type
    if (question.type && typeof question.type === "string" && /^single|multiple|short$/.test(question.type)) {
      question.type = question.type;
    } else {
      question.type = "single";
    }
    // text → string, trim to 2000
    question.text = String(question.text ?? "").trim().slice(0, 2000);
    // options
    if (Array.isArray(question.options)) {
      question.options = question.options
        .map(o => typeof o === "object" && o !== null ? { text: String(o.text ?? "").trim().slice(0, 500), correct: !!o.correct } : { text: "", correct: false })
        .filter(o => o.text !== "");
    } else {
      question.options = [];
    }
    // points
    question.points = Number.isFinite(question.points) && question.points > 0 && question.points <= 100 ? Number(question.points) : 1;
    // answer (for short type)
    if (question.type === "short") {
      if (typeof question.answer === "string") {
        question.answer = question.answer.trim().slice(0, 1000);
      } else if (Array.isArray(question.answer)) {
        question.answer = question.answer.map(a => String(a ?? "").trim().slice(0, 1000)).filter(a => a !== "");
      } else {
        delete question.answer;
      }
    } else {
      delete question.answer;
    }
    // explanation
    question.explanation = String(question.explanation ?? "").trim().slice(0, 2000);
    if (question.explanation === "") delete question.explanation;
    // remove lineNumber if present
    delete question.lineNumber;
    result.push(question);
  }
  // trim to MAX_REINFORCEMENT_QUESTIONS
  return result.slice(0, MAX_REINFORCEMENT_QUESTIONS);
}

// Ошибки подготовки (русские фразы для редактора).
export function validatePlan(plan) {
  const p = plan || {};
  const on = (s) => p.stages?.[s] === true;
  const errors = [];
  if (!String(p.topic || "").trim()) errors.push("Укажите тему занятия.");
  if (on("material") && !p.materialId) errors.push("Выберите теоретический материал или отключите этот этап.");
  if (on("entry_test") && !p.entryTestId) errors.push("Выберите входной тест или отключите этот этап.");
  if (on("final_test") && !p.finalTestId) errors.push("Выберите итоговый тест или отключите этот этап.");
  if (on("battle") && !on("entry_test")) errors.push("Battle запускается из Live-комнаты входного теста: включите входной тест.");
  if (on("practical") && !on("battle")) errors.push("Практика проводится по командам из Battle: включите Battle или отключите практику.");
  if (on("practical")) for (const team of TEAMS) errors.push(...validateTask(p.tasks?.[team], { team }));
  if (on("reinforcement")) {
    const questions = p.reinforcement?.questions || [];
    if (!questions.length) {
      errors.push("Добавьте вопросы закрепления или отключите этот этап.");
    } else {
      const { errors: vErrors } = validateTest(
        { title: "Закрепление материала", questions, requireMaterial: false },
        { publishing: true }
      );
      for (const e of vErrors) {
        if (!errors.some(f => f === e)) errors.push(e);
      }
    }
  }
  const w = p.grading?.weights || {};
  if (!Object.values(w).some(v => Number(v) > 0)) errors.push("Хотя бы один вес оценки должен быть больше нуля.");
  const t = p.grading?.thresholds || {};
  if (!(t.five > t.four && t.four > t.three)) errors.push("Пороги оценок должны убывать: «5» > «4» > «3».");
  return errors;
}

// Этапы по порядку: только включённые + отчёт.
export function enabledStages(plan) {
  return [...OPTIONAL_STAGES.filter(s => plan?.stages?.[s] === true), "report"];
}

// ---------- Ход занятия ----------

export function newRun(plan, { id, nowMs = Date.now() } = {}) {
  const stages = enabledStages(plan);
  return {
    id: String(id || ""), stage: stages[0], startedAt: nowMs,
    done: {}, skipped: {}, finalRoomCode: "",
    reinforcementRoomCode: "",
    // Копия флагов этапов и метаданных: ход занятия живёт в документе комнаты,
    // и переходы не должны зависеть от чтения закрытого плана.
    stages: { ...(plan?.stages || {}) },
    topic: String(plan?.topic || ""), materialId: String(plan?.materialId || ""),
    materialTitle: String(plan?.materialTitle || ""), planId: "",
    // Снимок настроек оценки и названий на момент запуска: отчёт строится по
    // нему, и правка сценария во время или после занятия итог не меняет.
    subjectName: String(plan?.subjectName || ""),
    entryTestTitle: String(plan?.entryTestTitle || ""), finalTestTitle: String(plan?.finalTestTitle || ""),
    grading: JSON.parse(JSON.stringify(plan?.grading || DEFAULT_GRADING))
  };
}

// Настройки занятия, восстановленные только из состояния хода (без чтения плана).
export const reportPlanOfRun = (run) => normalizePlan({
  topic: run?.topic, subjectName: run?.subjectName, materialId: run?.materialId, materialTitle: run?.materialTitle,
  entryTestTitle: run?.entryTestTitle, finalTestTitle: run?.finalTestTitle,
  stages: run?.stages, grading: run?.grading
});

// «План» из состояния хода: достаточно для enabledStages/advance/completion.
export const planOfRun = (run) => ({ stages: run?.stages || {} });

const nextOf = (run, plan) => {
  const stages = enabledStages(plan);
  const i = stages.indexOf(run.stage);
  return i >= 0 && i < stages.length - 1 ? stages[i + 1] : null;
};

// Условия завершения этапа. ctx — факты, которые знает страница ведущего:
// { entryCompleted, battleFinished, practicalConfirmed, reinforcementCompleted, finalCompleted }.
const GUARDS = {
  material: () => ({ ok: true }),
  entry_test: (ctx) => ctx.entryCompleted ? { ok: true } : { ok: false, reason: "Входной тест ещё не завершён: завершите его в комнате." },
  battle: (ctx) => ctx.battleFinished ? { ok: true } : { ok: false, reason: "Battle ещё не завершена." },
  practical: (ctx) => ctx.practicalConfirmed ? { ok: true } : { ok: false, reason: "Результат практики ещё не подтверждён преподавателем." },
  reinforcement: (ctx) => ctx.reinforcementCompleted
    ? { ok: true }
    : { ok: false, reason: ctx.reinforcementRoomCode
      ? "Тест закрепления ещё не завершён участниками."
      : "Создайте комнату закрепления: участники проходят его как обычный тест." },
  final_test: (ctx) => ctx.finalCompleted ? { ok: true } : { ok: false, reason: "Итоговый тест ещё не завершён." },
  report: () => ({ ok: false, reason: "Занятие уже на последнем этапе." })
};

export function canAdvance(run, plan, ctx = {}) {
  if (!run || !run.stage) return { ok: false, reason: "Занятие не запущено." };
  if (run.stage === "report") return { ok: false, reason: "Занятие уже завершено." };
  if (run.done?.[run.stage] || run.skipped?.[run.stage]) return { ok: false, reason: "Этот этап уже завершён." };
  return GUARDS[run.stage](ctx);
}

function moveForward(run, plan, kind, nowMs, reason) {
  const marked = { ...run, [kind]: { ...(run[kind] || {}), [run.stage]: nowMs } };
  if (reason) marked.skipReasons = { ...(run.skipReasons || {}), [run.stage]: String(reason).slice(0, 200) };
  let target = nextOf(run, plan);
  // Практике нужны команды из Battle: если Battle пропущена — практика недоступна.
  if (target === "practical" && (marked.skipped?.battle || !plan?.stages?.battle)) {
    marked.skipped = { ...(marked.skipped || {}), practical: nowMs };
    marked.skipReasons = { ...(marked.skipReasons || {}), practical: "Нет команд: Battle не проводилась." };
    const after = enabledStages(plan);
    target = after[after.indexOf("practical") + 1] || "report";
  }
  return { ...marked, stage: target };
}

// Завершить текущий этап и перейти к следующему. Повторный вызов для уже
// завершённого этапа бросает ошибку — двойной клик ничего не ломает.
export function advance(run, plan, ctx = {}, nowMs = Date.now()) {
  const check = canAdvance(run, plan, ctx);
  if (!check.ok) { const e = new Error(check.reason); e.code = "blocked"; throw e; }
  return moveForward(run, plan, "done", nowMs);
}

// Преподаватель сознательно пропускает этап. Пропуск виден в отчёте и не
// превращается в нулевой результат участников.
export function skipStage(run, plan, { nowMs = Date.now(), reason = "" } = {}) {
  if (!run?.stage || run.stage === "report") { const e = new Error("Этот этап пропустить нельзя."); e.code = "blocked"; throw e; }
  if (run.done?.[run.stage] || run.skipped?.[run.stage]) { const e = new Error("Этот этап уже завершён."); e.code = "blocked"; throw e; }
  return moveForward(run, plan, "skipped", nowMs, reason);
}

// Статусы этапов для панели преподавателя.
export function stageStatuses(run, plan) {
  const planned = new Set(enabledStages(plan));
  const current = run?.stage;
  const upcoming = nextOf(run || {}, plan);
  return STAGES.map(stage => {
    let status;
    if (!planned.has(stage)) status = "off";
    else if (run?.done?.[stage]) status = "done";
    else if (run?.skipped?.[stage]) status = "skipped";
    else if (stage === current) status = "current";
    else if (stage === upcoming) status = "next";
    else status = "upcoming";
    return { stage, label: STAGE_LABEL[stage], status };
  });
}

// Выполнение занятия: доля завершённых этапов от запланированных (без отчёта).
// Пропущенные этапы остаются в знаменателе, отключённые — нет.
export function completion(run, plan) {
  const planned = enabledStages(plan).filter(s => s !== "report");
  if (!planned.length) return { percent: 0, done: 0, skipped: 0, planned: 0 };
  const done = planned.filter(s => run?.done?.[s]).length;
  const skipped = planned.filter(s => run?.skipped?.[s]).length;
  return { percent: Math.round((done / planned.length) * 100), done, skipped, planned: planned.length };
}

// ---------- Кодирование плана для Firestore ----------
// Firestore не принимает массив внутри массива (строки таблицы — массив ячеек).
// В базе строка хранится как { c: [ячейки] }; в коде и интерфейсе — обычный массив.
// План кодируется перед записью в закрытый документ testKeys/lesson__{id}.
export function encodePlan(plan) {
  if (!plan || typeof plan !== "object") return plan;
  return {
    ...plan,
    tasks: {
      a: encodeTask(plan.tasks?.a),
      b: encodeTask(plan.tasks?.b)
    }
  };
}
