// core/battle-snapshot.js — снимок завершённой битвы для roomHistory (ТЗ §18).
// Чистый модуль: без Firebase и DOM. Снимок хранит ГОТОВЫЕ результаты;
// повторное открытие ничего не пересчитывает (ни по настройкам, ни по
// вопросам, ни по профилям пользователей).

import { buildFinalReport } from "./battle-logic.js";

export const BATTLE_SNAPSHOT_VERSION = 1;

// Ключи вопросов и любые поля с ответами в снимок не попадают.
const FORBIDDEN = new Set(["key", "keys", "answerKey", "testKeys"]);

function plain(value) {
  return JSON.parse(JSON.stringify(value, (k, v) => (FORBIDDEN.has(k) ? undefined : v)));
}

// buildBattleSnapshot({ state, liveInfo, initialRoster, events, finishedAtMs, questions })
//   state        — итоговое состояние битвы (finishBattle)
//   liveInfo     — { uid: { name, place, score, liveGrade } } на момент старта
//   initialRoster— составы и очередь резерва ДО первого вопроса
//   events       — решения капитанов, замены, выбывания (журнал)
//   questions    — [{ id, type, optionCount }] в порядке показа (без ключей)
export function buildBattleSnapshot({ state, liveInfo = {}, initialRoster = null, events = [], finishedAtMs = null, questions = [] } = {}) {
  if (!state) throw new Error("Нет состояния битвы.");
  const report = buildFinalReport({ state, liveInfo });
  return plain({
    version: BATTLE_SNAPSHOT_VERSION,
    settings: state.settings,
    questions: questions.map((q) => ({ id: q.id ?? null, type: q.type, optionCount: q.optionCount })),
    captains: initialRoster?.captains || state.roster.captains,
    initialRoster: initialRoster
      ? { teams: initialRoster.teams, reserve: initialRoster.reserve }
      : null,
    finalRoster: {
      captains: state.roster.captains,
      teams: state.roster.teams,
      reserve: state.roster.reserve,
      substituted: state.roster.substituted,
      eliminated: state.roster.eliminated
    },
    events,
    rounds: state.rounds,
    suddenDeath: state.suddenDeath,
    scores: state.scores,
    bonuses: state.bonuses,
    winner: state.winner ?? null,
    tie: Boolean(state.tie),
    finishedEarly: Boolean(state.finishedEarly),
    players: report.players,
    teams: report.teams,
    finishedAtMs
  });
}

// readBattleSnapshot — безопасное чтение (старые комнаты без battle → null).
export function readBattleSnapshot(historyDoc) {
  const b = historyDoc?.battle;
  return b && typeof b === "object" && b.version ? b : null;
}
