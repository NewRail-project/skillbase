// ui/components/lesson-bar.js — панель занятия над видом комнаты.
//   ведущий: этапы (завершён / сейчас / далее), условия перехода, кнопки;
//   участник: на каком этапе занятие, ссылки на материал и итоговый тест.
// Чистая отрисовка по состоянию: действия выполняет вызывающий (handlers).
// Повторный запуск завершённого этапа невозможен: кнопка берёт условия из
// core/lesson-plan.js (canAdvance), а запись в Firestore идёт в транзакции.
import { h } from "../../shared/dom.js";
import { stageStatuses, canAdvance, completion, planOfRun, STAGE_LABEL } from "../../core/lesson-plan.js";

const STATUS_TEXT = { done: "Завершён", skipped: "Пропущен", current: "Идёт сейчас", next: "Следующий", upcoming: "Впереди", off: "Не запланирован" };

const PARTICIPANT_HINT = {
  material: "Прочитайте материал по теме занятия. К нему можно вернуться в любой момент.",
  entry_test: "Дождитесь начала входного теста. Правильные ответы будут показаны позже.",
  battle: "Идёт Battle: две команды отвечают на вопросы.",
  practical: "Практическая диагностика: каждая команда получает своё задание.",
  final_test: "Итоговый тест — заключительный этап занятия.",
  report: "Занятие завершено. Спасибо!"
};

export function buildLessonBar({ run, isHost = false, ctx = {}, handlers = {}, materialHref = "", materialRead = null, readers = null, entryCode = "", busy = false, message = "" } = {}) {
  if (!run) return h("div", { class: "lesson-bar", hidden: true });
  const plan = planOfRun(run);
  const stages = stageStatuses(run, plan).filter(s => s.status !== "off");
  const comp = completion(run, plan);
  const finalRoom = run.finalRoomCode || "";

  const list = h("ol", { class: "lb-stages" }, ...stages.map(s => h("li", { class: "lb-stage", "data-status": s.status, ...(s.status === "current" ? { "aria-current": "step" } : {}) },
    h("span", { class: "lb-stage-name" }, s.label), h("span", { class: "lb-stage-state" }, STATUS_TEXT[s.status]))));

  const head = h("div", { class: "lb-head" },
    h("div", {}, h("p", { class: "lb-kicker" }, "Открытое занятие"), h("h2", { class: "lb-title" }, run.topic || "Занятие")),
    h("p", { class: "lb-progress", "aria-label": "Выполнение занятия" }, `Выполнено этапов: ${comp.done} из ${comp.planned}`));

  const parts = [head, list];

  if (isHost) {
    const check = canAdvance(run, plan, ctx);
    const actions = [];
    if (run.stage !== "report") {
      const next = h("button", { type: "button", class: "btn primary", "data-action": "advance", disabled: busy || !check.ok }, "Завершить этап и перейти дальше");
      next.addEventListener("click", () => handlers.advance && handlers.advance(run.stage));
      const skip = h("button", { type: "button", class: "btn secondary", "data-action": "skip", disabled: busy }, "Пропустить этап");
      skip.addEventListener("click", () => handlers.skip && handlers.skip(run.stage));
      actions.push(next, skip);
    }
    if (run.stage === "final_test" && !finalRoom) {
      const mk = h("button", { type: "button", class: "btn", "data-action": "final-room", disabled: busy }, "Создать комнату итогового теста");
      mk.addEventListener("click", () => handlers.startFinal && handlers.startFinal());
      actions.unshift(mk);
    }
    if (finalRoom) actions.push(h("a", { class: "btn secondary", href: `#room/${encodeURIComponent(finalRoom)}`, "data-action": "open-final" }, `Комната итогового теста: ${finalRoom}`));
    if (run.stage === "report") actions.push(h("a", { class: "btn primary", href: `#lesson-report/${encodeURIComponent(entryCode)}`, "data-action": "open-report" }, "Открыть итоговый отчёт"));
    parts.push(h("div", { class: "btn-row lb-actions" }, ...actions));
    if (run.stage !== "report" && !check.ok) parts.push(h("p", { class: "lb-reason", "data-role": "reason" }, check.reason));
    if (run.stage === "material" && readers) parts.push(h("p", { class: "lb-readers" }, `Прочитали материал: ${readers.read} из ${readers.total}`));
    for (const stage of Object.keys(run.skipReasons || {})) {
      if (run.skipped?.[stage]) parts.push(h("p", { class: "lb-skip-note" }, `${STAGE_LABEL[stage]} пропущен: ${run.skipReasons[stage]}`));
    }
  } else {
    parts.push(h("p", { class: "lb-hint", role: "status" }, PARTICIPANT_HINT[run.stage] || ""));
    if (materialHref && (run.stage === "material" || run.stage === "entry_test")) {
      parts.push(h("div", { class: "btn-row" },
        h("a", { class: "btn secondary", href: materialHref, "data-action": "material" }, "Открыть материал"),
        materialRead === null ? null : h("span", { class: "lb-read", "data-read": materialRead ? "1" : "0" }, materialRead ? "Материал прочитан" : "Материал ещё не прочитан")));
    }
    if (run.stage === "final_test" && finalRoom) {
      parts.push(h("div", { class: "btn-row" }, h("a", { class: "btn primary", href: `#join/${encodeURIComponent(finalRoom)}`, "data-action": "go-final" }, "Перейти к итоговому тесту")));
    }
  }
  if (message) parts.push(h("p", { class: "error-msg", role: "alert" }, message));
  return h("section", { class: "lesson-bar", "aria-label": "Ход занятия", "data-stage": run.stage }, ...parts);
}
