// ui/components/battle-report-panel.js — итоговая ведомость комнаты Battle у ведущего:
// участники по ФИО, рекомендуемая оценка, участие, вклад, командная работа
// (тот же расчёт, что у отчёта занятия — core/battle-report.js). Ведомость
// собирается по истории Live комнаты, Battle и таблице; её можно обновить, когда
// команды закончат таблицу. Оценка — рекомендация, решение остаётся за преподавателем.
import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { getRoom, getRoomHistory } from "../../core/rooms.js";
import { loadPracticalSnapshot, loadConfirmedResult } from "../../core/practical-store.js";
import { battleRoomReport } from "../../core/battle-report.js";
import { buildReportView } from "./lesson-report-view.js";

export function buildBattleReportPanel({ code, onToast = () => {} }) {
  let busy = false;
  const status = h("p", { class: "form-hint", role: "status" }, "");
  const box = h("div", { class: "battle-report-box" });
  const btn = h("button", { type: "button", class: "btn primary" }, "Итоговая ведомость (ФИО, оценки)");
  const el = h("section", { class: "panel battle-report-panel", hidden: "hidden", "aria-label": "Итоговая ведомость" },
    h("h2", {}, "Итоговая ведомость"),
    h("p", { class: "muted" }, "Участники по алфавиту, рекомендуемая оценка, участие и вклад в Battle. Оценка — рекомендация, решение за вами."),
    h("div", { class: "btn-row" }, btn), status, box);

  async function load() {
    if (busy) return; // повторное нажатие
    busy = true; btn.disabled = true; status.textContent = "Собираем ведомость…";
    try {
      const [room, history, snapshot, confirmed] = await Promise.all([
        getRoom(code).catch(() => null),
        getRoomHistory(code).catch(() => null),
        loadPracticalSnapshot(code).catch(() => ({})),
        loadConfirmedResult(code).catch(() => null)
      ]);
      if (!history) {
        box.replaceChildren();
        status.textContent = "История Live этой комнаты ещё не сохранена: завершите Live-часть, после этого ведомость можно собрать.";
        return;
      }
      const report = battleRoomReport({
        room: { code, title: room?.title || room?.testTitle || "", testTitle: room?.testTitle || "", subjectName: room?.subjectName || "" },
        hostName: room?.hostName || State.profile?.fullName || "",
        dateMs: history.finishedAtMs || history.savedAtMs || Date.now(),
        history, practicalSnapshot: snapshot, confirmed
      });
      box.replaceChildren(buildReportView(report));
      status.textContent = confirmed ? "" : "Таблица ещё не проверена или не задана: её результат в ведомость не входит. Нажмите кнопку ещё раз после проверки.";
    } catch (err) {
      console.error("Итоговая ведомость:", err);
      status.textContent = "Не удалось собрать ведомость. Проверьте соединение и повторите.";
      onToast(status.textContent, "error");
    } finally { busy = false; btn.disabled = false; }
  }
  btn.addEventListener("click", load);
  return { el, show() { el.hidden = false; }, refresh: load };
}
