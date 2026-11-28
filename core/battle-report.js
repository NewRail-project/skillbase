// core/battle-report.js — итоговая ведомость комнаты Battle: участники по ФИО,
// рекомендуемая оценка, участие, вклад, командная работа, статистика.
// Это тот же расчёт, что у отчёта занятия (buildLessonReport): для комнаты из
// теста нет плана занятия, поэтому план и ход собираются здесь из того, что
// реально было в комнате: Live (входной тест), Battle и таблица.
// Чистая логика, без Firebase.
import { buildLessonReport, practicalForReport } from "./lesson-report.js";

// history — запись истории Live комнаты (studentsDetail + battle-снимок),
// practicalSnapshot/confirmed — из practical-store (могут быть null).
export function battleRoomReport({
  room = {}, hostName = "", dateMs = null, history = null,
  practicalSnapshot = null, confirmed = null, decisions = {}
} = {}) {
  const hasLive = Array.isArray(history?.studentsDetail) && history.studentsDetail.length > 0;
  const battle = history?.battle || null;
  const hasTable = Boolean(practicalSnapshot?.tasks?.a && practicalSnapshot?.tasks?.b);
  const practical = hasTable && confirmed ? practicalForReport({ snapshot: practicalSnapshot, confirmed }) : null;

  const plan = {
    topic: String(room.title || room.testTitle || "Battle"),
    subjectName: String(room.subjectName || ""),
    materialTitle: "", entryTestTitle: String(room.testTitle || ""), finalTestTitle: "",
    stages: { material: false, entry_test: hasLive, battle: true, practical: hasTable, final_test: false, report: true }
  };
  const run = {
    id: String(room.code || room.id || ""),
    stage: "report",
    done: { material: false, entry_test: hasLive, battle: Boolean(battle), practical: Boolean(practical), final_test: false, report: true }
  };
  return buildLessonReport({
    plan, run, hostName, dateMs, entry: history, final: null, battle, practical, decisions
  });
}
