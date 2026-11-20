// ui/components/battle-host.js — панель ведущего «Командной битвы» (ТЗ §7.1).
// Игровая логика — BattleGame (core/battle-game.js); компонент запускает
// автоматический шаг раунда и показывает состояние. Правильный ответ виден
// ведущему после закрытия вопроса.
import { h } from "../../shared/dom.js";
import { buildRope } from "./battle-rope.js";
import { battleQuestionContent } from "./battle-play.js";
import { PHASES, isGameComplete, isActivePlayer } from "../../core/battle-logic.js";

const PHASE_LABEL = {
  battle_ready: "Готовы к старту",
  question_starting: "Подготовка вопроса",
  captain_decision: "Капитаны выбирают способ ответа",
  voting: "Идёт голосование",
  captain_tiebreak: "Капитаны решают спорные варианты",
  question_result: "Результат вопроса",
  sudden_death: "Ничья: нужен решающий раунд капитанов",
  finished: "Битва завершена",
  cancelled: "Битва отменена"
};

// buildBattleHost({ game, test, players, onToast, onFinish, intervalMs, confirmFn })
//   players  — [{ uid, displayName }]
//   onFinish — async (game) => сохранить снимок в историю (вызывается один раз)
export function buildBattleHost({ game, test, players = [], onToast = () => {}, onFinish = async () => {}, getPresence = null, intervalMs = 2000, confirmFn = (m) => (typeof confirm === "function" ? confirm(m) : true) }) {
  const nameOf = (uid) => players.find((p) => p.uid === uid)?.displayName || uid;
  const rope = buildRope(game.rope());
  const body = h("div", { class: "battle-body" });
  const timerEl = h("div", { class: "battle-timer" }, "");
  const scoreA = h("div", { class: "battle-score" }, "0");
  const scoreB = h("div", { class: "battle-score" }, "0");
  const el = h("div", { class: "battle-view battle-host" },
    h("div", { class: "battle-head" },
      h("div", { class: "battle-team", "data-team": "a" }, h("div", {}, "Команда A"), scoreA),
      timerEl,
      h("div", { class: "battle-team", "data-team": "b" }, h("div", {}, "Команда B"), scoreB)),
    rope.el, body);

  let busy = false;
  let finishedHandled = false;
  let timer = null;
  let note = "";

  async function guard(fn, okMessage) {
    if (busy) return;
    busy = true;
    try { await fn(); if (okMessage) onToast(okMessage, "success"); }
    catch (err) { onToast(err?.message || "Операция не выполнена.", "error"); }
    finally { busy = false; await afterAction(); }
  }

  async function afterAction() {
    // После закрытия последнего вопроса — решающий раунд или завершение.
    if (game.phase === PHASES.QUESTION_RESULT && isGameComplete(game.state)) {
      const next = await game.afterMainRounds();
      note = next === "sudden_death" ? "Счёт равный: начинается решающий раунд капитанов." : "";
    }
    if (game.phase === PHASES.FINISHED && !finishedHandled) {
      finishedHandled = true;
      try { await onFinish(game); } catch (err) { onToast(err?.message || "Итоги не сохранены.", "error"); }
    }
    render();
  }

  async function step() {
    if (busy) return;
    busy = true;
    try {
      if (getPresence) {
        const gone = await game.trackPresence(getPresence(), game.now());
        for (const uid of gone) onToast(`Игрок ${nameOf(uid)} выбыл: нет связи.`, "info");
      }
      await game.autoStep();
    } catch (err) { onToast(err?.message || "Ошибка хода игры.", "error"); }
    finally { busy = false; await afterAction(); }
  }

  function tick() {
    const r = game.round;
    if (!r || game.phase === PHASES.QUESTION_RESULT || game.phase === PHASES.FINISHED) { timerEl.textContent = ""; return; }
    const ms = game.phase === PHASES.CAPTAIN_TIEBREAK
      ? game.tiebreakLeftMs()
      : r.startedAt + game.state.settings.questionSeconds * 1000 - game.now();
    const s = Math.max(0, Math.ceil(ms / 1000));
    timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function teamLine(id) {
    const r = game.round;
    const mode = r?.modes?.[id];
    const v = game.voted[id];
    const modeText = !r ? "" : mode === "self" ? "капитан отвечает сам" : mode === "vote" ? `${v.voted} из ${v.total} проголосовали` : "капитан выбирает";
    return h("li", {}, h("span", { class: "battle-chip", "data-team": id }, `Команда ${id.toUpperCase()}`),
      ` капитан ${nameOf(game.state.roster.captains[id])}${modeText ? " · " + modeText : ""}`);
  }

  function playersList() {
    const rs = game.state.roster;
    const active = ["a", "b"].flatMap((id) => rs.teams[id].filter((u) => isActivePlayer(rs, u)).map((u) => ({ u, id })));
    return h("details", {}, h("summary", {}, `Игроки (${active.length}) · резерв ${rs.reserve.length}`),
      h("ul", {}, ...active.map(({ u, id }) => h("li", {},
        h("span", { class: "battle-chip", "data-team": id }, id.toUpperCase()), ` ${nameOf(u)} `,
        h("button", { type: "button", class: "btn secondary small", disabled: game.phase === PHASES.FINISHED,
          onclick: () => { if (confirmFn(`Объявить игрока ${nameOf(u)} выбывшим?`)) guard(() => game.eliminate(u), "Игрок выбыл."); } }, "Выбыл")))));
  }

  function render() {
    scoreA.textContent = String(game.state.scores.a);
    scoreB.textContent = String(game.state.scores.b);
    rope.set(game.rope());
    tick();
    const phase = game.phase;
    const r = game.round;
    const parts = [h("p", { class: "battle-status" }, PHASE_LABEL[phase] || phase)];
    if (phase === PHASES.SUDDEN_DEATH) {
      const last = game.lastExtra;
      parts.push(h("div", { class: "battle-question" },
        h("h2", {}, `Решающий раунд капитанов${game.extraIndex ? ` · вопрос ${game.extraIndex + (r ? 1 : 0)}` : ""}`),
        last && last.next ? h("p", { class: "battle-status" }, last.reason === "same_time" ? "Время ответов совпало — следующий вопрос." : "Верного ответа не было — следующий вопрос.") : null,
        h("p", { class: "battle-status" }, "Капитаны отвечают самостоятельно; побеждает первый правильный ответ.")));
    }
    if (r && phase !== PHASES.FINISHED) {
      const meta = { id: r.question.id, src: r.question.src };
      const content = battleQuestionContent(test, meta);
      const closed = phase === PHASES.QUESTION_RESULT;
      parts.push(h("div", { class: "battle-question" },
        h("h2", {}, r.kind === "extra" ? content.text : `Вопрос ${r.index + 1} из ${game.questions.length}: ${content.text}`),
        h("ul", { class: "battle-options" }, ...content.options.map((text, i) =>
          h("li", {}, h("div", { class: "battle-option", ...(closed && r.question.correct.includes(i) ? { "data-state": "correct" } : {}) }, text))))));
      if (r.kind !== "extra") parts.push(h("ul", {}, teamLine("a"), teamLine("b")));
    }
    if (note) parts.push(h("p", { class: "battle-status" }, note));
    const actions = [];
    const canNext = (phase === PHASES.READY || phase === PHASES.QUESTION_RESULT) && !isGameComplete(game.state);
    if (canNext) actions.push(h("button", { type: "button", class: "btn primary", onclick: () => guard(() => game.startNextQuestion()) }, phase === PHASES.READY ? "Первый вопрос" : "Следующий вопрос"));
    if (phase === PHASES.VOTING || phase === PHASES.CAPTAIN_DECISION) {
      actions.push(h("button", { type: "button", class: "btn secondary",
        onclick: () => guard(async () => { const res = await game.closeVotingPhase(); if (!res.tiebreak) await game.closeRound(); }) }, "Закрыть голосование"));
    }
    if (phase === PHASES.CAPTAIN_TIEBREAK) {
      actions.push(h("button", { type: "button", class: "btn secondary", onclick: () => guard(() => game.closeRound()) }, "Завершить раунд"));
    }
    if (phase !== PHASES.FINISHED) {
      actions.push(h("button", { type: "button", class: "btn secondary",
        onclick: () => { if (confirmFn("Завершить битву досрочно? Незавершённый вопрос не засчитывается.")) guard(() => game.finish({ early: true })); } }, "Завершить досрочно"));
    }
    if (actions.length) parts.push(h("div", { class: "battle-actions" }, ...actions));
    if (phase === PHASES.FINISHED) {
      const w = game.state.winner;
      parts.push(h("div", { class: "battle-result" },
        h("h2", {}, w ? `Победила команда ${w.toUpperCase()}` : "Ничья"),
        h("p", {}, `Счёт: A ${game.state.scores.a} — B ${game.state.scores.b}${game.state.finishedEarly ? " (досрочно)" : ""}`)));
    }
    parts.push(playersList());
    body.replaceChildren(...parts);
  }

  render();
  return {
    el,
    start() { if (!timer) timer = setInterval(() => { tick(); step(); }, intervalMs); },
    stop() { if (timer) clearInterval(timer); timer = null; },
    step,
    render
  };
}
