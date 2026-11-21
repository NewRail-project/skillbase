// core/battle-logic.js — чистая игровая логика «Командной битвы» (ТЗ §20.1).
//
// Без DOM и без Firebase: всё считается в Node и покрыто tests/battle-logic.test.js.
// Все функции «иммутабельны»: возвращают новые объекты, входные данные не меняют.
// Правильные ответы сюда передаёт только преподаватель/проверяющий код —
// в публичные документы они не попадают (см. docs/BATTLE-LOGIC-DECISIONS.md).
//
// Нерешённые пункты ТЗ §31 реализованы как ПРЕДЛОЖЕНИЯ и вынесены в
// docs/BATTLE-LOGIC-DECISIONS.md — владелец проекта должен их утвердить.

// ---------- Константы и настройки по умолчанию (ТЗ §4.2) ----------

export const TEAM_IDS = ["a", "b"];
export const RESERVE = "reserve";

export const QUESTION_TYPE_SINGLE = "single";
export const QUESTION_TYPE_MULTIPLE = "multiple";

export const DEFAULT_BATTLE_SETTINGS = Object.freeze({
  minPlayers: 8,
  reconnectMs: 60 * 1000,
  captainTiebreakSeconds: 15,
  teamworkThreshold: 0.8,
  shareCorrectness: 0.6,
  shareSpeed: 0.2,
  shareTeamwork: 0.2,
  weightLive: 0.6,
  weightBattle: 0.4,
  weightAccuracy: 0.7,
  weightParticipation: 0.2,
  weightTeamResult: 0.1,
  wrongPenalty: 1.25,
  pointsPerQuestion: 10,
  questionSeconds: 30,
  questionCount: 10,
  questionOrder: "random",
  // Предложение §31.4: ручной выход игрока — те же 60 с; решение
  // преподавателя «выбыл» — немедленно.
  manualLeaveGrace: true
});

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const round2 = (v) => Math.round(v * 100) / 100;
const round4 = (v) => Math.round(v * 10000) / 10000;

// normalizeSettings — мёрдж с умолчаниями + проверка весов/долей.
// Возвращает { settings, errors }. Доли очков и веса оценки обязаны давать 1.
export function normalizeSettings(input = {}) {
  const s = { ...DEFAULT_BATTLE_SETTINGS };
  for (const key of Object.keys(DEFAULT_BATTLE_SETTINGS)) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== "") {
      s[key] = typeof DEFAULT_BATTLE_SETTINGS[key] === "number" ? Number(input[key]) : input[key];
    }
  }
  const errors = [];
  for (const key of Object.keys(DEFAULT_BATTLE_SETTINGS)) {
    if (typeof DEFAULT_BATTLE_SETTINGS[key] === "number" && !Number.isFinite(s[key])) {
      errors.push(`Параметр «${key}» должен быть числом.`);
    }
  }
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  if (!near(s.shareCorrectness + s.shareSpeed + s.shareTeamwork, 1)) errors.push("Доли правильности, скорости и командной работы должны давать 100%.");
  if (!near(s.weightLive + s.weightBattle, 1)) errors.push("Веса Live и битвы должны давать 100%.");
  if (!near(s.weightAccuracy + s.weightParticipation + s.weightTeamResult, 1)) errors.push("Веса точности, участия и результата команды должны давать 100%.");
  if (s.teamworkThreshold <= 0 || s.teamworkThreshold > 1) errors.push("Порог командной работы — от 0 до 100%.");
  if (s.minPlayers < 2) errors.push("Минимум участников — 2.");
  return { settings: s, errors };
}

// ---------- Фазы (ТЗ §24) ----------

export const PHASES = Object.freeze({
  WAITING: "waiting",
  LIVE_RUNNING: "live_running",
  PREPARING: "battle_preparing",
  READY: "battle_ready",
  QUESTION_STARTING: "question_starting",
  CAPTAIN_DECISION: "captain_decision",
  VOTING: "voting",
  CAPTAIN_TIEBREAK: "captain_tiebreak",
  QUESTION_RESULT: "question_result",
  SUDDEN_DEATH: "sudden_death",
  FINISHED: "finished",
  CANCELLED: "cancelled"
});

const P = PHASES;
export const PHASE_TRANSITIONS = Object.freeze({
  [P.WAITING]: [P.LIVE_RUNNING, P.CANCELLED],
  [P.LIVE_RUNNING]: [P.PREPARING, P.CANCELLED],
  [P.PREPARING]: [P.READY, P.CANCELLED],
  [P.READY]: [P.PREPARING, P.QUESTION_STARTING, P.CANCELLED],
  [P.QUESTION_STARTING]: [P.CAPTAIN_DECISION, P.QUESTION_RESULT, P.FINISHED, P.CANCELLED],
  [P.CAPTAIN_DECISION]: [P.VOTING, P.QUESTION_RESULT, P.FINISHED, P.CANCELLED],
  [P.VOTING]: [P.CAPTAIN_TIEBREAK, P.QUESTION_RESULT, P.FINISHED, P.CANCELLED],
  [P.CAPTAIN_TIEBREAK]: [P.QUESTION_RESULT, P.FINISHED, P.CANCELLED],
  [P.QUESTION_RESULT]: [P.QUESTION_STARTING, P.SUDDEN_DEATH, P.FINISHED, P.CANCELLED],
  [P.SUDDEN_DEATH]: [P.QUESTION_RESULT, P.SUDDEN_DEATH, P.FINISHED, P.CANCELLED],
  [P.FINISHED]: [],
  [P.CANCELLED]: []
});

export function canTransition(from, to) {
  return (PHASE_TRANSITIONS[from] || []).includes(to);
}

// transitionPhase(state, to) — единственная точка смены фазы.
export function transitionPhase(state, to) {
  if (!state || !PHASE_TRANSITIONS[state.phase]) return { error: "Неизвестная фаза." };
  if (state.phase === to) return { state, changed: false }; // идемпотентно
  if (!canTransition(state.phase, to)) return { error: `Переход ${state.phase} → ${to} запрещён.` };
  return { state: { ...state, phase: to }, changed: true };
}

// ---------- RNG ----------

export function createSeededRng(seed) {
  if (seed === undefined || seed === null || seed === "" || Number.isNaN(Number(seed))) return Math.random;
  let state = Number(seed) >>> 0;
  return function () {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(items, rng = Math.random) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- Капитаны (ТЗ §5.1–5.2) ----------

// pickCaptains(ranking) — ranking: [{ uid, score }] от лучшего к худшему
// (итог основного Live). 1-е место → A, 2-е → B.
// Ничья за 2-е место → { needsDuel: true, tied: [uid…], captainA } —
// разрешается существующей «Дуэлью», затем вызвать resolveCaptainsAfterDuel.
// Если делят 1-е место трое и более — «Дуэль» между ними за обе позиции.
export function pickCaptains(ranking = []) {
  const list = ranking.filter((r) => r && r.uid);
  if (list.length < 2) return { error: "Для выбора капитанов нужно минимум 2 участника." };
  const sorted = [...list].sort((x, y) => (y.score || 0) - (x.score || 0));
  const topScore = sorted[0].score || 0;
  const topGroup = sorted.filter((r) => (r.score || 0) === topScore);
  if (topGroup.length >= 3) {
    return { needsDuel: true, tied: topGroup.map((r) => r.uid), captainA: null, slots: 2 };
  }
  if (topGroup.length === 2) {
    return { captains: { a: topGroup[0].uid, b: topGroup[1].uid }, needsDuel: false };
  }
  const second = sorted[1].score || 0;
  const secondGroup = sorted.filter((r) => (r.score || 0) === second && r.uid !== sorted[0].uid);
  if (secondGroup.length > 1) {
    return { needsDuel: true, tied: secondGroup.map((r) => r.uid), captainA: sorted[0].uid, slots: 1 };
  }
  return { captains: { a: sorted[0].uid, b: sorted[1].uid }, needsDuel: false };
}

// resolveCaptainsAfterDuel(pick, duelWinners) — duelWinners: массив uid
// победителей «Дуэли» (1 или 2 по pick.slots).
export function resolveCaptainsAfterDuel(pick, duelWinners = []) {
  if (!pick?.needsDuel) return { captains: pick?.captains };
  const need = pick.slots || 1;
  const winners = duelWinners.filter((uid) => pick.tied.includes(uid));
  if (winners.length < need) return { error: "Дуэль не определила капитанов." };
  return need === 1
    ? { captains: { a: pick.captainA, b: winners[0] } }
    : { captains: { a: winners[0], b: winners[1] } };
}

// ---------- Составы (ТЗ §5.3–5.5) ----------

// buildRoster({ memberIds, captains, rng, minPlayers })
// Капитаны фиксируются в A/B; остальные случайно делятся поровну.
// При нечётном общем числе один лишний уходит в общий резерв.
// Роль «наблюдатель» вызывающий код должен исключить заранее.
export function buildRoster({ memberIds = [], captains, rng = Math.random, minPlayers = DEFAULT_BATTLE_SETTINGS.minPlayers } = {}) {
  const all = [...new Set(memberIds)];
  if (all.length < minPlayers) return { error: `Для битвы нужно минимум ${minPlayers} участников.` };
  if (!captains?.a || !captains?.b || captains.a === captains.b) return { error: "Нужны два разных капитана." };
  if (!all.includes(captains.a) || !all.includes(captains.b)) return { error: "Капитан не входит в список участников." };

  const rest = shuffle(all.filter((uid) => uid !== captains.a && uid !== captains.b), rng);
  const activeTotal = all.length - (all.length % 2); // чётное число игроков
  const perTeam = activeTotal / 2;
  const teamA = [captains.a, ...rest.slice(0, perTeam - 1)];
  const teamB = [captains.b, ...rest.slice(perTeam - 1, 2 * (perTeam - 1))];
  const reserve = rest.slice(2 * (perTeam - 1));
  return {
    roster: {
      captains: { a: captains.a, b: captains.b },
      teams: { a: teamA, b: teamB },
      reserve,
      substituted: [], // uid запасных, уже выходивших на замену
      eliminated: [], // uid выбывших
      availableFrom: {}, // uid → индекс раунда, с которого игрок доступен (замены)
      availableTo: {} // uid → индекс раунда, с которого игрок выбыл
    }
  };
}

export function teamOf(roster, uid) {
  if (!roster) return null;
  for (const id of TEAM_IDS) if (roster.teams[id].includes(uid)) return id;
  return roster.reserve.includes(uid) ? RESERVE : null;
}

export function isActivePlayer(roster, uid) {
  const t = teamOf(roster, uid);
  return (t === "a" || t === "b") && !roster.eliminated.includes(uid);
}

// movePlayer(roster, uid, to) — правка состава ДО старта (ТЗ §5.5).
// to: "a" | "b" | "reserve". Капитана перемещать нельзя — сначала setCaptain.
export function movePlayer(roster, uid, to) {
  const from = teamOf(roster, uid);
  if (!from) return { error: "Участник не найден в составе." };
  if (![...TEAM_IDS, RESERVE].includes(to)) return { error: "Неизвестное назначение." };
  if (from === to) return { roster, changed: false };
  if (roster.captains.a === uid || roster.captains.b === uid) return { error: "Капитана нельзя переместить: сначала назначьте другого." };
  const next = cloneRoster(roster);
  removeFromGroups(next, uid);
  if (to === RESERVE) next.reserve.push(uid);
  else next.teams[to].push(uid);
  return { roster: next, changed: true };
}

// setCaptain(roster, teamId, uid) — назначить капитана. Участник из резерва
// или чужой команды переходит в команду; прежний капитан остаётся игроком.
export function setCaptain(roster, teamId, uid) {
  if (!TEAM_IDS.includes(teamId)) return { error: "Неизвестная команда." };
  const from = teamOf(roster, uid);
  if (!from) return { error: "Участник не найден." };
  const otherId = teamId === "a" ? "b" : "a";
  if (roster.captains[otherId] === uid) return { error: "Этот участник — капитан другой команды." };
  if (roster.captains[teamId] === uid) return { roster, changed: false };
  const next = cloneRoster(roster);
  if (from !== teamId) {
    removeFromGroups(next, uid);
    next.teams[teamId].push(uid);
  }
  next.captains[teamId] = uid;
  return { roster: next, changed: true };
}

// teamSizes — для панели подготовки (ТЗ §5.5).
export function teamSizes(roster) {
  return { a: roster.teams.a.length, b: roster.teams.b.length, reserve: roster.reserve.length };
}

// ---------- Выбывание, замена, капитанство (ТЗ §6) ----------

// checkReconnectWindow / connectionState — 60 с на возвращение.
export function checkReconnectWindow(disconnectedAtMs, nowMs, windowMs = DEFAULT_BATTLE_SETTINGS.reconnectMs) {
  if (!Number.isFinite(disconnectedAtMs) || !Number.isFinite(nowMs)) return false;
  return nowMs - disconnectedAtMs <= windowMs;
}

export function connectionState({ lastSeenMs, nowMs, graceMs = DEFAULT_BATTLE_SETTINGS.reconnectMs, heartbeatMs = 15000 } = {}) {
  if (!Number.isFinite(lastSeenMs) || !Number.isFinite(nowMs)) return "unknown";
  const gap = nowMs - lastSeenMs;
  if (gap <= heartbeatMs * 2) return "online";
  return gap <= graceMs + heartbeatMs * 2 ? "grace" : "dropped";
}

function cloneRoster(r) {
  return {
    captains: { ...r.captains },
    teams: { a: [...r.teams.a], b: [...r.teams.b] },
    reserve: [...r.reserve],
    substituted: [...r.substituted],
    eliminated: [...r.eliminated],
    availableFrom: { ...r.availableFrom },
    availableTo: { ...r.availableTo }
  };
}

function removeFromGroups(r, uid) {
  r.teams.a = r.teams.a.filter((x) => x !== uid);
  r.teams.b = r.teams.b.filter((x) => x !== uid);
  r.reserve = r.reserve.filter((x) => x !== uid);
}

// pickNewCaptain — ТЗ §6.5: действующий игрок команды с наивысшим результатом
// Live; при равенстве — лучшее итоговое место; жребия нет.
// liveInfo: { [uid]: { score, place } }.
export function pickNewCaptain(candidates, liveInfo = {}) {
  const list = [...candidates];
  if (!list.length) return null;
  list.sort((x, y) => {
    const a = liveInfo[x] || {};
    const b = liveInfo[y] || {};
    const ds = (b.score ?? -Infinity) - (a.score ?? -Infinity);
    if (ds !== 0 && Number.isFinite(ds)) return ds;
    const pa = a.place ?? Infinity;
    const pb = b.place ?? Infinity;
    if (pa !== pb) return pa - pb;
    return String(x).localeCompare(String(y)); // детерминированно, без жребия
  });
  return list[0];
}

// eliminatePlayer(roster, uid, { roundIndex, liveInfo, auto })
// Помечает игрока выбывшим, при необходимости передаёт капитанство и делает
// автозамену из общего резерва. Идемпотентно: повтор не меняет состав.
// Возвращает { roster, changed, events: [{ type, … }] }.
export function eliminatePlayer(roster, uid, { roundIndex = 0, liveInfo = {}, substitute = true } = {}) {
  const team = teamOf(roster, uid);
  if (!team || team === RESERVE) return { error: "Выбыть может только действующий игрок." };
  if (roster.eliminated.includes(uid)) return { roster, changed: false, events: [] };

  const next = cloneRoster(roster);
  const events = [{ type: "eliminated", uid, teamId: team, roundIndex }];
  next.eliminated.push(uid);
  next.availableTo[uid] = roundIndex;

  // Капитанство: сначала среди тех, кто уже в команде (ТЗ §6.3: замена
  // капитанство не наследует автоматически).
  if (next.captains[team] === uid) {
    const survivors = next.teams[team].filter((x) => x !== uid && !next.eliminated.includes(x));
    const newCaptain = pickNewCaptain(survivors, liveInfo);
    if (newCaptain) {
      next.captains[team] = newCaptain;
      events.push({ type: "captain_changed", teamId: team, from: uid, to: newCaptain, roundIndex });
    } else {
      events.push({ type: "captain_vacant", teamId: team, roundIndex });
    }
  }

  // Автозамена из очереди резерва.
  if (substitute) {
    const sub = nextSubstitute(next);
    if (sub) {
      const applied = applySubstitution(next, { replacingUid: uid, newUid: sub, roundIndex });
      if (!applied.error) {
        events.push(...applied.events);
        // Если у команды не осталось капитана — вакантное место за заменой по Live.
        const t = applied.roster;
        if (!t.captains[team] || t.eliminated.includes(t.captains[team])) {
          const c = pickNewCaptain(t.teams[team].filter((x) => !t.eliminated.includes(x)), liveInfo);
          if (c) { t.captains[team] = c; events.push({ type: "captain_changed", teamId: team, from: uid, to: c, roundIndex }); }
        }
        return { roster: t, changed: true, events };
      }
    }
  }
  return { roster: next, changed: true, events };
}

// nextSubstitute — следующий запасной по очереди попадания в резерв.
export function nextSubstitute(roster) {
  return roster.reserve.find((uid) => !roster.substituted.includes(uid)) || null;
}

// applySubstitution — запасной newUid занимает место replacingUid.
// Один запасной — одна замена; капитанство не передаётся.
export function applySubstitution(roster, { replacingUid, newUid, roundIndex = 0 }) {
  const team = teamOf(roster, replacingUid);
  if (!team || team === RESERVE) return { error: "Заменяемый игрок не состоит в команде." };
  if (!roster.reserve.includes(newUid)) return { error: "Игрок не в резерве." };
  if (roster.substituted.includes(newUid)) return { error: "Запасной уже выходил на замену." };
  const next = cloneRoster(roster);
  next.reserve = next.reserve.filter((x) => x !== newUid);
  next.teams[team].push(newUid);
  next.substituted.push(newUid);
  next.availableFrom[newUid] = roundIndex;
  return {
    roster: next,
    events: [{ type: "substitution", teamId: team, from: replacingUid, to: newUid, roundIndex }]
  };
}

// Игрок мог участвовать в раунде roundIndex?
export function isAvailableInRound(roster, uid, roundIndex) {
  const from = roster.availableFrom[uid] ?? 0;
  const to = roster.availableTo[uid] ?? Infinity;
  const inTeam = roster.teams.a.includes(uid) || roster.teams.b.includes(uid);
  return inTeam && roundIndex >= from && roundIndex < to;
}

// eligibleVoters — кто может голосовать в команде прямо сейчас.
export function eligibleVoters(roster, teamId) {
  return roster.teams[teamId].filter((uid) => !roster.eliminated.includes(uid));
}

// ---------- Голосование (ТЗ §8–10) ----------

// validateVote — проверка голоса перед записью (ядро правил Firestore).
export function validateVote({ phase, roster, uid, teamId, selected, optionCount, type }) {
  if (phase !== PHASES.VOTING) return { ok: false, error: "Голосование закрыто." };
  if (!isActivePlayer(roster, uid)) return { ok: false, error: "Запасные и выбывшие не голосуют." };
  if (teamOf(roster, uid) !== teamId) return { ok: false, error: "Можно голосовать только за свою команду." };
  if (!Array.isArray(selected) || selected.length === 0) return { ok: false, error: "Выберите вариант." };
  const uniq = new Set(selected);
  if (uniq.size !== selected.length) return { ok: false, error: "Повторяющиеся варианты." };
  if (selected.some((i) => !Number.isInteger(i) || i < 0 || i >= optionCount)) return { ok: false, error: "Недопустимый вариант." };
  if (type === QUESTION_TYPE_SINGLE && selected.length !== 1) return { ok: false, error: "Нужен ровно один вариант." };
  return { ok: true };
}

// applyVote(votes, vote) — один действующий голос на игрока; последний побеждает.
// votes: { [uid]: { selected, at } }. Повтор того же голоса идемпотентен.
export function applyVote(votes = {}, { uid, selected, at }) {
  const sorted = [...selected].sort((x, y) => x - y);
  const prev = votes[uid];
  if (prev && prev.selected.length === sorted.length && prev.selected.every((v, i) => v === sorted[i])) return votes;
  return { ...votes, [uid]: { selected: sorted, at } };
}

// votedCount — единственное, что видят игроки до закрытия (ТЗ §8.3).
export function votedCount(votes, eligible) {
  const set = new Set(eligible);
  const voted = Object.keys(votes).filter((uid) => set.has(uid)).length;
  return { voted, total: eligible.length };
}

// tallyVotes — подсчёт большинства. Возвращает по каждому варианту число голосов.
export function tallyVotes({ votes = {}, eligible = [], optionCount }) {
  const set = new Set(eligible);
  const counts = new Array(optionCount).fill(0);
  let voters = 0;
  for (const [uid, vote] of Object.entries(votes)) {
    if (!set.has(uid)) continue;
    voters++;
    for (const i of vote.selected) if (i >= 0 && i < optionCount) counts[i]++;
  }
  return { counts, voters };
}

// resolveTeamAnswer — командный ответ из голосов + решений капитана.
//   single:   максимум голосов; ничья → решает капитан (decisions.pick = вариант
//             из спорных); не решил за 15 с (tiebreakExpired) → ответа нет.
//   multiple: по каждому варианту строгое большинство голосовавших; ровно
//             половина → спор; decisions.options = { [i]: true|false };
//             не решил за 15 с → спорный вариант исключён.
// Возвращает { status: "resolved"|"tiebreak"|"unresolved", selected, tied }.
export function resolveTeamAnswer({ type, optionCount, votes = {}, eligible = [], decisions = {}, tiebreakExpired = false }) {
  const { counts, voters } = tallyVotes({ votes, eligible, optionCount });
  if (voters === 0) return { status: "unresolved", selected: [], tied: [], voters };

  if (type === QUESTION_TYPE_SINGLE) {
    const max = Math.max(...counts);
    const leaders = counts.map((c, i) => (c === max ? i : -1)).filter((i) => i >= 0);
    if (leaders.length === 1) return { status: "resolved", selected: leaders, tied: [], voters };
    const pick = decisions.pick;
    if (Number.isInteger(pick) && leaders.includes(pick)) return { status: "resolved", selected: [pick], tied: leaders, voters };
    // Нет случайного выбора (ТЗ §9): безопасное состояние «ответа нет».
    return tiebreakExpired
      ? { status: "unresolved", selected: [], tied: leaders, voters }
      : { status: "tiebreak", selected: [], tied: leaders, voters };
  }

  const selected = [];
  const tied = [];
  for (let i = 0; i < optionCount; i++) {
    if (counts[i] * 2 > voters) selected.push(i);
    else if (counts[i] * 2 === voters && counts[i] > 0) tied.push(i);
  }
  const decided = decisions.options || {};
  const pending = [];
  for (const i of tied) {
    if (decided[i] === true) selected.push(i);
    else if (decided[i] === false) continue;
    else if (!tiebreakExpired) pending.push(i);
    // истёк срок → спорный вариант исключён
  }
  selected.sort((x, y) => x - y);
  if (pending.length) return { status: "tiebreak", selected, tied: pending, voters };
  return { status: "resolved", selected, tied, voters };
}

// captainTiebreakLeftMs — сколько осталось капитану на спорное решение.
export function captainTiebreakLeftMs(startedAtMs, nowMs, seconds = DEFAULT_BATTLE_SETTINGS.captainTiebreakSeconds) {
  return Math.max(0, startedAtMs + seconds * 1000 - nowMs);
}

// ---------- Очки (ТЗ §11) ----------

// answerRatio — доля правильности ответа [0..1].
//   single: 1 или 0.
//   multiple: правильный вариант = +4 «кванта», неправильный = −5 «квантов»
//   (штраф 125% от одного верного варианта, целочисленно, без округления);
//   итог = max(0, hits·4 − wrong·5) / (4·n), не больше 1.
export function answerRatio({ selected = [], correct = [], penalty = DEFAULT_BATTLE_SETTINGS.wrongPenalty }) {
  const right = new Set(correct);
  const chosen = [...new Set(selected)];
  if (right.size === 0 || chosen.length === 0) return 0;
  if (right.size === 1) return chosen.length === 1 && right.has(chosen[0]) ? 1 : 0;
  let hits = 0;
  let wrong = 0;
  for (const i of chosen) (right.has(i) ? hits++ : wrong++);
  // penalty = 1.25 → 5/4; общий случай через масштаб 1000.
  const unit = 1000;
  const units = hits * unit - wrong * Math.round(penalty * unit);
  return clamp01(units / (right.size * unit));
}

export function isFullyCorrect({ selected = [], correct = [] }) {
  const right = new Set(correct);
  const chosen = new Set(selected);
  return right.size > 0 && chosen.size === right.size && [...right].every((i) => chosen.has(i));
}

// timeLeftRatio — линейно: ответ в начале → 1, в конце → 0.
export function timeLeftRatio(durationSec, answeredMs) {
  const d = Number(durationSec);
  if (!Number.isFinite(d) || d <= 0) return 0;
  if (typeof answeredMs !== "number" || !Number.isFinite(answeredMs) || answeredMs < 0) return 0;
  return clamp01(1 - answeredMs / (d * 1000));
}

// scoreTeamAnswer — очки команды за вопрос из трёх компонент.
// Предложение §31.2: скорость умножается на долю правильности, поэтому
// неправильный ответ не получает скоростных очков, а частично верный —
// пропорциональные.
export function scoreTeamAnswer({ ratio, fullyCorrectShare = 0, voters = 0, mode = "vote", answered = true, answeredMs, durationSec, settings = DEFAULT_BATTLE_SETTINGS }) {
  const max = settings.pointsPerQuestion;
  const zero = { correctness: 0, speed: 0, teamwork: 0, total: 0 };
  if (!answered) return zero; // время истекло / ответа нет (ТЗ §11.4)
  const correctness = max * settings.shareCorrectness * ratio;
  const speed = max * settings.shareSpeed * timeLeftRatio(durationSec, answeredMs) * ratio;
  const teamwork = mode === "vote" && voters > 0 && fullyCorrectShare >= settings.teamworkThreshold
    ? max * settings.shareTeamwork
    : 0;
  return {
    correctness: round2(correctness),
    speed: round2(speed),
    teamwork: round2(teamwork),
    total: round2(correctness + speed + teamwork)
  };
}

// ---------- Раунд целиком ----------

// evaluateTeamRound — результат одной команды в раунде.
// team: { teamId, mode: "self"|"vote"|"none", captainUid, eligible, votes,
//         captainSelected, decisions, tiebreakExpired, answeredMs, timedOut }
export function evaluateTeamRound({ question, team, durationSec, settings = DEFAULT_BATTLE_SETTINGS }) {
  const { type, optionCount, correct } = question;
  const eligible = team.eligible || [];
  const answers = {}; // uid → доля правильности личного ответа
  const voted = [];
  let selected = [];
  let status = "unresolved";
  let voters = 0;
  let fullyCorrect = 0;

  if (team.mode === "self") {
    if (Array.isArray(team.captainSelected) && team.captainSelected.length) {
      selected = [...team.captainSelected];
      status = "resolved";
      answers[team.captainUid] = answerRatio({ selected, correct, penalty: settings.wrongPenalty });
      voted.push(team.captainUid);
      voters = 1;
      fullyCorrect = isFullyCorrect({ selected, correct }) ? 1 : 0;
    }
  } else if (team.mode === "vote") {
    const res = resolveTeamAnswer({
      type, optionCount, votes: team.votes, eligible,
      decisions: team.decisions, tiebreakExpired: team.tiebreakExpired
    });
    status = res.status;
    selected = res.selected;
    voters = res.voters;
    const set = new Set(eligible);
    for (const [uid, v] of Object.entries(team.votes || {})) {
      if (!set.has(uid)) continue;
      voted.push(uid);
      answers[uid] = answerRatio({ selected: v.selected, correct, penalty: settings.wrongPenalty });
      if (isFullyCorrect({ selected: v.selected, correct })) fullyCorrect++;
    }
  }

  const answered = status === "resolved" && !team.timedOut;
  const ratio = answered ? answerRatio({ selected, correct, penalty: settings.wrongPenalty }) : 0;
  const share = voters > 0 ? fullyCorrect / voters : 0;
  const points = scoreTeamAnswer({
    ratio, fullyCorrectShare: share, voters, mode: team.mode, answered,
    answeredMs: team.answeredMs, durationSec, settings
  });

  return {
    teamId: team.teamId,
    mode: team.mode,
    status: answered ? "resolved" : (team.timedOut ? "timeout" : status),
    captainUid: team.captainUid,
    eligible: [...eligible],
    selected,
    ratio: round4(ratio),
    fullyCorrect: answered && isFullyCorrect({ selected, correct }),
    voters,
    voted,
    answers,
    points
  };
}

// buildRoundRecord — запись раунда, которую хранят в истории (без ключей ответов,
// кроме индексов правильных — раскрываются после закрытия, ТЗ §21.1).
export function buildRoundRecord({ index, kind = "main", question, durationSec, teams, settings }) {
  const result = {};
  for (const id of TEAM_IDS) {
    result[id] = evaluateTeamRound({ question, team: teams[id], durationSec, settings });
  }
  return { index, kind, questionId: question.id ?? null, type: question.type, correct: [...question.correct], teams: result };
}

// ---------- Состояние битвы: применение раунда, завершение ----------

export function createBattleState({ settings, roster, questionIds = [] } = {}) {
  return {
    phase: PHASES.READY,
    settings,
    roster,
    questionIds,
    rounds: [],
    scores: { a: 0, b: 0 },
    bonuses: { a: 0, b: 0 },
    correctAnswers: { a: 0, b: 0 },
    suddenDeath: { rounds: [], winner: null },
    winner: null,
    finishedEarly: false
  };
}

// applyRoundResult — идемпотентно: повторное событие с тем же index не меняет очки (ТЗ §23.15).
export function applyRoundResult(state, record) {
  if (state.rounds.some((r) => r.index === record.index && r.kind === record.kind)) {
    return { state, changed: false };
  }
  const scores = { ...state.scores };
  const bonuses = { ...state.bonuses };
  const correctAnswers = { ...state.correctAnswers };
  for (const id of TEAM_IDS) {
    scores[id] = round2(scores[id] + record.teams[id].points.total);
    bonuses[id] = round2(bonuses[id] + record.teams[id].points.teamwork);
    if (record.teams[id].fullyCorrect) correctAnswers[id]++;
  }
  return {
    state: { ...state, rounds: [...state.rounds, record], scores, bonuses, correctAnswers },
    changed: true
  };
}

export function determineWinner(scores = {}) {
  const ranking = Object.keys(scores).sort((x, y) => (scores[y] || 0) - (scores[x] || 0));
  if (!ranking.length) return { winnerId: null, tie: false, ranking: [] };
  const tie = ranking.length > 1 && (scores[ranking[0]] || 0) === (scores[ranking[1]] || 0);
  return { winnerId: tie ? null : ranking[0], tie, ranking };
}

export function isGameComplete(state) {
  return state.rounds.filter((r) => r.kind === "main").length >= state.questionIds.length;
}

// ---------- Решающий раунд капитанов (ТЗ §13) ----------

// resolveSuddenDeathRound — answers: { a: { correct: bool, ms }, b: { … } }.
// Побеждает первый ПРАВИЛЬНЫЙ ответ; неправильный быстрее не помогает;
// оба неверны или время равно → следующий вопрос (next: true).
export function resolveSuddenDeathRound(answers = {}) {
  const ok = TEAM_IDS.filter((id) => answers[id]?.correct === true && Number.isFinite(answers[id].ms));
  if (ok.length === 0) return { winner: null, next: true, reason: "both_wrong" };
  if (ok.length === 1) return { winner: ok[0], next: false, reason: "single_correct" };
  const [x, y] = ok;
  if (answers[x].ms === answers[y].ms) return { winner: null, next: true, reason: "same_time" };
  return { winner: answers[x].ms < answers[y].ms ? x : y, next: false, reason: "faster_correct" };
}

export function needsSuddenDeath(state) {
  return isGameComplete(state) && determineWinner(state.scores).tie && !state.suddenDeath.winner;
}

// pickExtraQuestion — банк повторяется по кругу: ограничения числа вопросов нет.
export function pickExtraQuestion(bank = [], extraIndex = 0) {
  return bank.length ? bank[extraIndex % bank.length] : null;
}

export function applySuddenDeathResult(state, roundResult) {
  const rounds = [...state.suddenDeath.rounds, roundResult];
  const winner = roundResult.winner || state.suddenDeath.winner;
  return { ...state, suddenDeath: { rounds, winner } };
}

// ---------- Завершение (ТЗ §14) ----------

// finishBattle — автоматически или досрочно. Незавершённый вопрос не засчитывается
// (в state.rounds попадают только закрытые раунды).
export function finishBattle(state, { early = false } = {}) {
  if (state.phase === PHASES.FINISHED) return { state, changed: false };
  const base = determineWinner(state.scores);
  const winner = state.suddenDeath.winner || base.winnerId;
  return {
    state: {
      ...state,
      phase: PHASES.FINISHED,
      finishedEarly: early,
      winner,
      tie: !winner && base.tie
    },
    changed: true
  };
}

// ---------- Канат (ТЗ §12) ----------

// ropePosition — положение каната [-1..1]; >0 к команде A, <0 к команде B.
// Пропорционально разнице очков, ограничено по краям.
export function ropePosition({ scoreA = 0, scoreB = 0, scale }) {
  const s = Number(scale);
  if (!Number.isFinite(s) || s <= 0) return 0;
  return round4(Math.max(-1, Math.min(1, (scoreA - scoreB) / s)));
}

// ropePercent — 0..100 для CSS: 50 — центр; визуальные границы 8..92.
export function ropePercent(position) {
  return round2(50 + Math.max(-1, Math.min(1, position)) * 42);
}

// ---------- Личные оценки и статистика (ТЗ §15–17) ----------

// computePlayerStats — по закрытым основным раундам.
// Доступный вопрос — тот, где игрок мог голосовать (или капитан отвечал сам).
// Самостоятельный ответ капитана не считается неучастием остальных.
export function computePlayerStats({ uid, rounds = [], roster, teamScores = {} }) {
  let available = 0;
  let participated = 0;
  let correctCount = 0;
  let accuracySum = 0;
  const teamId = teamOf(roster, uid);

  for (const round of rounds) {
    if (round.kind !== "main") continue;
    for (const id of TEAM_IDS) {
      const t = round.teams[id];
      if (!t.eligible.includes(uid)) continue;
      if (t.mode === "self") {
        if (t.captainUid !== uid) continue; // остальным вопрос недоступен
        available++;
        participated++;
        accuracySum += t.answers[uid] ?? 0;
        if ((t.answers[uid] ?? 0) >= 1) correctCount++;
      } else {
        available++;
        if (t.answers[uid] !== undefined) {
          participated++;
          accuracySum += t.answers[uid];
          if (t.answers[uid] >= 1) correctCount++;
        }
      }
    }
  }

  const accuracy = participated > 0 ? accuracySum / participated : 0;
  const participation = available > 0 ? participated / available : 0;
  const best = Math.max(teamScores.a || 0, teamScores.b || 0);
  const mine = teamId === "a" || teamId === "b" ? teamScores[teamId] || 0 : 0;
  const teamResult = best > 0 ? clamp01(mine / best) : 0;
  return { available, participated, correctCount, accuracy, participation, teamResult };
}

// battleGrade — 0..100. null, если игрок не имел доступных вопросов
// (запасной без замены) — тогда итог = только Live (ТЗ §5.4, §15.6).
export function battleGrade(stats, settings = DEFAULT_BATTLE_SETTINGS) {
  if (!stats || stats.available === 0) return null;
  const v = settings.weightAccuracy * stats.accuracy
    + settings.weightParticipation * stats.participation
    + settings.weightTeamResult * stats.teamResult;
  return round2(clamp01(v) * 100);
}

// preparedness — процент подготовки (ТЗ §16): точность и участие по доступным
// вопросам. Предложение §31: 70% точность + 30% участие.
export function preparedness(stats) {
  if (!stats || stats.available === 0) return null;
  return round2(clamp01(0.7 * stats.accuracy + 0.3 * stats.participation) * 100);
}

// finalGrade — Итог = Live·wL + Battle·wB (обе шкалы 0..100).
// Без битвы (battle === null) итог = Live без пересчёта.
export function finalGrade({ live, battle, settings = DEFAULT_BATTLE_SETTINGS }) {
  if (!Number.isFinite(live)) return null;
  if (battle === null || battle === undefined) return round2(live);
  return round2(live * settings.weightLive + battle * settings.weightBattle);
}

// buildFinalReport — итоговая статистика участников и команд (ТЗ §17).
// liveInfo: { uid: { name, score, place, liveGrade } }. Сортировка по ФИО.
export function buildFinalReport({ state, liveInfo = {} }) {
  const { roster, settings, rounds } = state;
  const main = rounds.filter((r) => r.kind === "main");
  const everyone = new Set([...Object.keys(liveInfo), ...roster.teams.a, ...roster.teams.b, ...roster.reserve]);
  const players = [];
  for (const uid of everyone) {
    const info = liveInfo[uid] || {};
    const stats = computePlayerStats({ uid, rounds: main, roster, teamScores: state.scores });
    const battle = battleGrade(stats, settings);
    const team = teamOf(roster, uid);
    players.push({
      uid,
      name: info.name || uid,
      livePlace: info.place ?? null,
      teamId: team === RESERVE ? null : team,
      isCaptain: roster.captains.a === uid || roster.captains.b === uid,
      isReserve: team === RESERVE,
      substituted: roster.substituted.includes(uid),
      eliminated: roster.eliminated.includes(uid),
      availableQuestions: stats.available,
      participatedQuestions: stats.participated,
      correctAnswers: stats.correctCount,
      accuracyPercent: round2(stats.accuracy * 100),
      participationPercent: round2(stats.participation * 100),
      preparednessPercent: preparedness(stats),
      battleGrade: battle,
      liveGrade: info.liveGrade ?? null,
      finalGrade: finalGrade({ live: info.liveGrade, battle, settings })
    });
  }
  players.sort((x, y) => String(x.name).localeCompare(String(y.name), "ru"));
  const teams = {};
  for (const id of TEAM_IDS) {
    teams[id] = {
      members: roster.teams[id].length,
      completedQuestions: main.length,
      correctAnswers: state.correctAnswers[id],
      points: state.scores[id],
      teamworkBonus: state.bonuses[id]
    };
  }
  return { players, teams, winner: state.winner ?? null, tie: Boolean(state.tie), finishedEarly: state.finishedEarly };
}

// Предварительные настройки вопросов битвы, заданные при запуске комнаты
// (ui/pages/launch.js → rooms/{code}.battleSettings). Панель подготовки
// (ui/components/battle-prep.js) берёт их как стартовые значения и по-прежнему
// даёт изменить после Live. Формулы, команды и капитаны не затрагиваются.
// Возвращает только допустимые значения: набор (id теста, необязательно),
// число вопросов 1–50 и время на вопрос 5–3600 с — те же границы, что у
// полей панели подготовки.
export const BATTLE_PRESET_LIMITS = Object.freeze({ countMin: 1, countMax: 50, secMin: 5, secMax: 3600 });

export function sanitizeBattlePreset(input = {}) {
  const { countMin, countMax, secMin, secMax } = BATTLE_PRESET_LIMITS;
  const clamp = (value, min, max, fallback) => {
    const n = Math.trunc(Number(value));
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  const out = {
    questionCount: clamp(input?.questionCount, countMin, countMax, DEFAULT_BATTLE_SETTINGS.questionCount),
    questionSeconds: clamp(input?.questionSeconds, secMin, secMax, DEFAULT_BATTLE_SETTINGS.questionSeconds)
  };
  const id = String(input?.battleTestId ?? "").trim();
  if (id && id.length <= 200 && !id.includes("/")) out.battleTestId = id;
  return out;
}
