// ui/pages/lesson-report.js — итоговый отчёт занятия: #lesson-report/<код входной комнаты>.
//
// 1) Если занятие уже сохранено в историю (lessonHistory) — показывается СОХРАНЁННЫЙ
//    снимок без пересчёта: правка теста, материала или сценария позже его не меняет.
// 2) Иначе ведущий видит отчёт, собранный из снимков комнат (roomHistory входной и
//    итоговой), Battle и подтверждённой практики. Здесь он выставляет итоговые
//    оценки (рекомендация — лишь подсказка) и сохраняет занятие в историю.
//    Сохранение возможно и для неполного занятия — с явным предупреждением.
import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { loadCss } from "../../shared/load-css.js";
import { getRoom, getRoomHistory } from "../../core/rooms.js";
import { saveLessonHistory, loadLessonHistory, lessonErrorText } from "../../core/lesson-store.js";
import { loadPracticalSnapshot, loadConfirmedResult } from "../../core/practical-store.js";
import { buildLessonReport, practicalForReport, cleanDecisions } from "../../core/lesson-report.js";
import { reportPlanOfRun } from "../../core/lesson-plan.js";
import { buildReportView } from "../components/lesson-report-view.js";
import { toast } from "../components/toast.js";

export default async function LessonReportPage() {
  try { await loadCss("ui/css/lessons.css"); } catch (err) { console.warn("Стили занятий не загрузились:", err); }
  const code = decodeURIComponent((State.routeParam || "").split("/")[0] || "");
  const page = h("div", { class: "page lesson-report-page" }, h("div", { class: "spinner" }));
  if (!code) { page.replaceChildren(h("p", { class: "form-error", role: "alert" }, "Не указан код занятия.")); return page; }
  try { await render(page, code); }
  catch (err) {
    console.error("Отчёт занятия:", err);
    page.replaceChildren(h("p", { class: "form-error", role: "alert" }, lessonErrorText(err)));
  }
  return page;
}

const back = (extra) => h("div", { class: "page-head-actions" },
  h("a", { class: "btn secondary", href: "#lesson-history" }, "История занятий"), extra);

async function render(page, code) {
  const saved = await loadLessonHistory(code);
  if (saved) {
    page.replaceChildren(
      h("div", { class: "page-head" }, h("div", {}, h("div", { class: "eyebrow" }, "Сохранено в истории"),
        h("p", { class: "muted" }, "Исторический отчёт не пересчитывается и не меняется при редактировании теста, материала или сценария.")), back()),
      buildReportView(saved.report));
    return;
  }

  const room = await getRoom(code);
  if (!room?.lesson) throw new Error("Это не комната занятия или у вас нет к ней доступа.");
  if (room.hostId !== State.user?.uid && State.profile?.role !== "admin") throw new Error("Отчёт занятия доступен ведущему и администратору.");
  const run = room.lesson;
  // Отчёт строится по снимку настроек в самом ходе занятия, а не по плану,
  // который могли отредактировать после запуска.
  const plan = reportPlanOfRun(run);
  const [entry, final, snapshot, confirmed] = await Promise.all([
    getRoomHistory(code).catch(() => null),
    run.finalRoomCode ? getRoomHistory(run.finalRoomCode).catch(() => null) : null,
    loadPracticalSnapshot(code).catch(() => ({})),
    loadConfirmedResult(code).catch(() => null)
  ]);
  if (!entry) {
    page.replaceChildren(h("div", { class: "page-head" }, h("h1", {}, "Отчёт занятия"), back()),
      h("div", { class: "panel" }, h("p", { class: "form-hint", role: "status" },
        "История входного теста ещё не сохранена. Завершите Live-комнату входного теста: после этого отчёт можно собрать.")));
    return;
  }
  const practical = practicalForReport({ snapshot, confirmed });
  const decisions = {};
  const box = h("div", {});
  const assemble = () => buildLessonReport({
    plan, run, hostName: room.hostName || "", dateMs: run.startedAt || null,
    entry, final, battle: entry.battle || null, practical, decisions: cleanDecisions(decisions)
  });
  let report = assemble();
  const paint = () => box.replaceChildren(buildReportView(report, {
    editable: true, decisions,
    onDecision: (uid, value) => { if (value) decisions[uid] = value; else delete decisions[uid]; }
  }));
  paint();

  const status = h("p", { class: "form-hint", role: "status" }, "");
  const alertBox = h("p", { class: "error-msg", role: "alert" }, "");
  let saving = false;
  const saveBtn = h("button", { type: "button", class: "btn primary" }, "Сохранить занятие в историю");
  saveBtn.addEventListener("click", async () => {
    if (saving) return; // повторное нажатие
    const complete = run.stage === "report";
    const message = complete
      ? "Сохранить занятие в историю? После сохранения отчёт и оценки изменить нельзя."
      : "Занятие завершено не полностью: этапы, которые не пройдены, в отчёте так и будут отмечены. Сохранить в историю? Изменить потом будет нельзя.";
    if (!window.confirm(message)) return;
    saving = true; saveBtn.disabled = true; alertBox.textContent = ""; status.textContent = "Сохраняем…";
    try {
      report = assemble();
      const result = await saveLessonHistory({ code, report, finalCode: run.finalRoomCode || "" });
      status.textContent = "";
      toast(result.saved ? "Занятие сохранено в историю." : "Это занятие уже сохранено ранее.", result.saved ? "success" : "info");
      window.location.hash = "#lesson-history";
    } catch (err) {
      console.error("Сохранение занятия:", err);
      alertBox.textContent = lessonErrorText(err);
      status.textContent = "";
      saving = false; saveBtn.disabled = false;
    }
  });

  page.replaceChildren(
    h("div", { class: "page-head" }, h("div", {}, h("div", { class: "eyebrow" }, "Открытое занятие"),
      h("p", { class: "muted" }, "Проверьте рекомендации и выставьте итоговые оценки сами. После сохранения отчёт станет неизменяемым.")), back()),
    box, h("div", { class: "btn-row" }, saveBtn), status, alertBox);
}
