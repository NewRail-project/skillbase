// core/battle-summary.js — итоговая таблица Battle: исход, сводка по командам,
// статистика вопросов и участники по алфавиту. Чистый модуль: без DOM и
// Firebase, проверяется в Node.
//
// Источники (читаем только готовые данные, очки и формулы НЕ пересчитываем):
//   · публичный документ rooms/{code}/battle — его видят команды, наблюдатель
//     и проектор: scores, correctAnswers, roundSummaries, составы;
//   · снимок в истории (buildBattleSnapshot) — те же данные плюс rounds с
//     eligible, events и players (личная статистика участия, посчитанная
//     ведущим по полному состоянию игры).
//
// Чего нет в источнике — null (интерфейс показывает «—»), значения не
// выдумываются. Личные ответы участников (кто что выбрал) в публичный документ
// не попадают и сюда не копируются; из снимка берутся только агрегаты участия.
import { isFullyCorrect, isAvailableInRound } from "./battle-logic.js";

export const TEAM_IDS = ["a", "b"];
export const TEAM_NAME = { a: "Команда А", b: "Команда Б" };
export const ROLE_LABEL = {
  captain: "Капитан", player: "Игрок", substitute: "Игрок (замена)",
  eliminated: "Выбыл", reserve: "Запасной"
};

// Единый формат счёта для всех экранов (команда, наблюдатель, проектор):
// число, округлённое до сотых, без хвоста вида 0.30000000000000004.
export function formatScore(value) {
  return String(Math.round((Number(value) || 0) * 100) / 100);
}

// Счёт обеих команд одной строкой из одного публичного документа.
export function scoreLine(battle) {
  const a = formatScore(battle?.scores?.a);
  const b = formatScore(battle?.scores?.b);
  return { a, b, text: `${a} : ${b}` };
}

// Исход битвы: победитель, ничья, досрочное завершение.
export function outcomeOf(battle) {
  const finished = battle?.phase === "finished";
  const winnerId = TEAM_IDS.includes(battle?.winner) ? battle.winner : null;
  const tie = finished && !winnerId && Boolean(battle?.tie);
  const early = Boolean(battle?.finishedEarly);
  let text = "Битва продолжается";
  if (finished) text = winnerId ? `Победила ${TEAM_NAME[winnerId]}` : (tie ? "Ничья" : "Битва завершена");
  return { finished, winnerId, tie, early, text: finished && early ? `${text} (досрочно)` : text };
}

// Снимок хранит составы в finalRoster, публичный документ — в корне.
function rosterOf(b) {
  const r = b?.finalRoster || b || {};
  return {
    captains: r.captains || {},
    teams: { a: r.teams?.a || [], b: r.teams?.b || [] },
    reserve: r.reserve || [],
    substituted: r.substituted || [],
    eliminated: r.eliminated || [],
    availableFrom: b?.availableFrom || null,
    availableTo: b?.availableTo || null
  };
}

const mainRoundsOf = (b) => (b?.roundSummaries || b?.rounds || []).filter((r) => (r.kind || "main") === "main");

// Был ли игрок доступен в раунде: точный список eligible (снимок) или окна
// доступности (публичный документ). Иначе — неизвестно (null).
function wasAvailable(round, teamId, uid, roster) {
  const eligible = round.teams?.[teamId]?.eligible;
  if (Array.isArray(eligible)) return eligible.includes(uid);
  if (roster.availableFrom || roster.availableTo) {
    return isAvailableInRound({
      teams: roster.teams, availableFrom: roster.availableFrom || {}, availableTo: roster.availableTo || {}
    }, uid, round.index) && roster.teams[teamId].includes(uid);
  }
  return null;
}

function teamAnswer(round, teamId) {
  const t = round.teams?.[teamId];
  if (!t) return "none";
  if (t.status !== "resolved") return "notCounted";
  return isFullyCorrect({ selected: t.selected || [], correct: round.correct || [] }) ? "correct" : "wrong";
}

// Статистика вопросов команды. tiebreak — число споров: считается только по
// журналу снимка (events: tiebreak_started); в публичном документе его нет → null.
function questionStats(rounds, events) {
  const out = { a: {}, b: {} };
  for (const id of TEAM_IDS) {
    let correct = 0, wrong = 0, notCounted = 0, self = 0, vote = 0;
    for (const r of rounds) {
      const verdict = teamAnswer(r, id);
      if (verdict === "correct") correct++;
      else if (verdict === "wrong") wrong++;
      else if (verdict === "notCounted") notCounted++;
      if (r.teams?.[id]?.mode === "self") self++;
      else if (r.teams?.[id]?.mode === "vote") vote++;
    }
    const tiebreak = Array.isArray(events)
      ? events.filter((e) => e?.type === "tiebreak_started" && (e.teams || []).includes(id)).length
      : null;
    out[id] = { correct, wrong, notCounted, tiebreak, self, vote };
  }
  return out;
}

const byName = (x, y) => String(x.name).localeCompare(String(y.name), "ru") || String(x.uid).localeCompare(String(y.uid));

// buildBattleSummary({ battle, nameOf, report })
//   battle — публичный документ или снимок (buildBattleSnapshot / readBattleSnapshot)
//   nameOf — (uid) → ФИО; для снимка имена берутся из его players
//   report — необязательно: { players } с личной статистикой участия
//            (по умолчанию — battle.players, если это снимок)
// Возвращает null, если данных для таблицы нет (старый снимок без раундов и игроков).
export function buildBattleSummary({ battle, nameOf = (u) => u, report = null } = {}) {
  if (!battle || typeof battle !== "object") return null;
  const rounds = mainRoundsOf(battle);
  const roster = rosterOf(battle);
  const reportPlayers = new Map(((report || battle).players || []).map((p) => [p.uid, p]));
  const members = new Set([...roster.teams.a, ...roster.teams.b, ...roster.reserve, ...reportPlayers.keys()]);
  const hasData = rounds.length > 0 || members.size > 0;
  if (!hasData) return null;

  const events = Array.isArray(battle.events) ? battle.events : null;
  const stats = questionStats(rounds, events);
  const outcome = outcomeOf(battle);
  const score = scoreLine(battle);
  const pointsOf = (id) => (Number.isFinite(Number(battle.scores?.[id])) ? Number(battle.scores[id]) : null);

  const teams = {};
  for (const id of TEAM_IDS) {
    teams[id] = {
      id, name: TEAM_NAME[id],
      points: pointsOf(id),
      bonus: Number.isFinite(Number(battle.bonuses?.[id])) ? Number(battle.bonuses[id]) : null,
      // Верные ответы команды: готовый счётчик игры, иначе — по раундам.
      correctAnswers: Number.isFinite(Number(battle.correctAnswers?.[id]))
        ? Number(battle.correctAnswers[id])
        : (Number.isFinite(Number(battle.teams?.[id]?.correctAnswers)) ? Number(battle.teams[id].correctAnswers) : (rounds.length ? stats[id].correct : null)),
      rounds: rounds.length,
      members: roster.teams[id].length
    };
  }

  const players = [];
  for (const uid of members) {
    const rp = reportPlayers.get(uid) || null;
    const teamId = roster.teams.a.includes(uid) ? "a" : roster.teams.b.includes(uid) ? "b" : null;
    let role = "player";
    if (roster.eliminated.includes(uid)) role = "eliminated";
    else if (roster.captains.a === uid || roster.captains.b === uid) role = "captain";
    else if (teamId && roster.substituted.includes(uid)) role = "substitute";
    else if (!teamId) role = "reserve";

    // Верные ответы, которые засчитала команда за те вопросы, где игрок был в игре.
    let teamCorrect = null;
    if (teamId && rounds.length) {
      let known = true, n = 0;
      for (const r of rounds) {
        const avail = wasAvailable(r, teamId, uid, roster);
        if (avail === null) { known = false; break; }
        if (avail && teamAnswer(r, teamId) === "correct") n++;
      }
      teamCorrect = known ? n : null;
    }

    const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== undefined ? Number(v) : null);
    players.push({
      uid,
      name: String(rp?.name || nameOf(uid) || uid),
      teamId,
      teamName: teamId ? TEAM_NAME[teamId] : "—",
      role,
      roleLabel: ROLE_LABEL[role],
      teamCorrect,
      // Личное участие — только из отчёта ведущего (снимок); в публичном документе его нет.
      participated: num(rp?.participatedQuestions),
      available: num(rp?.availableQuestions),
      participationPercent: num(rp?.participationPercent)
    });
  }
  players.sort(byName);

  return {
    source: battle.finalRoster || Array.isArray(battle.players) ? "snapshot" : "public",
    outcome, score, teams,
    questions: {
      total: rounds.length,
      extra: Array.isArray(battle.suddenDeath?.rounds) ? battle.suddenDeath.rounds.length : 0,
      byTeam: stats
    },
    players,
    hasPersonal: players.some((p) => p.participationPercent !== null)
  };
}
