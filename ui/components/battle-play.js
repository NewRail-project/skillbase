// ui/components/battle-play.js — экран участника «Командной битвы» (ТЗ §7.2–7.4):
// игрок, капитан, запасной, выбывший. Данные — публичный battle-документ;
// запись голосов и решений — через api (core/battle.js в приложении).
//
// Игрок не видит: чужих голосов, распределения по вариантам, правильного
// ответа до закрытия (в публичном документе их нет вовсе).
import { h } from "../../shared/dom.js";
import { buildRope } from "./battle-rope.js";

export function roleInBattle(battle, uid) {
  if (!battle || !uid) return { role: "viewer", teamId: null };
  if ((battle.eliminated || []).includes(uid)) return { role: "out", teamId: null };
  for (const id of ["a", "b"]) {
    if (battle.captains?.[id] === uid) return { role: "captain", teamId: id };
  }
  for (const id of ["a", "b"]) {
    if ((battle.teams?.[id] || []).includes(uid)) return { role: "player", teamId: id };
  }
  if ((battle.reserve || []).includes(uid)) return { role: "reserve", teamId: null };
  return { role: "viewer", teamId: null };
}

// Текст и варианты вопроса берутся из исходного теста по src (иначе из id "q{n}").
export function battleQuestionContent(test, qMeta) {
  const idx = Number.isInteger(qMeta?.src) ? qMeta.src : Number(String(qMeta?.id || "").replace(/^q/, ""));
  const q = test?.questions?.[idx];
  const options = Array.isArray(q?.options) ? q.options.map((o) => (typeof o === "string" ? o : o?.text ?? String(o))) : [];
  return { text: q?.text || "Вопрос без текста", options };
}

const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function buildBattlePlay({ uid, test, api, onToast = () => {}, now = () => Date.now(), nameOf = (u) => u }) {
  let battle = null;
  let roundKey = null; // индекс раунда + статус: сбрасывает локальный выбор
  let selection = [];
  let confirmed = null; // подтверждённый голос
  let pickSelf = false; // капитан выбрал «ответить сам» и отмечает варианты
  let tbOptions = {};
  let busy = false;

  const timerEl = h("div", { class: "battle-timer", "aria-live": "off" }, "");
  const scoreA = h("div", { class: "battle-score" }, "0");
  const scoreB = h("div", { class: "battle-score" }, "0");
  const capA = h("div", { class: "battle-status" }, "");
  const capB = h("div", { class: "battle-status" }, "");
  const teamA = h("div", { class: "battle-team", "data-team": "a" }, h("div", {}, "Команда A"), scoreA, capA);
  const teamB = h("div", { class: "battle-team", "data-team": "b" }, h("div", {}, "Команда B"), scoreB, capB);
  const rope = buildRope(0);
  const body = h("div", { class: "battle-body" });
  const el = h("div", { class: "battle-view" }, h("div", { class: "battle-head" }, teamA, timerEl, teamB), rope.el, body);

  const info = () => roleInBattle(battle, uid);
  const cr = () => battle?.currentRound || null;

  function leftMs() {
    const r = cr();
    if (!r) return 0;
    if (r.status === "tiebreak" && r.tiebreakStartedAt) {
      return r.tiebreakStartedAt + (battle.settings?.captainTiebreakSeconds ?? 15) * 1000 - now();
    }
    if (r.status === "closed") return 0;
    return r.startedAt + r.durationSec * 1000 - now();
  }
  function tick() {
    const r = cr();
    timerEl.textContent = r && r.status !== "closed" ? fmt(leftMs()) : "";
  }

  async function run(fn, okMessage) {
    if (busy) return;
    busy = true;
    try { await fn(); if (okMessage) onToast(okMessage, "success"); }
    catch (err) { onToast(err?.message || "Не удалось отправить.", "error"); }
    finally { busy = false; render(); }
  }

  function optionButtons(content, r, { multi, locked, onClick, team, marks = null }) {
    return h("ul", { class: "battle-options", style: team ? `--team-color: var(--team-${team})` : "" },
      ...content.options.map((text, i) => {
        const state = marks ? marks(i) : null;
        return h("li", {},
          h("button", {
            type: "button", class: "battle-option", "aria-pressed": String(selection.includes(i)),
            disabled: locked, ...(state ? { "data-state": state } : {}),
            onclick: () => onClick(i)
          }, h("span", { class: "battle-mark", "data-kind": multi ? "multiple" : "single" }, selection.includes(i) ? "✓" : ""), text));
      }));
  }

  function toggle(i, multi) {
    if (multi) selection = selection.includes(i) ? selection.filter((x) => x !== i) : [...selection, i].sort((x, y) => x - y);
    else selection = [i];
  }

  function voteBlock(r, content, teamId) {
    const multi = r.type === "multiple";
    const counts = r.voted?.[teamId];
    const sendVote = () => run(() => api.castVote({ roundId: r.index, teamId, selected: selection }).then(() => { confirmed = [...selection]; }), "Голос принят.");
    return h("div", {},
      optionButtons(content, r, {
        multi, locked: false, team: teamId,
        onClick: (i) => { toggle(i, multi); if (!multi) sendVote(); else render(); }
      }),
      multi ? h("div", { class: "battle-actions" },
        h("button", { type: "button", class: "btn primary", disabled: selection.length === 0, onclick: sendVote }, confirmed ? "Изменить голос" : "Подтвердить голос")) : null,
      h("p", { class: "battle-status", "aria-live": "polite" },
        counts ? `${counts.voted} из ${counts.total} проголосовали` : "",
        confirmed ? " · ваш голос принят, его можно изменить" : ""));
  }

  function captainChoice(r, content, teamId) {
    const multi = r.type === "multiple";
    if (pickSelf) {
      return h("div", {},
        optionButtons(content, r, { multi, locked: false, team: teamId, onClick: (i) => { toggle(i, multi); render(); } }),
        h("div", { class: "battle-actions" },
          h("button", { type: "button", class: "btn primary", disabled: selection.length === 0,
            onclick: () => run(() => api.makeCaptainDecision({ roundId: r.index, teamId, decision: { mode: "self", selected: selection } }), "Ответ отправлен.") }, "Отправить ответ"),
          h("button", { type: "button", class: "btn secondary", onclick: () => { pickSelf = false; selection = []; render(); } }, "Назад")));
    }
    return h("div", {},
      optionButtons(content, r, { multi, locked: true, team: teamId }),
      h("p", { class: "battle-status" }, "Вы капитан. Выберите способ ответа:"),
      h("div", { class: "battle-actions" },
        h("button", { type: "button", class: "btn primary", onclick: () => { pickSelf = true; selection = []; render(); } }, "Ответить самостоятельно"),
        h("button", { type: "button", class: "btn secondary",
          onclick: () => run(() => api.makeCaptainDecision({ roundId: r.index, teamId, decision: { mode: "vote" } }), "Голосование открыто.") }, "Открыть голосование команды")));
  }

  function tiebreakBlock(r, content, teamId) {
    const tied = r.tiebreak?.[teamId] || [];
    if (!tied.length) return h("p", { class: "battle-status" }, "Ваша команда не имеет спорных вариантов.");
    const multi = r.type === "multiple";
    if (!multi) {
      return h("div", {},
        h("p", { class: "battle-status" }, "Голоса разделились поровну. Выберите вариант:"),
        h("div", { class: "battle-actions" }, ...tied.map((i) =>
          h("button", { type: "button", class: "btn primary", onclick: () => run(() => api.makeCaptainDecision({ roundId: r.index, teamId, decision: { pick: i }, tiebreak: true }), "Решение отправлено.") }, content.options[i] || `Вариант ${i + 1}`))));
    }
    return h("div", {},
      h("p", { class: "battle-status" }, "По этим вариантам голоса разделились поровну. Включить в ответ?"),
      ...tied.map((i) => h("label", { class: "battle-option" },
        h("input", { type: "checkbox", checked: tbOptions[i] === true, onchange: (e) => { tbOptions[i] = e.target.checked; } }),
        content.options[i] || `Вариант ${i + 1}`)),
      h("div", { class: "battle-actions" },
        h("button", { type: "button", class: "btn primary",
          onclick: () => run(() => api.makeCaptainDecision({ roundId: r.index, teamId, decision: { options: Object.fromEntries(tied.map((i) => [i, tbOptions[i] === true])) }, tiebreak: true }), "Решение отправлено.") }, "Отправить решение")));
  }

  function resultBlock(r, content, who) {
    const sum = (battle.roundSummaries || []).find((s) => s.index === r.index && s.kind === (r.kind || "main"));
    const correct = r.correct || sum?.correct || [];
    const mine = who.teamId && sum?.teams?.[who.teamId];
    return h("div", {},
      optionButtons(content, r, {
        multi: r.type === "multiple", locked: true,
        marks: (i) => (correct.includes(i) ? "correct" : (mine?.selected || []).includes(i) ? "wrong" : null)
      }),
      sum ? h("div", { class: "battle-result" },
        h("p", {}, `A: +${sum.teams.a.points.total} · B: +${sum.teams.b.points.total}`),
        mine ? h("p", {}, mine.status === "resolved" ? `Ответ вашей команды учтён (+${mine.points.total}).` : "Ответ команды не засчитан.") : null) : null,
      h("p", { class: "battle-status" }, "Ждём следующий вопрос…"));
  }

  // Решающий раунд (ТЗ §13): отвечают только капитаны, командного голосования нет.
  function suddenBlock(who) {
    const r = cr();
    const last = battle.lastExtra;
    const title = h("h2", {}, "Решающий раунд капитанов");
    const lastText = last && last.next
      ? (last.reason === "same_time" ? "Время ответов совпало — следующий вопрос." : "Верного ответа не было — следующий вопрос.")
      : "";
    if (!r || r.kind !== "extra") {
      return h("div", {}, title, h("p", { class: "battle-status" }, `Счёт равный. ${lastText || "Готовим вопрос…"}`));
    }
    const meta = (battle.questions || []).find((q) => q.id === r.questionId) || { id: r.questionId };
    const content = battleQuestionContent(test, meta);
    const multi = r.type === "multiple";
    const isCap = who.role === "captain";
    if (!isCap) {
      return h("div", {}, title, h("h3", {}, content.text),
        optionButtons(content, r, { multi, locked: true }),
        h("p", { class: "battle-status" }, "Отвечают капитаны. Побеждает первый правильный ответ."));
    }
    if (confirmed) {
      return h("div", {}, title, h("h3", {}, content.text),
        optionButtons(content, r, { multi, locked: true, team: who.teamId }),
        h("p", { class: "battle-status" }, "Ответ отправлен. Ждём второго капитана…"));
    }
    return h("div", {}, title, h("h3", {}, content.text),
      optionButtons(content, r, { multi, locked: false, team: who.teamId, onClick: (i) => { toggle(i, multi); render(); } }),
      h("div", { class: "battle-actions" },
        h("button", { type: "button", class: "btn primary", disabled: selection.length === 0,
          onclick: () => run(() => api.makeCaptainDecision({ roundId: r.index, teamId: who.teamId, decision: { mode: "self", selected: selection } }).then(() => { confirmed = [...selection]; }), "Ответ отправлен.") }, "Отправить ответ")),
      h("p", { class: "battle-status" }, "Отвечайте быстрее и точнее: побеждает первый правильный ответ."));
  }

  function renderBody() {
    const who = info();
    const phase = battle.phase;
    if (phase === "sudden_death" && who.role !== "out") return suddenBlock(who);
    if (phase === "finished") {
      const w = battle.winner;
      return h("div", { class: "battle-result" },
        h("h2", {}, w ? `Победила команда ${w.toUpperCase()}` : "Ничья"),
        h("p", {}, `Итоговый счёт: A ${battle.scores?.a ?? 0} — B ${battle.scores?.b ?? 0}`));
    }
    if (who.role === "out") return h("p", { class: "battle-status" }, "Вы выбыли из битвы. Следите за ходом игры.");
    const r = cr();
    if (!r) {
      return h("div", {},
        h("p", { class: "battle-status" }, who.role === "reserve" ? "Вы в резерве: при выбытии игрока команда получит вас на замену." : "Битва скоро начнётся. Ждём первый вопрос."),
        who.teamId ? h("span", { class: "battle-chip", "data-team": who.teamId }, `Команда ${who.teamId.toUpperCase()}${who.role === "captain" ? " · капитан" : ""}`) : null);
    }
    const meta = (battle.questions || []).find((q) => q.id === r.questionId) || { id: r.questionId };
    const content = battleQuestionContent(test, meta);
    const head = h("div", { class: "battle-question" },
      h("h2", {}, content.text),
      who.teamId ? h("span", { class: "battle-chip", "data-team": who.teamId }, `Команда ${who.teamId.toUpperCase()}${who.role === "captain" ? " · капитан" : ""}`) : null,
      who.role === "reserve" ? h("span", { class: "battle-chip" }, "Резерв") : null);
    let main;
    if (r.status === "closed") main = resultBlock(r, content, who);
    else if (who.role === "reserve" || who.role === "viewer") {
      main = h("div", {}, optionButtons(content, r, { multi: r.type === "multiple", locked: true }),
        h("p", { class: "battle-status" }, "Вы наблюдаете за игрой."));
    } else {
      const mode = r.modes?.[who.teamId];
      if (r.status === "tiebreak") {
        main = who.role === "captain" ? tiebreakBlock(r, content, who.teamId)
          : h("p", { class: "battle-status" }, "Голоса разделились. Капитан принимает решение…");
      } else if (who.role === "captain" && !mode) main = captainChoice(r, content, who.teamId);
      else if (mode === "self") {
        main = h("div", {}, optionButtons(content, r, { multi: r.type === "multiple", locked: true }),
          h("p", { class: "battle-status" }, who.role === "captain" ? "Вы ответили самостоятельно." : "Капитан отвечает самостоятельно. Ваше голосование не требуется."));
      } else if (mode === "vote" && r.status !== "answering") main = voteBlock(r, content, who.teamId);
      else if (mode === "vote") main = voteBlock(r, content, who.teamId);
      else main = h("div", {}, optionButtons(content, r, { multi: r.type === "multiple", locked: true }),
        h("p", { class: "battle-status" }, "Капитан выбирает способ ответа…"));
    }
    return h("div", {}, head, main);
  }

  function render() {
    if (!battle) { body.replaceChildren(h("p", { class: "battle-status" }, "Загрузка…")); return; }
    scoreA.textContent = String(battle.scores?.a ?? 0);
    scoreB.textContent = String(battle.scores?.b ?? 0);
    const who = info();
    teamA.setAttribute("data-mine", String(who.teamId === "a"));
    teamB.setAttribute("data-mine", String(who.teamId === "b"));
    rope.set(battle.rope || 0);
    tick();
    body.replaceChildren(renderBody());
  }

  let timer = null;
  const api2 = {
    el,
    update(next) {
      const r = next?.currentRound;
      const key = r ? `${r.index}:${r.kind || "main"}` : "none";
      if (key !== roundKey) { roundKey = key; selection = []; confirmed = null; pickSelf = false; tbOptions = {}; }
      battle = next;
      render();
      if (!timer && typeof setInterval === "function") timer = setInterval(tick, 500);
    },
    destroy() { if (timer) clearInterval(timer); timer = null; }
  };
  render();
  return api2;
}
