// ui/components/battle-screen.js — проекторный экран (ТЗ §7.5): команды,
// капитаны, вопрос, таймер, счёт, канат, число проголосовавших и итоги
// закрытых раундов. Индивидуальных ответов в публичном документе нет.
import { h } from "../../shared/dom.js";
import { buildRope } from "./battle-rope.js";
import { battleQuestionContent } from "./battle-play.js";

export function buildBattleScreen({ test, nameOf = (u) => u, now = () => Date.now() }) {
  let battle = null;
  const rope = buildRope(0);
  const scoreA = h("div", { class: "battle-score" }, "0");
  const scoreB = h("div", { class: "battle-score" }, "0");
  const capA = h("div", { class: "battle-status" }, "");
  const capB = h("div", { class: "battle-status" }, "");
  const timerEl = h("div", { class: "battle-timer" }, "");
  const body = h("div", { class: "battle-body" });
  const el = h("div", { class: "battle-view battle-screen" },
    h("div", { class: "battle-head" },
      h("div", { class: "battle-team", "data-team": "a" }, h("div", {}, "Команда A"), scoreA, capA),
      timerEl,
      h("div", { class: "battle-team", "data-team": "b" }, h("div", {}, "Команда B"), scoreB, capB)),
    rope.el, body);

  function tick() {
    const r = battle?.currentRound;
    if (!r || r.status === "closed" || battle.phase === "finished") { timerEl.textContent = ""; return; }
    const ms = r.status === "tiebreak" && r.tiebreakStartedAt
      ? r.tiebreakStartedAt + (battle.settings?.captainTiebreakSeconds ?? 15) * 1000 - now()
      : r.startedAt + r.durationSec * 1000 - now();
    const s = Math.max(0, Math.ceil(ms / 1000));
    timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function render() {
    if (!battle) { body.replaceChildren(h("p", { class: "battle-status" }, "Ожидание начала битвы…")); return; }
    scoreA.textContent = String(battle.scores?.a ?? 0);
    scoreB.textContent = String(battle.scores?.b ?? 0);
    capA.textContent = `Капитан: ${nameOf(battle.captains?.a)}`;
    capB.textContent = `Капитан: ${nameOf(battle.captains?.b)}`;
    rope.set(battle.rope || 0);
    tick();
    if (battle.phase === "finished") {
      body.replaceChildren(h("div", { class: "battle-result" },
        h("h2", {}, battle.winner ? `Победила команда ${battle.winner.toUpperCase()}` : "Ничья"),
        h("p", {}, `Итоговый счёт: ${battle.scores?.a ?? 0} : ${battle.scores?.b ?? 0}`)));
      return;
    }
    const r = battle.currentRound;
    if (battle.phase === "sudden_death" && (!r || r.kind !== "extra")) {
      body.replaceChildren(h("h2", {}, "Решающий раунд капитанов"), h("p", { class: "battle-status" }, "Счёт равный. Готовим вопрос…"));
      return;
    }
    if (!r) { body.replaceChildren(h("p", { class: "battle-status" }, "Битва скоро начнётся.")); return; }
    const meta = (battle.questions || []).find((q) => q.id === r.questionId) || { id: r.questionId };
    const content = battleQuestionContent(test, meta);
    const closed = r.status === "closed";
    const correct = closed ? (r.correct || []) : [];
    const sum = closed ? (battle.roundSummaries || []).find((s) => s.index === r.index && s.kind === (r.kind || "main")) : null;
    body.replaceChildren(...[
      r.kind === "extra" ? h("p", { class: "battle-status" }, "Решающий раунд капитанов") : null,
      h("h2", {}, content.text),
      h("ul", { class: "battle-options" }, ...content.options.map((text, i) =>
        h("li", {}, h("div", { class: "battle-option", ...(correct.includes(i) ? { "data-state": "correct" } : {}) }, text)))),
      r.status === "voting" || r.status === "answering"
        ? h("p", { class: "battle-status" }, `Проголосовали: A ${r.voted?.a?.voted ?? 0}/${r.voted?.a?.total ?? 0} · B ${r.voted?.b?.voted ?? 0}/${r.voted?.b?.total ?? 0}`) : null,
      r.status === "tiebreak" ? h("p", { class: "battle-status" }, "Капитаны решают спорные варианты…") : null,
      sum ? h("p", { class: "battle-result" }, `Очки за вопрос: A +${sum.teams.a.points.total} · B +${sum.teams.b.points.total}`) : null
    ].filter(Boolean));
  }

  let timer = null;
  render();
  return {
    el,
    update(next) {
      battle = next;
      render();
      if (!timer && typeof setInterval === "function") timer = setInterval(tick, 500);
    },
    destroy() { if (timer) clearInterval(timer); timer = null; }
  };
}
