// ui/components/battle-screen.js — экран Battle для ведущего и наблюдателя
// (и для проектора): команды А и Б, эмблемы, капитаны, крупный счёт, текущий
// вопрос, статистика голосования и правильных ответов, составы команд и общий
// резерв. Только просмотр: ни одной кнопки управления битвой здесь нет.
//
// Данные — публичный battle-документ. Правильных ответов и личных голосов в
// нём до закрытия раунда нет, поэтому экран не может их показать.
//
// Обновление точечное (экран не перерисовывается на каждый голос):
//   · счёт — анимированная смена числа;
//   · статистика — ширина полос и подписи;
//   · вопрос — пересборка только при смене раунда/статуса;
//   · составы — пересборка только при смене состава или имён/аватаров.
import { h } from "../../shared/dom.js";
import { withSvg, avatarChip } from "./avatar.js";
import { battleQuestionContent } from "./battle-play.js";
import { isFullyCorrect } from "../../core/battle-logic.js";

const TEAMS = ["a", "b"];
const TEAM_NAME = { a: "Команда А", b: "Команда Б" };
const LETTERS = ["А", "Б", "В", "Г", "Д", "Е", "Ж", "З"];

// Эмблемы команд: разные силуэты (щит / шестиугольник), чтобы команды
// различались не только цветом. Строки собраны из констант — без данных.
const EMBLEM = {
  a: '<svg viewBox="0 0 64 72" aria-hidden="true"><path d="M32 3 59 13v21c0 18-11 30-27 35C16 64 5 52 5 34V13z" fill="currentColor" opacity=".18" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M32 16 47 24v11c0 9-6 15-15 19-9-4-15-10-15-19V24z" fill="none" stroke="currentColor" stroke-width="2.5"/><text x="32" y="43" text-anchor="middle" font-size="22" font-weight="800" fill="currentColor" font-family="Inter,system-ui,sans-serif">А</text></svg>',
  b: '<svg viewBox="0 0 64 72" aria-hidden="true"><path d="M32 3 58 18v36L32 69 6 54V18z" fill="currentColor" opacity=".18" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M32 16 47 25v22l-15 9-15-9V25z" fill="none" stroke="currentColor" stroke-width="2.5"/><text x="32" y="43" text-anchor="middle" font-size="22" font-weight="800" fill="currentColor" font-family="Inter,system-ui,sans-serif">Б</text></svg>'
};

const fmtNum = (n) => String(Math.round((Number(n) || 0) * 100) / 100);
const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const setVar = (el, k, v) => { if (el.style?.setProperty) el.style.setProperty(k, v); else if (el.style) el.style[k] = v; };

// Плавная смена числа: без перерисовки узла, только textContent.
function animateNumber(el, to, state) {
  const from = state.v;
  state.v = to;
  if (state.raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(state.raf);
  if (from === undefined || from === to || reducedMotion() || typeof requestAnimationFrame !== "function") {
    el.textContent = fmtNum(to);
    return;
  }
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const dur = 700;
  const step = (t) => {
    const k = Math.min(1, ((t ?? Date.now()) - t0) / dur);
    el.textContent = fmtNum(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    state.raf = k < 1 ? requestAnimationFrame(step) : 0;
  };
  state.raf = requestAnimationFrame(step);
  el.setAttribute("data-bump", "1");
  setTimeout(() => el.removeAttribute("data-bump"), 700);
}

// buildBattleScreen({ test, nameOf, avatarOf, now, title, controls })
//   avatarOf(uid) → "preset:<id>" | null
//   controls — [{ label, onClick?, href?, kind }] в шапке (закрыть, назад)
export function buildBattleScreen({ test, nameOf = (u) => u, avatarOf = () => null, now = () => Date.now(), title = "Режим Battle", controls = [], fullscreen = true }) {
  let battle = null;
  let questionKey = null;
  let rosterSig = null;
  let timer = null;
  const numState = { a: {}, b: {} };

  // ---- шапка ----
  const phaseEl = h("span", { class: "bs-phase" }, "");
  const ctrlBox = h("div", { class: "bs-controls" });
  const fsBtn = h("button", { type: "button", class: "bs-btn", "data-role": "fullscreen" }, "На весь экран");
  const rootRef = { el: null };
  const fsSupported = typeof document !== "undefined" && typeof document.documentElement?.requestFullscreen === "function";
  const onFsChange = () => { fsBtn.textContent = document.fullscreenElement ? "Выйти из полного экрана" : "На весь экран"; };
  fsBtn.addEventListener("click", () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else rootRef.el?.requestFullscreen?.();
    } catch { /* браузер не разрешил */ }
  });
  if (fullscreen && fsSupported) { ctrlBox.appendChild(fsBtn); document.addEventListener?.("fullscreenchange", onFsChange); }
  for (const c of controls) {
    ctrlBox.appendChild(c.href
      ? h("a", { class: `bs-btn ${c.kind || ""}`.trim(), href: c.href }, c.label)
      : h("button", { type: "button", class: `bs-btn ${c.kind || ""}`.trim(), onclick: c.onClick }, c.label));
  }
  const top = h("header", { class: "bs-top" },
    h("div", { class: "bs-brand" }, "Skillbase"),
    h("h1", { class: "bs-title" }, title, " ", phaseEl),
    ctrlBox);

  // ---- команды ----
  const teamEls = {};
  for (const id of TEAMS) {
    const score = h("div", { class: "bs-score", "aria-live": "polite" }, "0");
    const roster = h("ul", { class: "bs-roster", "aria-label": `Состав: ${TEAM_NAME[id]}` });
    const emblem = withSvg(h("div", { class: "bs-emblem" }), EMBLEM[id]);
    teamEls[id] = {
      score, roster,
      panel: h("section", { class: "bs-team", "data-team": id, "aria-label": TEAM_NAME[id] },
        emblem, h("h2", { class: "bs-team-name" }, TEAM_NAME[id]), roster)
    };
  }

  // ---- центр: капитаны, счёт, вопрос, статистика, резерв ----
  const capEls = {};
  for (const id of TEAMS) {
    const av = h("span", { class: "bs-cap-avatar" });
    const nm = h("span", { class: "bs-cap-name" }, "—");
    capEls[id] = { av, nm, key: null, card: h("div", { class: "bs-captain", "data-team": id },
      av, h("span", { class: "bs-cap-text" }, h("span", { class: "bs-cap-label" }, `Капитан ${id === "a" ? "А" : "Б"}`), nm)) };
  }
  const timerNum = h("div", { class: "bs-timer-num" }, "");
  const timerEl = h("div", { class: "bs-timer", role: "timer" }, timerNum);
  const scoreRow = h("div", { class: "bs-scoreboard" },
    h("div", { class: "bs-scorebox", "data-team": "a" }, h("span", { class: "bs-scorebox-label" }, TEAM_NAME.a), teamEls.a.score),
    timerEl,
    h("div", { class: "bs-scorebox", "data-team": "b" }, h("span", { class: "bs-scorebox-label" }, TEAM_NAME.b), teamEls.b.score));
  const questionBox = h("div", { class: "bs-question" });

  const statEls = {};
  for (const id of TEAMS) {
    const fill = h("span", { class: "bs-bar-fill" });
    const bar = h("div", { class: "bs-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0", "aria-label": `Голосование: ${TEAM_NAME[id]}` }, fill);
    const vote = h("div", { class: "bs-stat-vote" }, "");
    const mode = h("div", { class: "bs-stat-mode" }, "");
    const correct = h("div", { class: "bs-stat-correct" }, "");
    const result = h("div", { class: "bs-stat-result" }, "");
    statEls[id] = { fill, bar, vote, mode, correct, result,
      el: h("div", { class: "bs-stat", "data-team": id },
        h("div", { class: "bs-stat-head" }, h("b", {}, TEAM_NAME[id]), mode), bar, vote, correct, result) };
  }
  const stats = h("div", { class: "bs-stats" }, statEls.a.el, statEls.b.el);
  const reserveList = h("ul", { class: "bs-reserve-list", "aria-label": "Общий резерв" });
  const reserveEmpty = h("p", { class: "bs-reserve-empty" }, "Резерв пуст");
  const reserve = h("section", { class: "bs-reserve" }, h("h2", { class: "bs-reserve-title" }, "Общий резерв"), reserveList, reserveEmpty);

  const center = h("div", { class: "bs-center" },
    h("div", { class: "bs-captains" }, capEls.a.card, capEls.b.card),
    scoreRow, questionBox, stats, reserve);
  const el = h("div", { class: "bs battle-view battle-screen", "data-phase": "wait" }, top,
    h("div", { class: "bs-main" }, teamEls.a.panel, center, teamEls.b.panel));
  rootRef.el = el;

  // ---------- обновление ----------
  const member = (uid) => ({ name: nameOf(uid), avatar: avatarOf(uid) });

  function personRow(uid, extra = {}) {
    const m = member(uid);
    return h("li", { class: "bs-person", ...(extra.state ? { "data-state": extra.state } : {}) },
      avatarChip(m.avatar, m.name),
      h("span", { class: "bs-person-name", title: m.name }, m.name),
      extra.tag ? h("span", { class: "bs-person-tag" }, extra.tag) : null);
  }

  function renderRosters() {
    const b = battle;
    const sig = JSON.stringify([
      b.teams, b.reserve, b.eliminated, b.substituted, b.captains,
      [...(b.teams?.a || []), ...(b.teams?.b || []), ...(b.reserve || []), b.captains?.a, b.captains?.b].map((u) => `${nameOf(u)}|${avatarOf(u) || ""}`)
    ]);
    if (sig === rosterSig) return;
    rosterSig = sig;
    const out = new Set(b.eliminated || []);
    const subs = new Set(b.substituted || []);
    for (const id of TEAMS) {
      const members = b.teams?.[id] || [];
      teamEls[id].roster.replaceChildren(...members.map((u) => personRow(u, {
        state: out.has(u) ? "out" : u === b.captains?.[id] ? "captain" : null,
        tag: out.has(u) ? "выбыл" : u === b.captains?.[id] ? "капитан" : subs.has(u) ? "замена" : null
      })));
      const cap = b.captains?.[id];
      const c = capEls[id];
      const key = `${cap}|${nameOf(cap)}|${avatarOf(cap) || ""}`;
      if (c.key !== key) {
        c.key = key;
        c.nm.textContent = cap ? nameOf(cap) : "не назначен";
        c.av.replaceChildren(cap ? avatarChip(avatarOf(cap), nameOf(cap)) : "");
      }
    }
    const res = b.reserve || [];
    reserveList.replaceChildren(...res.map((u) => personRow(u)));
    reserveEmpty.hidden = res.length > 0;
    reserveList.hidden = res.length === 0;
  }

  function renderQuestion() {
    const b = battle;
    const r = b.currentRound;
    if (b.phase === "finished") {
      questionBox.replaceChildren(h("div", { class: "bs-result" },
        h("h2", {}, b.winner ? `Победила ${TEAM_NAME[b.winner]}` : "Ничья"),
        h("p", {}, `Итоговый счёт: ${fmtNum(b.scores?.a)} : ${fmtNum(b.scores?.b)}`)));
      return;
    }
    if (b.phase === "sudden_death" && (!r || r.kind !== "extra")) {
      questionBox.replaceChildren(h("h2", { class: "bs-q-text" }, "Решающий раунд капитанов"), h("p", { class: "bs-note" }, "Счёт равный. Готовим вопрос…"));
      return;
    }
    if (!r) { questionBox.replaceChildren(h("p", { class: "bs-note" }, "Битва скоро начнётся.")); return; }
    const meta = (b.questions || []).find((q) => q.id === r.questionId) || { id: r.questionId };
    const content = battleQuestionContent(test, meta);
    const closed = r.status === "closed";
    const correct = closed ? (r.correct || []) : [];
    const total = (b.questions || []).length;
    questionBox.replaceChildren(
      h("p", { class: "bs-q-meta" }, r.kind === "extra" ? "Решающий раунд капитанов" : `Вопрос ${r.index + 1}${total ? ` из ${total}` : ""}`),
      h("h2", { class: "bs-q-text" }, content.text),
      h("ul", { class: "bs-options" }, ...content.options.map((text, i) =>
        h("li", { class: "bs-option", ...(correct.includes(i) ? { "data-state": "correct" } : {}) },
          h("span", { class: "bs-option-letter" }, LETTERS[i] || String(i + 1)), h("span", { class: "bs-option-text" }, text)))));
  }

  const MODE_TEXT = (r, id) => {
    if (!r || r.kind === "extra") return "";
    const m = r.modes?.[id];
    if (r.status === "tiebreak") return "капитан решает спор";
    if (r.status === "closed") return m === "self" ? "капитан ответил сам" : m === "vote" ? "ответ по голосованию" : "";
    return m === "self" ? "капитан отвечает сам" : m === "vote" ? "идёт голосование" : "капитан выбирает способ";
  };

  function renderStats() {
    const b = battle;
    const r = b.currentRound;
    const closed = r?.status === "closed";
    const sum = r && closed ? (b.roundSummaries || []).find((s) => s.index === r.index && s.kind === (r.kind || "main")) : null;
    for (const id of TEAMS) {
      const s = statEls[id];
      const v = r?.voted?.[id];
      const pct = v && v.total > 0 ? Math.round((v.voted / v.total) * 100) : 0;
      s.fill.style.width = `${pct}%`;
      s.bar.setAttribute("aria-valuenow", String(pct));
      const voteText = v ? `Проголосовали: ${v.voted} из ${v.total} · ${pct}%` : "Голосование: —";
      if (s.vote.textContent !== voteText) s.vote.textContent = voteText;
      const mode = MODE_TEXT(r, id);
      if (s.mode.textContent !== mode) s.mode.textContent = mode;
      const mainDone = (b.roundSummaries || []).filter((x) => (x.kind || "main") === "main").length;
      const corr = `Верных ответов: ${b.correctAnswers?.[id] ?? 0}${mainDone ? ` из ${mainDone}` : ""}`;
      if (s.correct.textContent !== corr) s.correct.textContent = corr;
      let res = "";
      const t = sum?.teams?.[id];
      if (t) {
        if (t.status !== "resolved") res = "Ответ не засчитан";
        else {
          const full = isFullyCorrect({ selected: t.selected || [], correct: sum.correct || [] });
          res = `${full ? "Верно" : (t.points?.total > 0 ? "Частично верно" : "Неверно")} · +${fmtNum(t.points?.total)}`;
        }
      }
      if (s.result.textContent !== res) s.result.textContent = res;
    }
  }

  function tick() {
    const r = battle?.currentRound;
    if (!r || r.status === "closed" || battle.phase === "finished") { timerNum.textContent = ""; setVar(timerEl, "--p", "0"); return; }
    const total = r.status === "tiebreak" ? (battle.settings?.captainTiebreakSeconds ?? 15) : r.durationSec;
    const ms = r.status === "tiebreak" && r.tiebreakStartedAt
      ? r.tiebreakStartedAt + total * 1000 - now()
      : r.startedAt + r.durationSec * 1000 - now();
    const text = fmtClock(ms);
    if (timerNum.textContent !== text) timerNum.textContent = text;
    setVar(timerEl, "--p", String(Math.max(0, Math.min(100, Math.round((ms / (total * 1000)) * 100)))));
    timerEl.setAttribute("data-urgent", ms <= 5000 ? "1" : "0");
  }

  const PHASE = { finished: "· финал", sudden_death: "· решающий раунд" };

  function render() {
    if (!battle) {
      questionBox.replaceChildren(h("p", { class: "bs-note" }, "Ожидание начала битвы…"));
      return;
    }
    el.setAttribute("data-phase", battle.phase || "wait");
    phaseEl.textContent = PHASE[battle.phase] || "";
    for (const id of TEAMS) animateNumber(teamEls[id].score, Number(battle.scores?.[id]) || 0, numState[id]);
    renderRosters();
    const r = battle.currentRound;
    const key = `${battle.phase}|${r ? `${r.index}:${r.kind || "main"}:${r.status}:${r.questionId}` : "none"}|${(battle.roundSummaries || []).length}`;
    if (key !== questionKey) { questionKey = key; renderQuestion(); }
    renderStats();
    tick();
  }

  render();
  return {
    el,
    update(next) {
      battle = next;
      render();
      if (!timer && typeof setInterval === "function") timer = setInterval(tick, 500);
    },
    // Имена и аватары могли догрузиться позже битвы: перерисовать составы.
    refresh() { if (battle) { rosterSig = null; renderRosters(); } },
    destroy() {
      if (timer) clearInterval(timer);
      timer = null;
      for (const id of TEAMS) if (numState[id].raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(numState[id].raf);
      document.removeEventListener?.("fullscreenchange", onFsChange);
    }
  };
}
