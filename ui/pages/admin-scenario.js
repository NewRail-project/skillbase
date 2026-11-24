// ui/pages/admin-scenario.js — экран проигрывания сценария (#admin/scenario).
//
// Админ запускает сценарий, боты «отвечают» по шкале времени, рейтинг
// пересчитывается на месте, в конце — итог и ничьи. ВСЁ ТОЛЬКО В ПАМЯТИ
// браузера: модуль не импортирует ни Firestore, ни core/rooms.js, ни
// core/battle*.js; ни одна комната, игрок или документ не создаётся.
//
// Отрисовка инкрементальная: страница строится один раз, дальше обновляются
// только таймер, полоса, новые строки ленты и тело таблицы рейтинга —
// никакой перерисовки всей страницы (иначе экран мигает).
import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { loadCss } from "../../shared/load-css.js";
import {
  createScenarioPlayer, formatClock, randomSeed, SPEEDS, SETTING_LIMITS, DEFAULT_SETTINGS
} from "../../core/scenario-player.js";

const TICK_MS = 100;
const MAX_STEP_MS = 1000;
const OPENER_KEY = "sb:scenario-opener";

let active = null; // текущий экран — для cleanup()

export function isAdminProfile(profile) {
  return profile?.role === "admin";
}

function deniedPage() {
  return h("div", { class: "page" },
    h("div", { class: "card" },
      h("p", { class: "error-msg", role: "alert" }, "Этот раздел доступен только администраторам.")));
}

function field(id, label, input, hint) {
  return h("div", { class: "scn-field" },
    h("label", { for: id }, label),
    input,
    hint ? h("span", { class: "form-hint" }, hint) : null);
}

function numberInput(id, value, { min, max }) {
  const input = h("input", { id, type: "number", inputmode: "numeric", min: String(min), max: String(max), step: "1" });
  input.value = String(value);
  return input;
}

function mark(correct) {
  return h("span", { class: correct ? "scn-ok" : "scn-bad" }, correct ? "✓ верно" : "✗ неверно");
}

// Строит экран. Таймеры и часы подаются снаружи — это позволяет тестам
// гонять сценарий без реального времени.
export function buildScenarioView({
  player = createScenarioPlayer(),
  schedule = (fn, ms) => setInterval(fn, ms),
  unschedule = (id) => clearInterval(id),
  now = () => (typeof performance !== "undefined" ? performance.now() : Date.now())
} = {}) {
  const initial = player.snapshot().settings;
  let timerId = null;
  let lastNow = 0;
  let openedDuel = null;

  // ---------- Настройки ----------
  const botsInput = numberInput("scn-bots", initial.botCount ?? DEFAULT_SETTINGS.botCount, SETTING_LIMITS.botCount);
  const questionsInput = numberInput("scn-questions", initial.questionCount, SETTING_LIMITS.questionCount);
  const accuracyInput = numberInput("scn-accuracy", initial.accuracyPct, SETTING_LIMITS.accuracyPct);
  const seedInput = numberInput("scn-seed", initial.seed, { min: 0, max: 999999999 });
  const speedSelect = h("select", { id: "scn-speed" },
    ...SPEEDS.map(v => h("option", { value: String(v), selected: v === initial.speed }, `×${v}`)));
  const newSeedBtn = h("button", { type: "button", class: "btn secondary", id: "scn-new-seed" }, "Новый seed");
  const startBtn = h("button", { type: "button", class: "btn primary", id: "scn-start" }, "Запуск");
  const pauseBtn = h("button", { type: "button", class: "btn", id: "scn-pause", disabled: true }, "Пауза");
  const resetBtn = h("button", { type: "button", class: "btn secondary", id: "scn-reset" }, "Сбросить");
  const status = h("p", { class: "scn-status", role: "status" }, "Настройте сценарий и нажмите «Запуск».");
  const alertBox = h("p", { class: "error-msg", role: "alert" }, "");

  // ---------- Сцена ----------
  const clock = h("div", { class: "scn-clock", "aria-label": "Время сценария" }, "00:00");
  const stateBadge = h("span", { class: "badge badge-neutral" }, "Не запущен");
  const fill = h("div", { class: "scn-progress-fill" });
  fill.style.width = "0%";
  const bar = h("div", {
    class: "scn-progress", role: "progressbar", "aria-label": "Прогресс сценария",
    "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0"
  }, fill);
  const feedList = h("ul", { class: "scn-feed", role: "log", "aria-label": "Лента событий" });
  const feedEmpty = h("li", { class: "scn-empty" }, "Событий пока нет.");
  feedList.appendChild(feedEmpty);
  const autoScroll = h("input", { id: "scn-autoscroll", type: "checkbox", checked: true });
  const boardBody = h("tbody", {});
  const boardTable = h("table", { class: "scn-table" },
    h("thead", {}, h("tr", {},
      h("th", { scope: "col" }, "Место"), h("th", { scope: "col" }, "Участник"),
      h("th", { scope: "col" }, "Очки"), h("th", { scope: "col" }, "Верно"))),
    boardBody);
  const finale = h("section", { class: "panel scn-finale", "aria-label": "Итог сценария", hidden: true });

  function boardRows(rows) {
    return rows.map(r => h("tr", {},
      h("td", { class: "scn-place" }, String(r.place)),
      h("td", {}, r.name),
      h("td", {}, String(r.score)),
      h("td", {}, String(r.correctCount ?? r.correct ?? 0))));
  }

  function paintBoard(snap) {
    boardBody.replaceChildren(...boardRows(snap.board));
  }

  function appendFeed(entries) {
    if (!entries.length) return;
    if (feedEmpty.parentNode) feedEmpty.remove();
    for (const e of entries) {
      feedList.appendChild(h("li", { class: "scn-feed-item" },
        h("span", { class: "scn-feed-q" }, `Вопрос ${e.question}`), " · ",
        h("b", {}, e.bot), " — ", mark(e.correct)));
    }
    if (autoScroll.checked) feedList.scrollTop = feedList.scrollHeight;
  }

  function duelBlock(index) {
    const view = player.duel(index);
    if (!view) return h("p", { class: "form-hint" }, "Дуэль можно показать после завершения сценария.");
    const rows = view.rounds.map(r => h("li", { class: "scn-duel-round" },
      h("b", {}, `Раунд ${r.n}`), ": ",
      view.members.map(name => `${name} ${r.marks[name] ? "✓" : "✗"}`).join(" · "),
      " — ", r.winner ? `очко: ${r.winner}` : "ничья раунда"));
    const outcome = view.status === "resolved"
      ? `Порядок: ${view.order.join(" → ")}.`
      : `Ничья сохраняется: ${view.pending.join(", ")} — решение принимает преподаватель.`;
    return h("div", { class: "scn-duel", role: "group", "aria-label": "Показ дуэли" },
      h("p", { class: "form-hint" }, "Только показ: результат нигде не сохраняется."),
      h("ol", {}, ...rows),
      h("p", { class: "scn-duel-outcome" }, outcome));
  }

  function paintFinale(snap) {
    finale.hidden = false;
    const tieItems = snap.ties.map((tie, index) => {
      const holder = h("div", { class: "scn-duel-holder" });
      const btn = h("button", {
        type: "button", class: "btn secondary btn-sm", "aria-expanded": "false",
        onclick: () => {
          const open = btn.getAttribute("aria-expanded") === "true";
          btn.setAttribute("aria-expanded", open ? "false" : "true");
          holder.replaceChildren(...(open ? [] : [duelBlock(index)]));
          openedDuel = open ? null : index;
        }
      }, "Дуэль (только показ)");
      const span = tie.places.length > 1 ? `${tie.places[0]}–${tie.places[tie.places.length - 1]}` : String(tie.places[0]);
      return h("li", { class: "scn-tie" },
        h("span", {}, `${tie.members.join(", ")} — делят места ${span}`), btn, holder);
    });
    finale.replaceChildren(
      h("h2", {}, "Итоговая таблица"),
      h("div", { class: "scn-table-wrap" },
        h("table", { class: "scn-table" },
          h("thead", {}, h("tr", {},
            h("th", { scope: "col" }, "Место"), h("th", { scope: "col" }, "Участник"),
            h("th", { scope: "col" }, "Очки"), h("th", { scope: "col" }, "Верно"))),
          h("tbody", {}, ...boardRows(snap.finalBoard.map(r => ({ ...r, correctCount: r.correct })))))),
      h("h3", {}, "Ничьи"),
      tieItems.length
        ? h("ul", { class: "scn-ties" }, ...tieItems)
        : h("p", { class: "form-hint" }, "Ничьих нет: все места распределены."));
  }

  const STATUS_TEXT = {
    idle: "Не запущен", running: "Идёт", paused: "На паузе", done: "Завершён"
  };

  function paintControls(snap) {
    const live = snap.status === "running" || snap.status === "paused";
    stateBadge.textContent = STATUS_TEXT[snap.status];
    pauseBtn.disabled = !live;
    pauseBtn.textContent = snap.status === "paused" ? "Продолжить" : "Пауза";
    startBtn.disabled = live;
    for (const el of [botsInput, questionsInput, accuracyInput, seedInput, newSeedBtn]) el.disabled = live;
  }

  function paintTop(snap) {
    clock.textContent = formatClock(snap.elapsedMs);
    const pct = Math.round(snap.progress * 100);
    fill.style.width = `${pct}%`;
    bar.setAttribute("aria-valuenow", String(pct));
  }

  function repaintAll() {
    const snap = player.snapshot();
    paintTop(snap);
    paintControls(snap);
    paintBoard(snap);
  }

  // ---------- Время ----------
  function stopTimer() {
    if (timerId != null) { unschedule(timerId); timerId = null; }
  }

  function tick(dtMs) {
    let released;
    try {
      released = player.tick(dtMs);
    } catch (err) {
      console.error("Сценарий:", err);
      stopTimer();
      alertBox.textContent = "Сценарий остановился из-за ошибки. Нажмите «Сбросить» и запустите заново.";
      return;
    }
    const snap = player.snapshot();
    const answers = released.filter(e => e.type === "answer");
    if (answers.length) {
      appendFeed(answers.map(e => ({ question: e.question, bot: e.bot, correct: e.correct })));
      paintBoard(snap);
    }
    paintTop(snap);
    if (released.some(e => e.type === "finish")) {
      stopTimer();
      paintControls(snap);
      paintFinale(snap);
      status.textContent = "Сценарий завершён. Результат нигде не сохранён.";
    }
  }

  function startTimer() {
    stopTimer();
    lastNow = now();
    timerId = schedule(() => {
      const t = now();
      // Вкладка в фоне замораживает таймер: не «догоняем» часы разом.
      const dt = Math.min(Math.max(0, t - lastNow), MAX_STEP_MS);
      lastNow = t;
      tick(dt);
    }, TICK_MS);
  }

  // ---------- Действия ----------
  function readInputs() {
    return {
      botCount: botsInput.value, questionCount: questionsInput.value,
      accuracyPct: accuracyInput.value, seed: seedInput.value, speed: speedSelect.value
    };
  }

  function writeInputs(settings) {
    botsInput.value = String(settings.botCount);
    questionsInput.value = String(settings.questionCount);
    accuracyInput.value = String(settings.accuracyPct);
    seedInput.value = String(settings.seed);
  }

  function clearOutput() {
    feedList.replaceChildren(feedEmpty);
    finale.hidden = true;
    finale.replaceChildren();
    openedDuel = null;
  }

  function onStart() {
    alertBox.textContent = "";
    try {
      const { settings, notes } = player.configure(readInputs());
      writeInputs(settings);
      if (notes.length) alertBox.textContent = notes.join(" ");
      clearOutput();
      if (!player.start()) return;
      status.textContent = `Сценарий идёт: ${settings.botCount} ботов, ${settings.questionCount} вопросов, seed ${settings.seed}.`;
      repaintAll();
      startTimer();
    } catch (err) {
      console.error("Запуск сценария:", err);
      alertBox.textContent = "Не удалось запустить сценарий. Проверьте настройки и повторите.";
    }
  }

  function onPause() {
    if (!player.togglePause()) return;
    const snap = player.snapshot();
    if (snap.status === "paused") {
      stopTimer();
      status.textContent = "Пауза. Нажмите «Продолжить» или Пробел.";
    } else {
      status.textContent = "Сценарий продолжается.";
      startTimer();
    }
    paintControls(snap);
  }

  function onReset() {
    stopTimer();
    player.reset();
    clearOutput();
    alertBox.textContent = "";
    status.textContent = "Сценарий сброшен. Настройте и нажмите «Запуск».";
    repaintAll();
  }

  startBtn.addEventListener("click", onStart);
  pauseBtn.addEventListener("click", onPause);
  resetBtn.addEventListener("click", onReset);
  newSeedBtn.addEventListener("click", () => { seedInput.value = String(randomSeed()); });
  speedSelect.addEventListener("change", () => {
    player.setSpeed(speedSelect.value);
    // Смена скорости на ходу: время между тиками считается уже по новому множителю.
  });

  // Пробел — пауза. Игнорируем, когда фокус на элементе, которому пробел нужен.
  function onKeydown(event) {
    // Esc закрывает экран из любого места.
    if (event.key === "Escape") { leaveScenario(); return; }
    const tag = String(event.target?.tagName || "").toLowerCase();
    if (["input", "select", "textarea", "button", "a"].includes(tag)) return;
    if (event.key === " " || event.code === "Space") {
      const st = player.snapshot().status;
      if (st === "running" || st === "paused") { event.preventDefault?.(); onPause(); }
    }
  }

  const el = h("div", { class: "page scn-page" },
    h("div", { class: "page-head" },
      h("div", {},
        h("div", { class: "eyebrow" }, "Админ-панель"),
        h("h1", {}, "Проигрывание сценария"),
        h("p", { class: "page-sub" }, "Боты отвечают на вопросы сами. Всё происходит только в этом окне: комнаты, игроки и базы данных не затрагиваются.")),
      h("div", { class: "page-head-actions" },
        h("a", { class: "btn secondary", href: "#admin", id: "scn-back", onclick: () => markOpener() }, "← К админ-панели"))),
    h("section", { class: "panel scn-settings", "aria-label": "Настройки сценария" },
      h("div", { class: "scn-fields" },
        field("scn-bots", "Ботов", botsInput, `от ${SETTING_LIMITS.botCount.min} до ${SETTING_LIMITS.botCount.max}`),
        field("scn-questions", "Вопросов", questionsInput, `от ${SETTING_LIMITS.questionCount.min} до ${SETTING_LIMITS.questionCount.max}`),
        field("scn-accuracy", "Точность, %", accuracyInput, "доля верных ответов"),
        h("div", { class: "scn-field" },
          h("label", { for: "scn-seed" }, "Seed"), seedInput, newSeedBtn),
        field("scn-speed", "Скорость", speedSelect)),
      h("div", { class: "btn-row" }, startBtn, pauseBtn, resetBtn),
      status, alertBox),
    h("section", { class: "panel scn-stage", "aria-label": "Ход сценария" },
      h("div", { class: "scn-top" }, clock, stateBadge, bar),
      h("div", { class: "scn-grid" },
        h("section", { class: "scn-col", "aria-label": "Лента событий" },
          h("div", { class: "scn-col-head" },
            h("h2", {}, "Лента событий"),
            h("label", { class: "scn-check", for: "scn-autoscroll" }, autoScroll, " Автопрокрутка")),
          feedList),
        h("section", { class: "scn-col", "aria-label": "Живой рейтинг" },
          h("div", { class: "scn-col-head" }, h("h2", {}, "Рейтинг")),
          h("div", { class: "scn-table-wrap" }, boardTable)))),
    finale);

  function markOpener() {
    try { sessionStorage.setItem(OPENER_KEY, "1"); } catch { /* нет storage */ }
  }

  function leaveScenario() {
    markOpener();
    if (typeof window !== "undefined" && window.location) window.location.hash = "#admin";
  }

  if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("keydown", onKeydown);
  repaintAll();

  return {
    el, player, tick, onKeydown,
    controls: { startBtn, pauseBtn, resetBtn, newSeedBtn, botsInput, questionsInput, accuracyInput, seedInput, speedSelect },
    status, alertBox, feedList, boardBody, clock, finale, bar,
    destroy() {
      stopTimer();
      if (typeof document !== "undefined" && document.removeEventListener) document.removeEventListener("keydown", onKeydown);
    }
  };
}

export default async function AdminScenarioPage() {
  // Проверка роли в логике страницы: роутер уже закрывает #admin для не-админов,
  // но экран не должен полагаться только на него.
  if (!isAdminProfile(State.profile)) return deniedPage();
  try { await loadCss("ui/css/scenario.css"); }
  catch (err) { console.warn("Стили сценария не загрузились:", err); }
  if (active) active.destroy();
  active = buildScenarioView();
  return active.el;
}

export function cleanup() {
  if (active) { active.destroy(); active = null; }
}
