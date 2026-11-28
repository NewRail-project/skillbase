// core/battle-practical.js — таблица после Battle: проверка команды, очки в счёт
// команды, итог с практикой. Без DOM и Firebase (зависимости передаются).
//
// Порядок для команды (его соблюдает контроллер ведущего):
//   1) капитан нажимает «Проверить» → таблица отправлена и заморожена;
//   2) браузер ведущего сверяет ответы с ключами (они только у ведущего);
//   3) очки записываются в документ битвы РОВНО ОДИН РАЗ (флаг practicalDone);
//   4) команде показывается верно/неверно (задание → confirmed).
// Очки Battle (battle.scores) и победитель Battle не меняются: практика даёт
// отдельное слагаемое practicalScores, а «итого» — сумма (см. totalScores).
import { TEAMS, TASK_STATUS, SUBMISSION, evaluateSubmission, compareTeams } from "./practical.js";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (v) => Math.round(v * 100) / 100;

// Включена ли таблица в этой битве (флаг пишет ведущий при завершении Battle).
export const practicalEnabled = (battle) => battle?.practical?.enabled === true;

// Очки практики команды и итог. battle.scores не меняется.
export function practicalScoresOf(battle) {
  return { a: round2(num(battle?.practicalScores?.a)), b: round2(num(battle?.practicalScores?.b)) };
}
export function totalScores(battle) {
  const p = practicalScoresOf(battle);
  return { a: round2(num(battle?.scores?.a) + p.a), b: round2(num(battle?.scores?.b) + p.b) };
}

// Проверка таблицы команды (чистая функция). task — публичное задание,
// keys — ключи (у ведущего), submission — отправленная таблица команды.
export function checkTeamTable({ task, keys, submission }) {
  return evaluateSubmission({ pub: task, keys: keys || {}, cells: submission?.cells || {}, overrides: {} });
}

// Что записать в документ битвы после проверки команды. Идемпотентно:
// если очки команды уже записаны (practicalDone), патча нет — очки не удвоятся.
export function practicalPatch(battle, team, evaluation) {
  if (!TEAMS.includes(team) || !evaluation) return null;
  if (battle?.practicalDone?.[team] === true) return null;
  const scores = practicalScoresOf(battle);
  return {
    practicalScores: { ...scores, [team]: round2(scores[team] + num(evaluation.score)) },
    practicalDone: { ...(battle?.practicalDone || {}), [team]: true },
    practicalResults: {
      ...(battle?.practicalResults || {}),
      [team]: { score: evaluation.score, max: evaluation.max, percent: evaluation.percent }
    }
  };
}

// Применить патч к копии документа (для немедленного показа и для тестов).
export const withPatch = (battle, patch) => (patch ? { ...battle, ...patch } : battle);

// Для экранов: строка таблицы практики по командам.
export function practicalLine(battle) {
  const r = battle?.practicalResults || {};
  const part = (t) => (r[t] ? `${r[t].score} из ${r[t].max}` : "—");
  return { a: part("a"), b: part("b"), done: Boolean(battle?.practicalDone?.a && battle?.practicalDone?.b) };
}

// ---------- Контроллер ведущего ----------
// deps: {
//   setup(code, plan), setStatus(code, team, status), loadKeys(code, team),
//   confirmTeam(code, team, evaluation), saveFinal(code, evaluations),
//   patchBattle(patch)
// }
// Состояние берётся из вызовов (task/submission приходят из подписок).
export function createHostController({ code, tables, deps }) {
  const inFlight = new Set();
  const confirmedTeams = new Set(); // результат уже записан команде (до прихода снимка)
  let started = false;
  let startPromise = null;
  let finalSaved = false;
  let battle = {};

  async function start() {
    if (started) return startPromise;
    started = true;
    startPromise = (async () => {
      await deps.setup(code, { tasks: tables });
      // Открываем только неоткрытые задания: после перезагрузки страницы ведущего
      // проверенное задание не должно вернуться в «открыто» (команда потеряет итог).
      for (const team of TEAMS) {
        const status = await deps.taskStatus(code, team);
        if (status === null || status === TASK_STATUS.DRAFT) await deps.setStatus(code, team, TASK_STATUS.OPEN);
      }
    })();
    try { await startPromise; } catch (err) { started = false; startPromise = null; throw err; }
    return startPromise;
  }

  // state: { battle, tasks:{a,b}, submissions:{a,b} } — последний известный.
  async function process(state) {
    battle = state.battle || battle;
    const results = {};
    for (const team of TEAMS) {
      const task = state.tasks?.[team];
      const sub = state.submissions?.[team];
      if (!task || sub?.status !== SUBMISSION.SUBMITTED) continue;
      if (inFlight.has(team)) continue;
      inFlight.add(team);
      try {
        const keys = await deps.loadKeys(code, team);
        const evaluation = checkTeamTable({ task, keys, submission: sub });
        results[team] = evaluation;
        // 1) очки (один раз) → 2) показ результата команде.
        const patch = practicalPatch(battle, team, evaluation);
        if (patch) { await deps.patchBattle(patch); battle = withPatch(battle, patch); }
        if (task.status !== TASK_STATUS.CONFIRMED && !confirmedTeams.has(team) && evaluation.complete) {
          await deps.confirmTeam(code, team, evaluation);
          confirmedTeams.add(team);
        }
      } finally { inFlight.delete(team); }
    }
    // Обе команды проверены — общий результат для отчёта (один раз).
    if (!finalSaved && battle?.practicalDone?.a && battle?.practicalDone?.b) {
      const evaluations = {};
      for (const team of TEAMS) {
        const task = state.tasks?.[team];
        const sub = state.submissions?.[team];
        if (task && sub) evaluations[team] = results[team] || checkTeamTable({ task, keys: await deps.loadKeys(code, team), submission: sub });
      }
      if (compareTeams(evaluations.a, evaluations.b).ready) {
        await deps.saveFinal(code, evaluations);
        finalSaved = true;
      }
    }
    return { battle };
  }

  return { start, process, isFinalSaved: () => finalSaved };
}
