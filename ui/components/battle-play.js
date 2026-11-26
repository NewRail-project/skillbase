// ui/components/battle-play.js — экран участника «Командной битвы» (ТЗ §7.2–7.4):
// игрок, капитан, запасной, выбывший. Данные — публичный battle-документ;
// запись голосов и решений — через api (core/battle.js в приложении).
//
// Игрок не видит: чужих голосов, распределения по вариантам, правильного
// ответа до закрытия (в публичном документе их нет вовсе).
import { h } from "../../shared/dom.js";
import { buildRope } from "./battle-rope.js";
import { createScoreFxTracker, limitEffects, teamStatus } from "../../core/score-fx.js";
import { createScoreFxPlayer, animateNumber } from "./battle-fx.js";
import { buildBattleSummary, outcomeOf, scoreLine } from "../../core/battle-summary.js";
import { battleSummaryView } from "./battle-summary-view.js";
import { createBattleTimer } from "./battle-timer.js";

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
// Вопрос раунда по id: основной (battle.questions) или решающий
// (battle.extraQuestions, подготовленные заранее для ничьей).
export function findBattleQuestion(battle, id) {
  return (battle?.questions || []).find((q) => q.id === id)
    || (battle?.extraQuestions || []).find((q) => q.id === id)
    || { id };
}

export function battleQuestionContent(test, qMeta) {
  // Подготовленные вопросы несут текст и варианты прямо в публичном документе
  // (без правильных ответов); обычные — берутся из теста по номеру src.
  if (typeof qMeta?.text === "string" && Array.isArray(qMeta.options)) {
    return { text: qMeta.text || "Вопрос без текста", options: qMeta.options.map((o) => (typeof o === "string" ? o : o?.text ?? String(o))) };
  }
  const idx = Number.isInteger(qMeta?.src) ? qMeta.src : Number(String(qMeta?.id || "").replace(/^q/, ""));
  const q = test?.questions?.[idx];
  const options = Array.isArray(q?.options) ? q.options.map((o) => (typeof o === "string" ? o : o?.text ?? String(o))) : [];
  return { text: q?.text || "Вопрос без текста", options };
}

export function buildBattlePlay({ uid, test, api, onToast = () => {}, now = () => Date.now(), nameOf = (u) => u }) {
  let battle = null;
  let roundKey = null; // индекс раунда + статус: сбрасывает локальный выбор
  let selection = [];
  let confirmed = null; // подтверждённый голос
  let pickSelf = false; // капитан выбрал «ответить сам» и отмечает варианты
  let tbOptions = {};
  let busy = false;

  // Таймер раунда — общая реализация со экраном наблюдателя и ведущим
  // (ui/components/battle-timer.js): остаток, «тик», цвет, звук окончания.
  const roundTimer = createBattleTimer({ now, className: "bs-timer battle-timer" });
  const scoreA = h("div", { class: "battle-score" }, "0");
  const scoreB = h("div", { class: "battle-score" }, "0");
  const capA = h("div", { class: "battle-status" }, "");
  const capB = h("div", { class: "battle-status" }, "");
  // Что сейчас делает команда (активная — подсвечена).
  const stA = h("div", { class: "battle-team-state", "aria-live": "polite" }, "");
  const stB = h("div", { class: "battle-team-state", "aria-live": "polite" }, "");
  const teamA = h("div", { class: "battle-team", "data-team": "a" }, h("div", {}, "Команда A"), scoreA, capA, stA);
  const teamB = h("div", { class: "battle-team", "data-team": "b" }, h("div", {}, "Команда B"), scoreB, capB, stB);
  const numState = { a: {}, b: {} };
  const fxTracker = createScoreFxTracker();
  const fxLayer = h("div", { class: "bs-fx-layer", "aria-hidden": "true" });
  const rope = buildRope(0);
  const body = h("div", { class: "battle-body" });
  const el = h("div", { class: "battle-view battle-play" }, h("div", { class: "battle-head" }, teamA, roundTimer.el, teamB), rope.el, body, fxLayer);
  const fxPlayer = createScoreFxPlayer({ layer: fxLayer, scoreOf: (t) => (t === "a" ? scoreA : scoreB), panelOf: (t) => (t === "a" ? teamA : teamB) });
  const paintScores = (b) => {
    animateNumber(scoreA, Number(b.scores?.a) || 0, numState.a);
    animateNumber(scoreB, Number(b.scores?.b) || 0, numState.b);
    for (const [id, st, box] of [["a", stA, teamA], ["b", stB, teamB]]) {
      const t = teamStatus(b, id);
      st.textContent = t.label;
      box.setAttribute("data-active", String(t.active));
    }
  };
  let countsEl = null;   // узел «N из M проголосовали»: обновляется без пересборки тела
  let countsTeam = null;
  let lastBodyKey = null;

  const info = () => roleInBattle(battle, uid);
  const cr = () => battle?.currentRound || null;

  function tick() {
    roundTimer.update({
      round: cr(),
      settings: battle?.settings || null,
      phase: battle?.phase || null
    });
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

  const sameSet = (x, y) => Boolean(x) && x.length === y.length && x.every((v, i) => v === y[i]);
  const countsText = (r, teamId) => {
    const c = r?.voted?.[teamId];
    return c ? `${c.voted} из ${c.total} проголосовали` : "";
  };

  // Голосование игрока: выбрать вариант → подтвердить → при необходимости
  // изменить до закрытия. Чужих голосов и правильного ответа здесь нет.
  function voteBlock(r, content, teamId) {
    const multi = r.type === "multiple";
    const sendVote = () => run(() => api.castVote({ roundId: r.index, teamId, selected: selection }).then(() => { confirmed = [...selection]; }), "Голос принят.");
    const unchanged = sameSet(confirmed, selection);
    const mineText = (confirmed || []).map((i) => content.options[i] || `Вариант ${i + 1}`).join(", ");
    const status = !confirmed
      ? "Вы ещё не проголосовали."
      : unchanged
        ? `Голос отправлен: ${mineText}. Его можно изменить до закрытия голосования.`
        : "Выбор изменён, но ещё не отправлен.";
    countsEl = h("span", { class: "battle-counts" }, countsText(r, teamId));
    countsTeam = teamId;
    return h("div", {},
      optionButtons(content, r, {
        multi, locked: false, team: teamId,
        onClick: (i) => { toggle(i, multi); render(); }
      }),
      h("div", { class: "battle-actions battle-confirm" },
        h("button", { type: "button", class: "btn primary", disabled: busy || selection.length === 0 || unchanged, onclick: sendVote },
          confirmed ? "Изменить голос" : "Подтвердить голос")),
      h("p", { class: "battle-status battle-vote-status", "data-sent": confirmed ? "1" : "0", "aria-live": "polite" }, status),
      h("p", { class: "battle-status" }, countsEl));
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
    const meta = findBattleQuestion(battle, r.questionId);
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

  // Запасной: статус и очередь на замену. Когда игрока заменят, документ
  // битвы переведёт запасного в состав команды — следующий кадр update()
  // сам покажет интерфейс полноценного игрока.
  function reserveCard() {
    const queue = (battle.reserve || []).filter((x) => !(battle.substituted || []).includes(x));
    const place = queue.indexOf(uid) + 1;
    return h("div", { class: "battle-reserve-card", "data-role": "reserve" },
      h("span", { class: "battle-chip" }, "Запасной"),
      h("p", { class: "battle-status" }, "Вы в резерве и пока не голосуете."),
      h("p", { class: "battle-status" }, place > 0
        ? `Очередь на замену: ${place} из ${queue.length}. Если игрок выбудет, вы займёте его место автоматически.`
        : "Если игрок выбудет, вы займёте его место автоматически."));
  }

  function renderBody() {
    const who = info();
    const phase = battle.phase;
    if (phase === "sudden_death" && who.role !== "out") return suddenBlock(who);
    if (phase === "finished") {
      // Исход и счёт — из тех же функций, что у экрана наблюдателя и проектора.
      const w = outcomeOf(battle).winnerId;
      const sc = scoreLine(battle);
      return h("div", { class: "battle-result" },
        h("h2", {}, w ? `Победила команда ${w.toUpperCase()}` : "Ничья"),
        h("p", {}, `Итоговый счёт: A ${sc.a} — B ${sc.b}`),
        battleSummaryView(buildBattleSummary({ battle, nameOf }), { open: false }));
    }
    if (who.role === "out") return h("p", { class: "battle-status" }, "Вы выбыли из битвы. Следите за ходом игры.");
    const r = cr();
    if (!r) {
      return h("div", {},
        who.role === "reserve" ? reserveCard() : h("p", { class: "battle-status" }, "Битва скоро начнётся. Ждём первый вопрос."),
        who.teamId ? h("span", { class: "battle-chip", "data-team": who.teamId }, `Команда ${who.teamId.toUpperCase()}${who.role === "captain" ? " · капитан" : ""}`) : null);
    }
    const meta = findBattleQuestion(battle, r.questionId);
    const content = battleQuestionContent(test, meta);
    const head = h("div", { class: "battle-question" },
      h("h2", {}, content.text),
      who.teamId ? h("span", { class: "battle-chip", "data-team": who.teamId }, `Команда ${who.teamId.toUpperCase()}${who.role === "captain" ? " · капитан" : ""}`) : null,
      who.role === "reserve" ? h("span", { class: "battle-chip" }, "Резерв") : null);
    let main;
    if (r.status === "closed") main = resultBlock(r, content, who);
    else if (who.role === "reserve" || who.role === "viewer") {
      main = h("div", {}, optionButtons(content, r, { multi: r.type === "multiple", locked: true }),
        who.role === "reserve" ? reserveCard() : h("p", { class: "battle-status" }, "Вы наблюдаете за игрой."));
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
    paintScores(battle);
    capA.textContent = battle.captains?.a ? `Капитан: ${nameOf(battle.captains.a)}` : "";
    capB.textContent = battle.captains?.b ? `Капитан: ${nameOf(battle.captains.b)}` : "";
    const who = info();
    teamA.setAttribute("data-mine", String(who.teamId === "a"));
    teamB.setAttribute("data-mine", String(who.teamId === "b"));
    rope.set(battle.rope || 0);
    tick();
    countsEl = null;
    body.replaceChildren(renderBody());
  }

  // Ключ «тела»: всё, что меняет разметку, кроме счётчика голосов и очков.
  // Если ключ тот же, обновляем только числа — без пересборки вариантов.
  function bodyKey(b) {
    const r = b?.currentRound;
    const w = roleInBattle(b, uid);
    return JSON.stringify([
      b?.phase, w, r ? [r.index, r.kind, r.status, r.questionId, r.modes, r.tiebreak, r.correct] : null,
      (b?.roundSummaries || []).length, b?.winner, b?.reserve, b?.substituted, b?.lastExtra,
      b?.captains?.a, b?.captains?.b
    ]);
  }
  function patchLive(next) {
    paintScores(next);
    rope.set(next.rope || 0);
    if (countsEl && countsTeam) countsEl.textContent = countsText(next.currentRound, countsTeam);
    tick();
  }

  let timer = null;
  const api2 = {
    el,
    update(next) {
      const r = next?.currentRound;
      const key = r ? `${r.index}:${r.kind || "main"}` : "none";
      if (key !== roundKey) { roundKey = key; selection = []; confirmed = null; pickSelf = false; tbOptions = {}; }
      const before = battle ? info().role : null;
      const prevKey = lastBodyKey;
      battle = next;
      const nowRole = info();
      // Запасного ввели в игру: интерфейс игрока включается сам.
      if (before === "reserve" && (nowRole.role === "player" || nowRole.role === "captain")) {
        onToast(`Вы заменили выбывшего игрока и теперь играете за команду ${nowRole.teamId.toUpperCase()}.`, "success");
      }
      // Эффекты начисления — только по НОВЫМ раундам (первый снимок не играется).
      fxPlayer.play(limitEffects(fxTracker.consume(next), 4));
      lastBodyKey = bodyKey(next);
      if (prevKey !== null && prevKey === lastBodyKey && !busy) patchLive(next);
      else render();
      if (!timer && typeof setInterval === "function") timer = setInterval(tick, 500);
    },
    destroy() { if (timer) clearInterval(timer); timer = null; fxPlayer.destroy(); }
  };
  render();
  return api2;
}
