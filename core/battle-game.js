// core/battle-game.js — контроллер хода игры «Командной битвы» на стороне
// ведущего. Связывает чистую логику (battle-logic.js) и хранилище.
//
// Хранилище передаётся снаружи (core/battle.js в приложении, заглушка в
// тестах), поэтому модуль не импортирует Firebase и проверяется в Node.
//
// Приватность (ТЗ §7.3, §21.1):
//   • правильные ответы — только в памяти ведущего и в battleKeys;
//   • полные записи раундов (кто как ответил) — store.saveRound → host-only;
//   • в публичный документ уходят только итоги раундов команды и счётчики
//     «проголосовало N из M» — без распределения голосов.
//
// Интерфейс store:
//   saveBattle(patch)                 публичный документ rooms/{code}/battle
//   saveRound(record)                 host-only: полная запись раунда
//   loadRounds() → [record]           host-only: для восстановления
//   readVotes(i) → { uid: {selected, at} }
//   readChoices(i) → { teamId: {mode, selected?, atMs?} }   выбор способа ответа
//   readDecisions(i) → { teamId: {pick?|options?} }         решения спорных
//   logEvent(event)
import {
  PHASES, TEAM_IDS, transitionPhase, createBattleState, applyRoundResult,
  buildRoundRecord, eligibleVoters, eliminatePlayer, finishBattle,
  isGameComplete, needsSuddenDeath, resolveSuddenDeathRound, applySuddenDeathResult,
  pickExtraQuestion, ropePosition, captainTiebreakLeftMs, resolveTeamAnswer, votedCount,
  isFullyCorrect, connectionState, isActivePlayer
} from "./battle-logic.js";

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
  // Решающий раунд: статус answering, чтобы капитаны могли писать ответ
  // тем же документом решения, что и в основной части (правила Firestore).
  [PHASES.SUDDEN_DEATH]: ROUND_STATES.ANSWERING
};

// Публичная выжимка раунда: итог команды, но не личные ответы.
export function summarizeRound(record) {
  return {
    index: record.index,
    kind: record.kind,
    type: record.type,
    correct: record.correct,
    teams: Object.fromEntries(TEAM_IDS.map((id) => {
      const t = record.teams[id];
      return [id, { mode: t.mode, status: t.status, selected: t.selected, points: t.points, voters: t.voters }];
    }))
  };
}

export class BattleGame {
  constructor({ settings, roster, questions, extraQuestions = [], liveInfo = {}, store, now = () => Date.now() }) {
    this.store = store;
    this.now = now;
    this.questions = questions;
    // Решающие вопросы, подготовленные заранее (набор «1-е место»); пусто —
    // прежнее поведение: банк основных вопросов по кругу.
    this.extras = Array.isArray(extraQuestions) ? extraQuestions : [];
    this.liveInfo = liveInfo;
    this.initialRoster = roster;
    this.state = createBattleState({ settings, roster, questionIds: questions.map((q) => q.id) });
    this.round = null; // { index, kind, question, startedAt, modes, selfAnswers, closedAt, tiebreakStartedAt, tied }
    this.extraIndex = 0;
    this.events = [];
    this.voted = { a: { voted: 0, total: 0 }, b: { voted: 0, total: 0 } };
    this.lastExtra = null; // итог последнего решающего вопроса (для экранов)
  }

  get phase() { return this.state.phase; }

  // Восстановление после перезагрузки страницы ведущего.
  // doc — публичный battle-документ, rounds — полные записи из store.loadRounds().
  static restore({ doc, questions, extraQuestions = [], rounds = [], liveInfo = {}, store, now }) {
    const roster = {
      captains: doc.captains, teams: doc.teams, reserve: doc.reserve || [],
      substituted: doc.substituted || [], eliminated: doc.eliminated || [],
      availableFrom: doc.availableFrom || {}, availableTo: doc.availableTo || {}
    };
    const g = new BattleGame({ settings: doc.settings, roster, questions, extraQuestions, liveInfo, store, now });
    g.initialRoster = doc.initialRoster || roster;
    g.state = {
      ...g.state,
      phase: doc.phase,
      rounds: [...rounds].sort((x, y) => x.index - y.index),
      scores: doc.scores || { a: 0, b: 0 },
      bonuses: doc.bonuses || { a: 0, b: 0 },
      correctAnswers: doc.correctAnswers || { a: 0, b: 0 },
      suddenDeath: {
        rounds: Array.isArray(doc.suddenDeath?.rounds) ? doc.suddenDeath.rounds : [],
        winner: doc.suddenDeath?.winner ?? null
      },
      winner: doc.winner ?? null,
      tie: Boolean(doc.tie),
      finishedEarly: Boolean(doc.finishedEarly)
    };
    g.extraIndex = doc.extraIndex || 0;
    g.lastExtra = doc.lastExtra || null;
    const cr = doc.currentRound;
    if (cr && g.phase !== PHASES.READY && g.phase !== PHASES.FINISHED) {
      const question = [...questions, ...extraQuestions].find((q) => q.id === cr.questionId) || questions[cr.index];
      g.round = {
        index: cr.index, kind: cr.kind || "main", question, startedAt: cr.startedAt,
        modes: cr.modes || {}, selfAnswers: {}, closedAt: cr.closedAt || {},
        tiebreakStartedAt: cr.tiebreakStartedAt || null, tied: cr.tiebreak || {}
      };
    }
    return g;
  }

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

  rope() {
    const s = this.state.settings;
    const scale = s.pointsPerQuestion * Math.max(3, Math.ceil(this.questions.length / 2));
    return ropePosition({ scoreA: this.state.scores.a, scoreB: this.state.scores.b, scale });
  }

  // Публичная часть — БЕЗ правильных ответов и личных голосов.
  async _publish(extra = {}) {
    const r = this.round;
    const rs = this.state.roster;
    await this.store.saveBattle({
      phase: this.state.phase,
      scores: this.state.scores,
      bonuses: this.state.bonuses,
      correctAnswers: this.state.correctAnswers,
      rope: this.rope(),
      captains: rs.captains,
      teams: rs.teams,
      reserve: rs.reserve,
      substituted: rs.substituted,
      eliminated: rs.eliminated,
      availableFrom: rs.availableFrom,
      availableTo: rs.availableTo,
      roundSummaries: this.state.rounds.map(summarizeRound),
      suddenDeath: {
        winner: this.state.suddenDeath.winner,
        rounds: this.state.suddenDeath.rounds.map((x) => ({ reason: x.reason, winner: x.winner ?? null, next: Boolean(x.next) }))
      },
      extraIndex: this.extraIndex,
      lastExtra: this.lastExtra,
      winner: this.state.winner,
      tie: Boolean(this.state.tie),
      finishedEarly: this.state.finishedEarly,
      currentRound: r ? {
        index: r.index,
        kind: r.kind,
        status: PHASE_TO_ROUND[this.state.phase] || ROUND_STATES.OPEN,
        questionId: r.question.id,
        type: r.question.type,
        optionCount: r.question.optionCount,
        durationSec: this.state.settings.questionSeconds,
        startedAt: r.startedAt,
        modes: r.modes,
        closedAt: r.closedAt,
        tiebreakStartedAt: r.tiebreakStartedAt,
        tiebreak: r.tied,
        voted: this.voted,
        ...extra
      } : null
    });
  }

  async startNextQuestion() {
    if (this.phase !== PHASES.READY && this.phase !== PHASES.QUESTION_RESULT) {
      throw new Error("Нельзя начать вопрос в фазе " + this.phase);
    }
    const index = this.state.rounds.filter((r) => r.kind === "main").length;
    const question = this.questions[index];
    if (!question) throw new Error("Вопросы закончились.");
    await this._go(PHASES.QUESTION_STARTING);
    this.round = { index, kind: "main", question, startedAt: this.now(), modes: {}, selfAnswers: {}, closedAt: {}, tiebreakStartedAt: null, tied: {} };
    this.voted = { a: { voted: 0, total: eligibleVoters(this.state.roster, "a").length }, b: { voted: 0, total: eligibleVoters(this.state.roster, "b").length } };
    await this._go(PHASES.CAPTAIN_DECISION);
    await this._publish();
    await this._log({ type: "question_started", round: index });
    return this.round;
  }

  // Капитан выбрал способ ответа. mode: "self" (+ selected) или "vote".
  // atMs — серверное время решения (для скорости); иначе — текущее время.
  async captainChoose(teamId, { mode, selected }, atMs) {
    const r = this.round;
    if (!r || (this.phase !== PHASES.CAPTAIN_DECISION && this.phase !== PHASES.VOTING)) throw new Error("Выбор способа сейчас недоступен.");
    if (r.modes[teamId]) return false; // выбор делается один раз
    const at = Number.isFinite(atMs) ? atMs : this.now();
    if (mode === "self") {
      if (!Array.isArray(selected) || !selected.length) throw new Error("Укажите ответ.");
      r.modes[teamId] = "self";
      r.selfAnswers[teamId] = { selected: [...selected], answeredMs: Math.max(0, at - r.startedAt) };
      r.closedAt[teamId] = at;
    } else if (mode === "vote") {
      r.modes[teamId] = "vote";
      if (this.phase === PHASES.CAPTAIN_DECISION) await this._go(PHASES.VOTING);
    } else throw new Error("Неизвестный способ ответа.");
    await this._publish();
    await this._log({ type: "captain_choice", round: r.index, teamId, mode });
    return true;
  }

  // Применить выбор капитанов из хранилища (идемпотентно; вызывает ведущий по таймеру).
  async syncCaptainChoices() {
    const r = this.round;
    if (!r || (this.phase !== PHASES.CAPTAIN_DECISION && this.phase !== PHASES.VOTING)) return 0;
    const choices = (await this.store.readChoices?.(r.index)) || {};
    let applied = 0;
    for (const id of TEAM_IDS) {
      const c = choices[id];
      if (!c || r.modes[id]) continue;
      try {
        if (await this.captainChoose(id, c, c.atMs)) applied++;
      } catch { /* некорректное решение игнорируется — капитан может не успеть */ }
    }
    return applied;
  }

  // Обновить счётчики «проголосовало N из M» (ТЗ §8.3) — публикуется только число.
  async refreshVoteCounts() {
    const r = this.round;
    if (!r || this.phase !== PHASES.VOTING) return this.voted;
    const votes = (await this.store.readVotes(r.index)) || {};
    const next = {};
    for (const id of TEAM_IDS) next[id] = votedCount(votes, eligibleVoters(this.state.roster, id));
    const same = TEAM_IDS.every((id) => next[id].voted === this.voted[id].voted && next[id].total === this.voted[id].total);
    this.voted = next;
    if (!same) await this._publish();
    return next;
  }

  // Голосовавшие команды закончили (всё проголосовали или ведущий закрыл).
  // Фиксирует момент ответа и, если есть спор, переводит игру в tiebreak.
  async closeVotingPhase() {
    const r = this.round;
    if (!r || (this.phase !== PHASES.VOTING && this.phase !== PHASES.CAPTAIN_DECISION)) return { tiebreak: false };
    const votes = (await this.store.readVotes(r.index)) || {};
    const tied = {};
    for (const id of TEAM_IDS) {
      if (r.modes[id] !== "vote") continue;
      if (!r.closedAt[id]) r.closedAt[id] = this.now();
      const eligible = eligibleVoters(this.state.roster, id);
      const own = Object.fromEntries(Object.entries(votes).filter(([uid]) => eligible.includes(uid)));
      const res = resolveTeamAnswer({
        type: r.question.type, optionCount: r.question.optionCount, votes: own, eligible,
        decisions: {}, tiebreakExpired: false
      });
      if (res.status === "tiebreak") tied[id] = res.tied;
    }
    if (Object.keys(tied).length) {
      r.tied = tied;
      r.tiebreakStartedAt = this.now();
      if (this.phase === PHASES.CAPTAIN_DECISION) await this._go(PHASES.VOTING);
      await this._go(PHASES.CAPTAIN_TIEBREAK);
      await this._publish();
      await this._log({ type: "tiebreak_started", round: r.index, teams: Object.keys(tied) });
      return { tiebreak: true, tied };
    }
    return { tiebreak: false };
  }

  // Сколько осталось капитану на спор.
  tiebreakLeftMs() {
    const r = this.round;
    if (!r?.tiebreakStartedAt) return 0;
    return captainTiebreakLeftMs(r.tiebreakStartedAt, this.now(), this.state.settings.captainTiebreakSeconds);
  }

  closeVoting(teamId) {
    const r = this.round;
    if (r && r.modes[teamId] === "vote" && !r.closedAt[teamId]) r.closedAt[teamId] = this.now();
  }

  // Закрыть раунд: прочитать голоса и решения, посчитать, применить (идемпотентно).
  async closeRound({ timedOut = false } = {}) {
    const r = this.round;
    if (!r) throw new Error("Нет открытого раунда.");
    const done = this.state.rounds.find((x) => x.index === r.index && x.kind === r.kind);
    if (done) return done; // повторное событие
    const votes = (await this.store.readVotes(r.index)) || {};
    const decisions = (await this.store.readDecisions?.(r.index)) || {};
    const tiebreakExpired = Boolean(r.tiebreakStartedAt) && this.tiebreakLeftMs() === 0;
    const teams = {};
    for (const id of TEAM_IDS) {
      const mode = r.modes[id] || "none";
      const eligible = eligibleVoters(this.state.roster, id);
      const own = Object.fromEntries(Object.entries(votes).filter(([uid]) => eligible.includes(uid)));
      const closeAt = r.closedAt[id] ?? this.now();
      const isTimeout = timedOut && !r.closedAt[id];
      teams[id] = {
        teamId: id, mode, captainUid: this.state.roster.captains[id], eligible,
        votes: own,
        captainSelected: r.selfAnswers[id]?.selected,
        decisions: decisions[id] || {},
        tiebreakExpired,
        answeredMs: r.selfAnswers[id]?.answeredMs ?? Math.max(0, closeAt - r.startedAt),
        timedOut: isTimeout || mode === "none"
      };
    }
    const record = buildRoundRecord({
      index: r.index, kind: r.kind, question: r.question,
      durationSec: this.state.settings.questionSeconds, teams, settings: this.state.settings
    });
    this.state = applyRoundResult(this.state, record).state;
    if (this.phase !== PHASES.QUESTION_RESULT) await this._go(PHASES.QUESTION_RESULT);
    await this.store.saveRound?.(record);
    // Правильный ответ раскрывается только теперь.
    await this._publish({ correct: r.question.correct });
    await this._log({ type: "round_closed", round: r.index });
    return record;
  }

  // Один шаг автоматического хода раунда (вызывается ведущим по таймеру ~2 с).
  // Возвращает: "idle" | "waiting" | "timeout" | "closed" | "tiebreak".
  // Порядок: подтянуть выбор капитанов → обновить счётчики → время вышло? →
  // все ответили? → спор → закрытие. Операции идемпотентны, шаг можно повторять.
  async autoStep() {
    const r = this.round;
    if (this.phase === PHASES.SUDDEN_DEATH) return this.suddenStep();
    if (!r) return "idle";
    if (this.phase === PHASES.CAPTAIN_DECISION || this.phase === PHASES.VOTING) {
      await this.syncCaptainChoices();
      if (this.phase === PHASES.VOTING) await this.refreshVoteCounts();
      const left = r.startedAt + this.state.settings.questionSeconds * 1000 - this.now();
      if (left <= 0) { await this.closeRound({ timedOut: true }); return "timeout"; }
      const ready = TEAM_IDS.every((id) => r.modes[id] === "self"
        || (r.modes[id] === "vote" && this.voted[id].voted >= this.voted[id].total));
      if (ready) {
        const res = await this.closeVotingPhase();
        if (res.tiebreak) return "tiebreak";
        await this.closeRound();
        return "closed";
      }
      return "waiting";
    }
    if (this.phase === PHASES.CAPTAIN_TIEBREAK) {
      const decisions = (await this.store.readDecisions?.(r.index)) || {};
      const decided = Object.keys(r.tied).every((id) => decisions[id] && Object.keys(decisions[id]).length > 0);
      if (decided || this.tiebreakLeftMs() === 0) { await this.closeRound(); return "closed"; }
      return "waiting";
    }
    return "idle";
  }

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

  async afterMainRounds() {
    if (!isGameComplete(this.state)) return "continue";
    if (needsSuddenDeath(this.state)) {
      await this._go(PHASES.SUDDEN_DEATH);
      this.round = null; // основной раунд закрыт; решающий создаётся startSuddenDeathRound
      await this._publish();
      return "sudden_death";
    }
    await this.finish();
    return "finished";
  }

  // Результат решающего вопроса: answers = { a:{correct, ms}, b:{correct, ms} }.
  async resolveSuddenDeath(answers) {
    const result = resolveSuddenDeathRound(answers);
    const entry = { ...result, answers, extraIndex: this.extraIndex };
    this.state = applySuddenDeathResult(this.state, entry);
    this.extraIndex++;
    this.lastExtra = { reason: result.reason, winner: result.winner, next: result.next };
    this.round = null;
    await this._log({ type: "sudden_death_round", ...result });
    if (!result.next) await this.finish();
    else await this._publish();
    return result;
  }

  // Новый решающий вопрос. Банк вопросов повторяется по кругу — лимита нет (ТЗ §13).
  // Номер раунда продолжает основной: questions.length + extraIndex.
  async startSuddenDeathRound() {
    if (this.phase !== PHASES.SUDDEN_DEATH) throw new Error("Решающий раунд сейчас недоступен.");
    if (this.round) return this.round;
    const question = this.nextExtraQuestion(this.questions);
    if (!question) throw new Error("Нет вопросов для решающего раунда.");
    const index = this.questions.length + this.extraIndex;
    this.round = { index, kind: "extra", question, startedAt: this.now(), modes: {}, selfAnswers: {}, closedAt: {}, tiebreakStartedAt: null, tied: {} };
    this.voted = { a: { voted: 0, total: 0 }, b: { voted: 0, total: 0 } };
    await this._publish();
    await this._log({ type: "sudden_death_started", round: index });
    return this.round;
  }

  // Один шаг решающего раунда: ждём ответы обоих капитанов или конец времени.
  // Побеждает первый ПРАВИЛЬНЫЙ ответ; обе ошибки или равное время — следующий вопрос.
  async suddenStep() {
    if (this.phase !== PHASES.SUDDEN_DEATH) return "idle";
    if (!this.round) { await this.startSuddenDeathRound(); return "started"; }
    const r = this.round;
    const choices = (await this.store.readChoices?.(r.index)) || {};
    const answers = {};
    let answered = 0;
    for (const id of TEAM_IDS) {
      const c = choices[id];
      if (c && c.mode === "self" && Array.isArray(c.selected) && c.selected.length) {
        answered++;
        const ms = Math.max(0, (Number.isFinite(c.atMs) ? c.atMs : this.now()) - r.startedAt);
        answers[id] = { correct: isFullyCorrect({ selected: c.selected, correct: r.question.correct }), ms };
      } else answers[id] = { correct: false, ms: Infinity };
    }
    const left = r.startedAt + this.state.settings.questionSeconds * 1000 - this.now();
    if (answered < TEAM_IDS.length && left > 0) return "waiting";
    await this.resolveSuddenDeath(answers);
    return this.phase === PHASES.FINISHED ? "finished" : "next";
  }

  // Выбывание по связи (ТЗ §6.1, §23): presence = { uid: lastSeenMs }.
  // Игрок без сигнала дольше окна восстановления (60 с + пропущенные пульсы)
  // считается выбывшим; идемпотентно. Нет метки — не выбываем.
  async trackPresence(presence = {}, nowMs = this.now()) {
    if (this.phase === PHASES.READY || this.phase === PHASES.FINISHED || this.phase === PHASES.CANCELLED) return [];
    const dropped = [];
    const rs = this.state.roster;
    for (const id of TEAM_IDS) {
      for (const uid of rs.teams[id]) {
        if (!isActivePlayer(this.state.roster, uid)) continue;
        const seen = presence[uid];
        if (!Number.isFinite(seen)) continue;
        const st = connectionState({ lastSeenMs: seen, nowMs, graceMs: this.state.settings.reconnectMs });
        if (st === "dropped") dropped.push(uid);
      }
    }
    const done = [];
    for (const uid of dropped) {
      try { if (await this.eliminate(uid)) done.push(uid); } catch { /* уже выбыл */ }
    }
    return done;
  }

  nextExtraQuestion(bank) {
    return pickExtraQuestion(this.extras.length ? this.extras : bank, this.extraIndex);
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

export { resolveTeamAnswer };
