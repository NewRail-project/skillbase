// core/battle-game.js — контроллер хода игры «Командной битвы» на стороне
// ведущего. Связывает чистую логику (battle-logic.js) и хранилище.
//
// Хранилище передаётся снаружи (core/battle.js в приложении, заглушка в
// тестах), поэтому модуль не импортирует Firebase и проверяется в Node.
// Правильные ответы существуют ТОЛЬКО в памяти ведущего (questions[].correct)
// и в публичные документы не записываются до закрытия раунда.
//
// Интерфейс store:
//   saveBattle(patch)                 — публичный документ rooms/{code}/battle
//   readVotes(roundIndex) → { uid: { selected, at } }
//   readDecisions(roundIndex) → { [teamId]: { mode, selected?, decisions? } }
//   logEvent(event)                   — журнал событий
import {
  PHASES, TEAM_IDS, transitionPhase, createBattleState, applyRoundResult,
  buildRoundRecord, eligibleVoters, eliminatePlayer, finishBattle,
  isGameComplete, needsSuddenDeath, resolveSuddenDeathRound, applySuddenDeathResult,
  pickExtraQuestion, ropePosition, captainTiebreakLeftMs, resolveTeamAnswer
} from "./battle-logic.js";

// Статусы раунда в публичном документе (читают клиенты и правила Firestore).
export const ROUND_STATES = {
  OPEN: "open",
  ANSWERING: "answering",
  VOTING: "voting",
  TIEBREAK: "tiebreak",
  CLOSED: "closed",
  DECISION: "decision"
};

const PHASE_TO_ROUND = {
  [PHASES.CAPTAIN_DECISION]: ROUND_STATES.ANSWERING,
  [PHASES.VOTING]: ROUND_STATES.VOTING,
  [PHASES.CAPTAIN_TIEBREAK]: ROUND_STATES.TIEBREAK,
  [PHASES.QUESTION_RESULT]: ROUND_STATES.CLOSED,
  [PHASES.SUDDEN_DEATH]: ROUND_STATES.DECISION
};

export class BattleGame {
  constructor({ settings, roster, questions, liveInfo = {}, store, now = () => Date.now() }) {
    this.store = store;
    this.now = now;
    this.questions = questions;
    this.liveInfo = liveInfo;
    this.initialRoster = roster;
    this.state = createBattleState({ settings, roster, questionIds: questions.map((q) => q.id) });
    this.round = null; // текущий раунд: { index, question, startedAt, modes, tiebreakStartedAt }
    this.extraIndex = 0;
    this.events = [];
  }

  get phase() { return this.state.phase; }

  async _go(to) {
    const res = transitionPhase(this.state, to);
    if (res.error) throw new Error(res.error);
    this.state = res.state;
    return res.changed;
  }

  async _log(event) {
    const e = { ...event, at: this.now() };
    this.events.push(e);
    await this.store.logEvent?.(e);
  }

  // Публичная часть раунда — БЕЗ correct.
  async _publish(extra = {}) {
    const r = this.round;
    await this.store.saveBattle({
      phase: this.state.phase,
      scores: this.state.scores,
      rope: this.rope(),
      currentRound: r ? {
        index: r.index,
        status: PHASE_TO_ROUND[this.state.phase] || ROUND_STATES.OPEN,
        questionId: r.question.id,
        type: r.question.type,
        optionCount: r.question.optionCount,
        durationSec: this.state.settings.questionSeconds,
        startedAt: r.startedAt,
        ...extra
      } : null,
      captains: this.state.roster.captains,
      teams: this.state.roster.teams,
      reserve: this.state.roster.reserve
    });
  }

  rope() {
    const s = this.state.settings;
    const scale = s.pointsPerQuestion * Math.max(3, Math.ceil(this.questions.length / 2));
    return ropePosition({ scoreA: this.state.scores.a, scoreB: this.state.scores.b, scale });
  }

  // Следующий вопрос основной части.
  async startNextQuestion() {
    if (this.phase === PHASES.READY || this.phase === PHASES.QUESTION_RESULT) {
      const index = this.state.rounds.filter((r) => r.kind === "main").length;
      const question = this.questions[index];
      if (!question) throw new Error("Вопросы закончились.");
      await this._go(PHASES.QUESTION_STARTING);
      this.round = { index, kind: "main", question, startedAt: this.now(), modes: {}, selfAnswers: {}, closedAt: {} };
      await this._go(PHASES.CAPTAIN_DECISION);
      await this._publish();
      await this._log({ type: "question_started", round: index });
      return this.round;
    }
    throw new Error("Нельзя начать вопрос в фазе " + this.phase);
  }

  // Капитан выбрал способ ответа. mode: "self" (+ selected) или "vote".
  async captainChoose(teamId, { mode, selected }) {
    const r = this.round;
    if (!r || this.phase !== PHASES.CAPTAIN_DECISION && this.phase !== PHASES.VOTING) throw new Error("Выбор способа сейчас недоступен.");
    if (r.modes[teamId]) return false; // идемпотентно: выбор делается один раз
    if (mode === "self") {
      if (!Array.isArray(selected) || !selected.length) throw new Error("Укажите ответ.");
      r.modes[teamId] = "self";
      r.selfAnswers[teamId] = { selected: [...selected], answeredMs: this.now() - r.startedAt };
      r.closedAt[teamId] = this.now();
    } else if (mode === "vote") {
      r.modes[teamId] = "vote";
      if (this.phase === PHASES.CAPTAIN_DECISION) await this._go(PHASES.VOTING);
      await this._publish({ voteTeams: Object.keys(r.modes).filter((t) => r.modes[t] === "vote") });
    } else throw new Error("Неизвестный способ ответа.");
    await this._log({ type: "captain_choice", round: r.index, teamId, mode });
    return true;
  }

  // Закрыть голосование команды: зафиксировать момент ответа (для скорости).
  closeVoting(teamId) {
    const r = this.round;
    if (r && r.modes[teamId] === "vote" && !r.closedAt[teamId]) r.closedAt[teamId] = this.now();
  }

  // Закрыть раунд: прочитать голоса, посчитать, применить (идемпотентно).
  async closeRound({ timedOut = false } = {}) {
    const r = this.round;
    if (!r) throw new Error("Нет открытого раунда.");
    if (this.state.rounds.some((x) => x.index === r.index && x.kind === r.kind)) return this.state.rounds.at(-1); // повтор
    const votes = await this.store.readVotes(r.index);
    const decisions = (await this.store.readDecisions?.(r.index)) || {};
    const teams = {};
    for (const id of TEAM_IDS) {
      const mode = r.modes[id] || "none";
      const eligible = eligibleVoters(this.state.roster, id);
      const own = Object.fromEntries(Object.entries(votes).filter(([uid]) => eligible.includes(uid)));
      const dec = decisions[id] || {};
      const closeAt = r.closedAt[id] ?? this.now();
      const isTimeout = timedOut && !r.closedAt[id];
      teams[id] = {
        teamId: id, mode, captainUid: this.state.roster.captains[id], eligible,
        votes: own,
        captainSelected: r.selfAnswers[id]?.selected,
        decisions: dec,
        tiebreakExpired: Boolean(r.tiebreakStartedAt) && captainTiebreakLeftMs(r.tiebreakStartedAt, this.now(), this.state.settings.captainTiebreakSeconds) === 0,
        answeredMs: r.selfAnswers[id]?.answeredMs ?? Math.max(0, closeAt - r.startedAt),
        timedOut: isTimeout || mode === "none"
      };
    }
    const record = buildRoundRecord({
      index: r.index, kind: r.kind, question: r.question,
      durationSec: this.state.settings.questionSeconds, teams, settings: this.state.settings
    });
    const applied = applyRoundResult(this.state, record);
    this.state = applied.state;
    if (this.phase !== PHASES.QUESTION_RESULT) await this._go(PHASES.QUESTION_RESULT);
    // Правильный ответ раскрывается только теперь.
    await this._publish({ correct: r.question.correct, result: { a: record.teams.a.points, b: record.teams.b.points } });
    await this._log({ type: "round_closed", round: r.index });
    return record;
  }

  // Игрок выбыл (60 с без связи или решение ведущего).
  async eliminate(uid) {
    const round = this.state.rounds.length;
    const res = eliminatePlayer(this.state.roster, uid, { roundIndex: round, liveInfo: this.liveInfo });
    if (res.error) throw new Error(res.error);
    if (!res.changed) return false;
    this.state = { ...this.state, roster: res.roster };
    for (const e of res.events) await this._log(e);
    await this._publish();
    return true;
  }

  // После основных вопросов: решающий раунд или завершение.
  async afterMainRounds() {
    if (!isGameComplete(this.state)) return "continue";
    if (needsSuddenDeath(this.state)) {
      await this._go(PHASES.SUDDEN_DEATH);
      return "sudden_death";
    }
    await this.finish();
    return "finished";
  }

  // Решающий раунд: ответы капитанов { a:{correct, ms}, b:{…} } (проверка — на стороне ведущего).
  async resolveSuddenDeath(answers) {
    const result = resolveSuddenDeathRound(answers);
    const entry = { ...result, answers, extraIndex: this.extraIndex };
    this.state = applySuddenDeathResult(this.state, entry);
    this.extraIndex++;
    await this._log({ type: "sudden_death_round", ...result });
    if (!result.next) await this.finish();
    return result;
  }

  nextExtraQuestion(bank) {
    return pickExtraQuestion(bank, this.extraIndex);
  }

  async finish({ early = false } = {}) {
    const res = finishBattle(this.state, { early });
    this.state = res.state;
    if (res.changed) {
      await this._publish({ winner: this.state.winner });
      await this._log({ type: "battle_finished", early });
    }
    return this.state;
  }
}

export function createBattleGame(options) {
  return new BattleGame(options);
}

// Реэкспорт для интерфейсов: просмотр результата спорного голосования.
export { resolveTeamAnswer };
