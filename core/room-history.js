// core/room-history.js — снимок итогового отчёта завершённой Live-комнаты.
//
// Принцип: отчёт вычисляется один раз при завершении (те же модули, что и
// на итоговом экране: gradeRoster, journalRows, buildLiveReport, ratingRows
// + applyDuelPlaces), в Firestore сохраняются ГОТОВЫЕ результаты. Повторное
// открытие отчёта читает снимок и ничего не пересчитывает; ключей
// правильных ответов и «сырых» ответов на вопросы в снимке нет — только
// данные, нужные для просмотра отчёта.
//
// Модель хранения: roomHistory/{code} — один документ на комнату
// (устойчивый идентификатор = код комнаты ⇒ дубликат невозможен в
// принципе). Модуль без Firebase и DOM: проверяется в Node.

import { gradeRoster, journalRows } from "./pair-grade.js";
import { buildLiveReport } from "./live-report.js";
import { ratingRows } from "./live-auto.js";
import { applyDuelPlaces } from "./duel-logic.js";

export const ROOM_HISTORY_VERSION = 1;

// Поля строки рейтинга, разрешённые в снимке: место, имя, аватар, очки,
// серия. Правильные ответы, ключи и служебные поля теста не хранятся.
const RATING_FIELDS = ["uid", "name", "avatar", "place", "score", "streak", "bestStreak", "trail"];

const pick = (row, fields) => {
  const out = {};
  for (const field of fields) {
    if (row[field] !== undefined) out[field] = row[field];
  }
  return out;
};

const toPlain = (value) => {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value && typeof value.seconds === "number") {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  return value ?? null;
};

// Снимок итогов. room — документ комнаты, test — публичная часть теста,
// players/scores/duels — снимки подписок ведущего, keysByPos/positions —
// тот же вход, что у итогового экрана. grades и report можно передать
// готовыми (room.js уже посчитал их для вкладок) — тогда они не
// пересчитываются. Отсутствующие данные (старая комната, нет дуэлей,
// нет предмета) дают частичное состояние, ничего не выдумывая.
export function buildRoomHistorySnapshot({
  room = null, test = null, players = [], scores = [], duels = null,
  keysByPos = [], questions = [], positions = null,
  grades = null, report = null, meta = { subject: "", topic: "" }
} = {}) {
  const code = room?.code || room?.id || "";
  const built = grades && report
    ? { grades, report }
    : buildFromInput({ players, keysByPos, questions, positions });
  const finishedRows = ratingRows({
    scores, players,
    questionCount: room?.questionCount || 0,
    finished: Array.isArray(positions) ? positions.length : 0,
    lifecycle: "completed"
  });
  const rating = applyDuelPlaces(finishedRows, duels).map(row => pick(row, RATING_FIELDS));

  const overview = {
    participants: built.report.group?.participants ?? 0,
    observers: players.filter(p => p.observer || p.role === "observer" || p.isAdminPlayer === true).length,
    averageGrade: built.report.group?.averageGrade ?? 0,
    averagePercent: built.report.group?.averagePercent ?? 0,
    finished: built.report.group?.finished ?? 0,
    verdict: built.report.verdict || null
  };

  return {
    version: ROOM_HISTORY_VERSION,
    key: code,
    code,
    orgId: room?.orgId || "",
    hostId: room?.hostId || "",
    hostName: room?.hostName || "",
    testId: room?.testId || "",
    testTitle: room?.testTitle || test?.title || "",
    subjectName: typeof meta?.subject === "string" ? meta.subject : "",
    topicName: typeof meta?.topic === "string" ? meta.topic : "",
    createdAtMs: toPlain(room?.createdAt),
    finishedAtMs: toPlain(room?.autoEndedAt) || toPlain(room?.closedAt) || toPlain(room?.updatedAt),
    overview,
    rating,
    // Дуэли целиком (статусы групп, счёт, раунды, решения) — секретов нет.
    duels: duels ? JSON.parse(JSON.stringify({
      status: duels.status || "",
      groups: (duels.groups || []).map(g => ({
        id: g.id || "",
        uids: g.uids || [],
        names: g.names || {},
        tally: g.tally || {},
        status: g.status || "",
        rounds: (g.rounds || []).length,
        order: g.order || [],
        stoppedReason: g.stoppedReason || "",
        decision: g.decision || null
      }))
    })) : null,
    report: {
      group: built.report.group || null,
      questions: built.report.questions || [],
      students: built.report.students || [],
      topics: built.report.topics || [],
      recommendations: built.report.recommendations || [],
      verdict: built.report.verdict || null
    },
    // Полный разбор каждого участника (детализация по вопросам на вкладке
    // «Участники» и повторное открытие журнала без пересчёта).
    studentsDetail: built.grades.map(g => ({
      uid: g.uid, name: g.name, status: g.status, grade: g.grade,
      earned: g.earned, max: g.max, answered: g.answered, total: g.total,
      correctCount: g.correctCount, breakdown: g.breakdown || []
    })),
    journal: journalRows(built.grades)
  };
}

function buildFromInput({ players, keysByPos, questions, positions }) {
  const grades = gradeRoster({ players, keysByPos, positions });
  return { grades, report: buildLiveReport({ players, keysByPos, questions, positions }) };
}

// Строка списка истории: название теста, предмет/тема, дата завершения,
// участники и краткий итоговый показатель. Пустые поля — честные прочерки.
export function historyRow(doc) {
  const s = doc || {};
  return {
    code: s.code || "",
    testTitle: s.testTitle || "Тест",
    subjectName: s.subjectName || "",
    topicName: s.topicName || "",
    finishedAtMs: s.finishedAtMs ?? null,
    participants: s.overview?.participants ?? 0,
    observers: s.overview?.observers ?? 0,
    averageGrade: s.overview?.averageGrade ?? 0,
    averagePercent: s.overview?.averagePercent ?? 0,
    duelsResolved: s.duels ? s.duels.status === "resolved" : null,
    version: s.version ?? 0
  };
}

// Объект отчёта из снимка: тот же интерфейс, что у buildLiveReport, чтобы
// существующие компоненты (reportSection, studentsPanel, journalPanel,
// recommendationsPanel) рендерили снимок без пересчёта оценок.
export function snapshotReport(snapshot) {
  const s = snapshot || {};
  const detail = Array.isArray(s.studentsDetail) ? s.studentsDetail : [];
  return {
    group: s.report?.group || null,
    questions: s.report?.questions || [],
    students: s.report?.students || [],
    topics: s.report?.topics || [],
    recommendations: s.report?.recommendations || [],
    verdict: s.report?.verdict || null,
    byUid: new Map(detail.map(g => [g.uid, g]))
  };
}

// Сортировка списка: свежие завершения сверху. Дата отсутствует — в конец
// (старые записи без новых полей не ломаются).
export function sortHistoryRows(rows) {
  return [...(rows || [])].sort((a, b) =>
    (b.finishedAtMs ?? 0) - (a.finishedAtMs ?? 0) || String(a.code).localeCompare(String(b.code)));
}
