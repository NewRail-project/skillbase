// ui/components/battle-practical.js — таблица после Battle в комнате.
//   player  — команда вводит значения (заполняет капитан), нажимает «Проверить»;
//   screen  — проектор и наблюдатель видят задания обеих команд и итог;
//   host    — ведущий: подготовка заданий, АВТОМАТИЧЕСКАЯ проверка по ключам,
//             очки в счёт команды, панель хода.
// Логика проверки и очков — core/battle-practical.js (с тестами); здесь только
// подписки Firestore и отрисовка. Ключи ответов читает только ведущий.
import { h } from "../../shared/dom.js";
import { subscribeBattle, updateBattle } from "../../core/battle.js";
import {
  subscribeTask, subscribeSubmission, saveDraft, submitTable, setupPractical, setTaskStatus,
  loadKeys, loadTaskStatus, confirmTeamResult, saveFinalPracticalResult
} from "../../core/practical-store.js";
import { TEAMS } from "../../core/practical.js";
import { createHostController, practicalEnabled, totalScores, practicalLine } from "../../core/battle-practical.js";
import { roleInBattle } from "./battle-play.js";
import { buildPracticalPlayer, buildPracticalScreen } from "./practical.js";

const TEAM_NAME = { a: "Команда А", b: "Команда Б" };
const safe = (fn) => { try { fn?.(); } catch { /* отписка */ } };
const watch = (fn) => { try { return fn(); } catch (err) { console.warn("Практика Battle:", err); return () => {}; } };

// Строка «счёт с практикой» (одна на всех видах).
function totalsEl() {
  const el = h("p", { class: "pr-total", role: "status", hidden: "hidden" });
  return {
    el,
    paint(battle) {
      const line = practicalLine(battle);
      if (!practicalEnabled(battle) || (!battle?.practicalDone?.a && !battle?.practicalDone?.b)) { el.hidden = true; return; }
      const t = totalScores(battle);
      el.hidden = false;
      el.textContent = `Практика: А ${line.a}, Б ${line.b}. Счёт с практикой: А ${t.a} — Б ${t.b}.`;
    }
  };
}

export function mountBattlePractical({ kind, code, uid, tables = null, onToast = () => {} }) {
  if (kind === "host") return mountHost({ code, tables, onToast });
  if (kind === "screen") return mountScreen({ code });
  return mountPlayer({ code, uid });
}

// ---------- Игрок ----------

function mountPlayer({ code, uid }) {
  let battle = null;
  let team = null;
  let latestTask = null;
  let tasks = {};
  let subs = {};
  const unsubs = [];
  const getMe = () => {
    const r = roleInBattle(battle, uid);
    return { team: r.teamId, isCaptain: r.role === "captain" };
  };
  const api = {
    saveDraft: (cells) => saveDraft(code, team, latestTask, cells),
    submit: (cells) => submitTable(code, team, latestTask, cells)
  };
  const view = buildPracticalPlayer({
    api, getMe,
    submitLabel: "Проверить",
    submitConfirm: "После проверки таблицу нельзя изменить. Проверить?",
    pendingNote: "Таблица отправлена. Идёт проверка…"
  });
  const total = totalsEl();
  const el = h("section", { class: "battle-practical", hidden: "hidden", "aria-label": "Таблица после Battle" }, view.el, total.el);

  const push = () => { latestTask = tasks[team] || null; view.update({ task: latestTask, submission: subs[team] || null }); };
  function resubscribe() {
    const next = getMe().team;
    if (next === team) return;
    unsubs.splice(0).forEach(safe);
    team = next; tasks = {}; subs = {};
    if (!team || !TEAMS.includes(team)) { push(); return; }
    unsubs.push(watch(() => subscribeTask(code, team, (t) => { tasks[team] = t; push(); }, () => {})));
    unsubs.push(watch(() => subscribeSubmission(code, team, (s) => { subs[team] = s; push(); }, () => {})));
  }
  // Смена капитана или команды подхватывается раз в 2 секунды.
  const timer = setInterval(() => { resubscribe(); push(); }, 2000);
  return {
    el,
    update(b) {
      battle = b;
      el.hidden = !(practicalEnabled(b) && b?.phase === "finished");
      total.paint(b);
      if (!el.hidden) { resubscribe(); push(); }
    },
    destroy() { clearInterval(timer); unsubs.forEach(safe); view.destroy?.(); }
  };
}

// ---------- Проектор и наблюдатель ----------

function mountScreen({ code }) {
  let battle = null;
  let tasks = {};
  let subs = {};
  const unsubs = [];
  const view = buildPracticalScreen();
  const total = totalsEl();
  const el = h("section", { class: "battle-practical", hidden: "hidden", "aria-label": "Таблица после Battle" }, view.el, total.el);
  const push = () => view.update({ tasks, submissions: subs });
  let subscribed = false;
  function subscribe() {
    if (subscribed) return;
    subscribed = true;
    for (const team of TEAMS) {
      unsubs.push(watch(() => subscribeTask(code, team, (t) => { tasks = { ...tasks, [team]: t }; push(); }, () => {})));
      unsubs.push(watch(() => subscribeSubmission(code, team, (s) => { subs = { ...subs, [team]: s }; push(); }, () => {})));
    }
  }
  return {
    el,
    update(b) {
      battle = b;
      el.hidden = !(practicalEnabled(b) && b?.phase === "finished");
      total.paint(b);
      if (!el.hidden) subscribe();
    },
    destroy() { unsubs.forEach(safe); view.destroy?.(); }
  };
}

// ---------- Ведущий ----------

function mountHost({ code, tables, onToast }) {
  let battle = null;
  let tasks = {};
  let subs = {};
  let ctl = null;
  let begun = false;
  let queue = Promise.resolve();
  const unsubs = [];
  const status = h("p", { class: "pr-status", role: "status" }, "");
  const list = h("div", { class: "pr-host-teams" });
  const total = totalsEl();
  const retry = h("button", { type: "button", class: "btn secondary", hidden: "hidden" }, "Повторить подготовку таблицы");
  const el = h("section", { class: "battle-practical battle-practical-host", hidden: "hidden", "aria-label": "Таблица после Battle" },
    h("h2", {}, "Таблица после Battle"),
    h("p", { class: "muted" }, "Команды заполняют таблицу и нажимают «Проверить»: ответы сверяются автоматически, баллы за верные ячейки прибавляются к счёту команды."),
    list, total.el, status, retry);

  function paint() {
    list.replaceChildren(...TEAMS.map((team) => {
      const t = tasks[team];
      const s = subs[team];
      const state = !t || t.status === "draft" ? "готовится"
        : t.status === "confirmed" ? "проверено"
        : s?.status === "submitted" ? "проверяется…"
        : s ? "заполняет" : "ждёт";
      const r = t?.result;
      return h("p", { class: "pr-host-team", "data-team": team },
        h("b", {}, `${TEAM_NAME[team]}: `), state,
        r ? ` — ${r.score} из ${r.max} (${r.percent}%)` : "");
    }));
    total.paint(battle);
  }

  // Обработка событий последовательно: снимки приходят пачками.
  function run() {
    if (!ctl || !begun) return;
    queue = queue.then(() => ctl.process({ battle, tasks, submissions: subs }))
      .catch((err) => {
        console.error("Проверка таблицы:", err);
        status.textContent = err?.message || "Не удалось проверить таблицу. Проверьте соединение.";
        onToast(status.textContent, "error");
      });
  }

  const deps = {
    setup: (c, plan) => setupPractical(c, plan),
    taskStatus: (c, team) => loadTaskStatus(c, team),
    setStatus: (c, team, st) => setTaskStatus(c, team, st),
    loadKeys: (c, team) => loadKeys(c, team),
    confirmTeam: (c, team, ev) => confirmTeamResult(c, team, ev),
    saveFinal: (c, evs) => saveFinalPracticalResult(c, evs),
    patchBattle: (patch) => updateBattle(code, patch)
  };

  async function begin() {
    if (begun || !tables?.a || !tables?.b) return;
    begun = true;
    el.hidden = false;
    ctl = createHostController({ code, tables, deps });
    try {
      // Флаг для участников: показать таблицу после Battle.
      await updateBattle(code, { practical: { enabled: true } });
      await ctl.start();
      status.textContent = "";
      retry.hidden = true;
    } catch (err) {
      begun = false; ctl = null;
      console.error("Подготовка таблицы:", err);
      status.textContent = err?.message || "Не удалось подготовить таблицу.";
      retry.hidden = false;
      onToast(status.textContent, "error");
      return;
    }
    for (const team of TEAMS) {
      unsubs.push(watch(() => subscribeTask(code, team, (t) => { tasks = { ...tasks, [team]: t }; paint(); run(); }, () => {})));
      unsubs.push(watch(() => subscribeSubmission(code, team, (s) => { subs = { ...subs, [team]: s }; paint(); run(); }, () => {})));
    }
    unsubs.push(watch(() => subscribeBattle(code, (b) => { battle = b; paint(); run(); }, () => {})));
  }
  retry.addEventListener("click", () => { retry.hidden = true; begin(); });

  return {
    el,
    begin,
    update(b) { battle = b || battle; paint(); },
    destroy() { unsubs.forEach(safe); }
  };
}
