// ui/pages/lesson-room.js — занятие внутри комнаты: панель этапов и экраны
// практики. Подключается из ui/pages/room.js двумя точками (lessonOverride /
// lessonShell). Все виды долгоживущие: их создают один раз, они сами
// слушают Firestore и обновляются на месте — перерисовка комнаты их не
// пересоздаёт (иначе мигает экран и теряется набранный текст).
import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { loadCss } from "../../shared/load-css.js";
import { loadTest } from "../../core/editor.js";
import { subscribeBattle } from "../../core/battle.js";
import { loadMaterialProgress } from "../../core/materials.js";
import {
  advanceLesson, skipLessonStage, startFinalRoom, startReinforcementRoom, loadLessonPlan, subscribeRoomState, lessonErrorText
} from "../../core/lesson-store.js";
import {
  setupPractical, setTaskStatus, loadKeys, loadReview, saveReview, returnForRevision, loadEntry, saveEntry,
  confirmResult, subscribeTask, subscribeSubmission, saveDraft, submitTable
} from "../../core/practical-store.js";
import { TEAMS } from "../../core/practical.js";
import { buildLessonBar } from "../components/lesson-bar.js";
import { buildPracticalHost, buildPracticalPlayer, buildPracticalScreen } from "../components/practical.js";

const state = { code: null, host: null, participant: null, practical: {} };

function safe(fn) { try { fn && fn(); } catch { /* отписка */ } }
// Сбой подписки не должен ронять отрисовку комнаты: вернётся пустая отписка.
function watch(fn) { try { return fn(); } catch (err) { console.error("Занятие: подписка не создана:", err); return () => {}; } }

export function disposeLesson() {
  safe(() => state.host?.destroy());
  safe(() => state.participant?.destroy());
  for (const v of Object.values(state.practical)) safe(() => v.destroy());
  state.code = null; state.host = null; state.participant = null; state.practical = {};
}

function ensureCode(code) {
  if (state.code !== code) {
    disposeLesson(); state.code = code;
    // Стили занятия — улучшение: комната работает и без них.
    Promise.resolve().then(() => loadCss("ui/css/lessons.css")).catch(() => {});
  }
}

// ---------- Панель ведущего ----------

function createHostPanel({ code, getRoom, getPlayers }) {
  const holder = h("div", { class: "lesson-bar-holder" });
  const facts = { battleFinished: false, practicalA: false, practicalB: false, finalCompleted: false, reinforcementCompleted: false };
  const ui = { busy: false, message: "", readers: null };
  const unsubs = [];
  let finalWatched = "";
  let finalUnsub = null;
  let reinfWatched = "";
  let reinfUnsub = null;
  let timer = null;

  const run = () => getRoom()?.lesson || null;
  const ctx = () => ({
    entryCompleted: getRoom()?.liveState === "completed",
    battleFinished: facts.battleFinished,
    practicalConfirmed: facts.practicalA && facts.practicalB,
    reinforcementCompleted: facts.reinforcementCompleted,
    reinforcementRoomCode: run()?.reinforcementRoomCode || "",
    finalCompleted: facts.finalCompleted
  });

  function paint() {
    const r = run();
    holder.replaceChildren(buildLessonBar({
      run: r, isHost: true, ctx: ctx(), entryCode: code, busy: ui.busy, message: ui.message, readers: ui.readers,
      handlers: {
        advance: (stage) => act("Переходим", () => advanceLesson(code, stage, ctx())),
        skip: (stage) => {
          const reason = window.prompt("Почему пропускаем этап? (необязательно)", "");
          if (reason === null) return; // отмена
          return act("Пропускаем", () => skipLessonStage(code, stage, reason || ""));
        },
        startReinforcement: () => act("Создаём комнату", async () => {
          const plan = await loadLessonPlan(r.planId);
          if (plan?.stages?.reinforcement !== true) throw new Error("В сценарии не включён этап «Закрепление материала».");
          await startReinforcementRoom({ entryCode: code, plan, lessonId: r.planId, profile: State.profile });
        }),
        startFinal: () => act("Создаём комнату", async () => {
          const plan = await loadLessonPlan(r.planId);
          if (!plan?.finalTestId) throw new Error("В сценарии не выбран итоговый тест.");
          const test = await loadTest(plan.finalTestId);
          await startFinalRoom({ entryCode: code, test, profile: State.profile });
        })
      }
    }));
  }

  async function act(label, fn) {
    if (ui.busy) return; // повторное нажатие
    ui.busy = true; ui.message = ""; paint();
    try { await fn(); }
    catch (err) {
      console.error("Занятие:", err);
      ui.message = err?.code === "stale" ? "Этап уже изменился на другом экране. Данные обновлены." : lessonErrorText(err);
    } finally { ui.busy = false; paint(); }
  }

  async function refreshReaders() {
    const r = run();
    if (!r || r.stage !== "material" || !r.materialId) { if (ui.readers) { ui.readers = null; paint(); } return; }
    const players = (getPlayers() || []).filter(p => !p.observer && p.role !== "observer");
    try {
      const flags = await Promise.all(players.map(p => loadMaterialProgress(p.uid, r.materialId).then(x => x.completed === true)));
      ui.readers = { read: flags.filter(Boolean).length, total: players.length };
      paint();
    } catch { /* прогресс — вспомогательные данные */ }
  }

  function watchFinal() {
    const finalCode = run()?.finalRoomCode || "";
    if (finalCode === finalWatched) return;
    finalWatched = finalCode;
    safe(finalUnsub); finalUnsub = null; facts.finalCompleted = false;
    if (finalCode) finalUnsub = watch(() => subscribeRoomState(finalCode, (d) => { facts.finalCompleted = d?.liveState === "completed"; paint(); }, () => {}));
  }

  function watchReinforcement() {
    const reinfCode = run()?.reinforcementRoomCode || "";
    if (reinfCode === reinfWatched) return;
    reinfWatched = reinfCode;
    safe(reinfUnsub); reinfUnsub = null; facts.reinforcementCompleted = false;
    if (reinfCode) reinfUnsub = watch(() => subscribeRoomState(reinfCode, (d) => { facts.reinforcementCompleted = d?.liveState === "completed"; paint(); }, () => {}));
  }

  // Подписки состояния этапов. Ошибки не роняют комнату — панель просто не
  // получит факт, и кнопка перехода останется закрытой с понятной причиной.
  try { unsubs.push(subscribeBattle(code, (b) => { facts.battleFinished = b?.phase === "finished"; paint(); }, () => {})); } catch { /* нет битвы */ }
  for (const team of TEAMS) {
    try { unsubs.push(subscribeTask(code, team, (t) => { facts[team === "a" ? "practicalA" : "practicalB"] = t?.status === "confirmed"; paint(); }, () => {})); } catch { /* нет заданий */ }
  }
  timer = setInterval(refreshReaders, 15000);

  return {
    el: holder,
    sync() { watchFinal(); watchReinforcement(); paint(); refreshReaders(); },
    destroy() { unsubs.forEach(safe); safe(finalUnsub); safe(reinfUnsub); if (timer) clearInterval(timer); }
  };
}

// ---------- Панель участника ----------

function createParticipantPanel({ code, getRoom, uid }) {
  const holder = h("div", { class: "lesson-bar-holder" });
  let read = null;
  let lastMaterial = "";
  let timer = null;

  async function refreshRead() {
    const id = getRoom()?.lesson?.materialId || "";
    if (!id || State.user?.isAnonymous) { read = null; return; }
    try { read = (await loadMaterialProgress(uid, id)).completed === true; lastMaterial = id; paint(); } catch { read = null; }
  }
  function paint() {
    const run = getRoom()?.lesson || null;
    const finalOwn = run?.kind === "final";
    const reinfOwn = run?.kind === "reinforcement";
    holder.replaceChildren(finalOwn
      ? h("section", { class: "lesson-bar", "aria-label": "Ход занятия", "data-stage": "final_test" },
        h("p", { class: "lb-kicker" }, "Открытое занятие"),
        h("h2", { class: "lb-title" }, "Итоговый тест"),
        h("p", { class: "lb-hint", role: "status" }, "Это заключительный этап занятия."))
      : reinfOwn
      ? h("section", { class: "lesson-bar", "aria-label": "Ход занятия", "data-stage": "reinforcement" },
        h("p", { class: "lb-kicker" }, "Открытое занятие"),
        h("h2", { class: "lb-title" }, "Закрепление материала"),
        h("p", { class: "lb-hint", role: "status" }, "Вы проходите тест закрепления материала."))
      : buildLessonBar({
        run, isHost: false,
        materialHref: run?.materialId ? `#material/${encodeURIComponent(run.materialId)}/free/${encodeURIComponent(code)}` : "",
        materialRead: read
      }));
  }
  timer = setInterval(refreshRead, 10000);
  return { el: holder, sync() { if ((getRoom()?.lesson?.materialId || "") !== lastMaterial) refreshRead(); paint(); }, destroy() { if (timer) clearInterval(timer); } };
}

// ---------- Практика ----------

function createPracticalMount(kind, { code, getRoom, getMe }) {
  const unsubs = [];
  let tasks = {};
  let subs = {};
  let view;

  if (kind === "player") {
    let team = null;
    let latestTask = null;
    const api = {
      saveDraft: (cells) => saveDraft(code, team, latestTask, cells),
      submit: (cells) => submitTable(code, team, latestTask, cells)
    };
    view = buildPracticalPlayer({ api, getMe });
    const push = () => { latestTask = tasks[team] || null; view.update({ task: latestTask, submission: subs[team] || null }); };
    const resubscribe = () => {
      const next = getMe()?.team;
      if (next === team) return;
      unsubs.splice(0).forEach(safe);
      team = next; tasks = {}; subs = {};
      if (!team || !TEAMS.includes(team)) { push(); return; }
      unsubs.push(watch(() => subscribeTask(code, team, (t) => { tasks[team] = t; push(); }, () => {})));
      unsubs.push(watch(() => subscribeSubmission(code, team, (s) => { subs[team] = s; push(); }, () => {})));
    };
    resubscribe();
    const timer = setInterval(() => { resubscribe(); push(); }, 2000); // смена капитана/команды
    return { el: view.el, sync: () => { resubscribe(); push(); }, destroy() { clearInterval(timer); unsubs.forEach(safe); view.destroy?.(); } };
  }

  const run = () => getRoom()?.lesson || {};
  if (kind === "host") {
    const api = {
      setup: async () => {
        const plan = await loadLessonPlan(run().planId);
        if (!plan) throw new Error("План занятия не найден: проверьте, что сценарий не удалён.");
        await setupPractical(code, plan);
      },
      setStatus: (team, status) => setTaskStatus(code, team, status),
      loadKeys: (team) => loadKeys(code, team),
      loadReview: () => loadReview(code),
      saveReview: (o) => saveReview(code, o),
      // Ввод ведущим на доске (battleRounds/practical_entry, только ведущий).
      loadEntry: () => loadEntry(code),
      saveEntry: (entry, tasks) => saveEntry(code, tasks, entry),
      returnForRevision: (team) => returnForRevision(code, team),
      confirm: (x) => confirmResult(code, x)
    };
    view = buildPracticalHost({ api });
  } else {
    view = buildPracticalScreen();
  }
  const push = () => view.update({ tasks, submissions: subs });
  for (const team of TEAMS) {
    unsubs.push(watch(() => subscribeTask(code, team, (t) => { tasks = { ...tasks, [team]: t }; push(); }, () => {})));
    unsubs.push(watch(() => subscribeSubmission(code, team, (s) => { subs = { ...subs, [team]: s }; push(); }, () => {})));
  }
  return { el: view.el, sync: push, destroy() { unsubs.forEach(safe); view.destroy?.(); } };
}

// ---------- Точки входа для room.js ----------

// Этап «Практика» заменяет вид комнаты. Возвращает элемент или null.
export function lessonOverride({ code, room, current, screen, getRoom, getMe }) {
  const run = room?.lesson;
  if (!run || run.kind === "final" || run.stage !== "practical") return null;
  ensureCode(code);
  const kind = screen || current === "observer" ? "screen" : current === "host" ? "host" : "player";
  const key = `practical:${kind}`;
  if (!state.practical[key]) state.practical[key] = createPracticalMount(kind, { code, getRoom, getMe });
  state.practical[key].sync();
  const children = [];
  if (!screen && kind === "host") children.push(hostPanel(code, getRoom).el);
  if (!screen && kind === "player") children.push(participantPanel(code, getRoom).el);
  children.push(state.practical[key].el);
  return h("div", { class: "room-view lesson-wrap", "data-lesson-stage": "practical" }, ...children);
}

let playersGetter = () => [];
export function setLessonPlayersGetter(fn) { playersGetter = fn; }

function hostPanel(code, getRoom) {
  if (!state.host) state.host = createHostPanel({ code, getRoom, getPlayers: () => playersGetter() });
  state.host.sync();
  return state.host;
}
function participantPanel(code, getRoom) {
  if (!state.participant) state.participant = createParticipantPanel({ code, getRoom, uid: State.user?.uid });
  state.participant.sync();
  return state.participant;
}

// Любой другой этап: обычный вид комнаты + панель занятия сверху.
// На проекторе панель не показывается (там только важное и крупное).
export function lessonShell(view, { code, room, current, screen, getRoom }) {
  const run = room?.lesson;
  if (!run || screen || !current) return view;
  ensureCode(code);
  const bar = current === "host" ? hostPanel(code, getRoom).el : participantPanel(code, getRoom).el;
  return h("div", { class: "room-view lesson-wrap", "data-lesson-stage": run.stage || "final" }, bar, view);
}
