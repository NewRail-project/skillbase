// ui/components/battle-prep.js — панель подготовки «Командной битвы» (ТЗ §5.5, §4.1).
// Три логических шага: 1) настройки и распределение, 2) проверка и правка
// составов, 3) запуск (onStart). Игровая логика — core/battle-logic.js;
// компонент ничего не пишет в Firestore сам: результат отдаётся в onStart.
import { h } from "../../shared/dom.js";
import { avatarChip } from "./avatar.js";
import {
  normalizeSettings, pickCaptains, resolveCaptainsAfterDuel, buildRoster,
  movePlayer, setCaptain, teamSizes, createSeededRng, DEFAULT_BATTLE_SETTINGS
} from "../../core/battle-logic.js";
import { duelWinnersFor } from "../../core/duel-logic.js";

// Две команды — одинаковая структура, разные акценты (--team-a / --team-b
// из ui/css/battle.css). Номера вместо букв: «№1 / №2» на проекторе читается
// быстрее, чем «A / B». Буквенные метки data-team ("a"/"b") не меняются:
// на них завязаны распределение, переносы и тесты.
const TEAMS = {
  a: { no: "1", title: "Команда №1" },
  b: { no: "2", title: "Команда №2" }
};

// Русские числительные: «1 участник», «2 участника», «5 участников».
function plural(n, forms) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}
const PEOPLE = ["участник", "участника", "участников"];

// buildBattlePrep({ players, ranking, settings, onStart, onToast, duelsDoc })
//   players  — [{ uid, displayName }] без наблюдателей
//   ranking  — [{ uid, score }] итог основного Live (с учётом «Дуэли»)
//   settings — сохранённые настройки битвы (необязательно)
//   duelsDoc — документ «Дуэли» (local.duels). Победители за 2-е место
//              берутся из разрешённой группы (duelWinnersFor), а не
//              придумываются: панель не должна блокировать распределение,
//              если дуэль уже проведена. Если группы нет или не разрешена —
//              панель попросит провести дуэль.
export function buildBattlePrep({ players = [], ranking = [], settings = {}, onStart, onToast = () => {}, duelsDoc = null, loadBanks = null, currentTestId = "", onSaveSettings = null, hint = "" } = {}) {
  const root = h("div", { class: "panel battle-prep" });
  const name = (uid) => players.find((p) => p.uid === uid)?.displayName || uid;
  const form = { ...DEFAULT_BATTLE_SETTINGS, ...settings };
  let roster = null;
  let seed = "";
  let bankId = settings.battleTestId || "";
  let banks = [];
  if (loadBanks) loadBanks().then((list) => { banks = list || []; render(); }).catch(() => {});

  // Выбранный battleTestId / questionCount / questionSeconds сохраняются в
  // Firestore (rooms/{code}.battleSettings) при изменении, чтобы при
  // перезагрузке страницы панель восстановила их, а не сбрасывала в
  // умолчания. Остальные параметры (веса, порядок, порог) не сохраняются.
  function notify() {
    if (typeof onSaveSettings !== "function") return;
    onSaveSettings({
      battleTestId: bankId,
      questionCount: form.questionCount,
      questionSeconds: form.questionSeconds
    });
  }

  function distribute() {
    const { settings: s, errors } = normalizeSettings(form);
    if (errors.length) return onToast(errors[0], "error");
    const memberIds = players.map((p) => p.uid);
    if (memberIds.length < s.minPlayers) return onToast(`Нужно минимум ${s.minPlayers} участников, сейчас ${memberIds.length}.`, "error");
    const pick = pickCaptains(ranking.filter((r) => memberIds.includes(r.uid)));
    if (pick.error) return onToast(pick.error, "error");
    // Победители «Дуэли» берём из разрешённой группы, сверяясь по именно
    // той, где капитаны сидят вничью (pick.tied). duelWinnersFor возвращает
    // null, если группы нет или она не разрешена — тогда панель просит
    // провести дуэль. Пустой массив не подставляется: победителя не
    // придумываем.
    const winners = pick.needsDuel ? duelWinnersFor(duelsDoc, pick) : null;
    const resolved = pick.needsDuel ? resolveCaptainsAfterDuel(pick, winners || []) : pick;
    if (resolved.error) return onToast("Ничья за 2-е место: сначала проведите «Дуэль».", "error");
    const res = buildRoster({ memberIds, captains: resolved.captains, rng: createSeededRng(seed || undefined), minPlayers: s.minPlayers });
    if (res.error) return onToast(res.error, "error");
    // Позиции карточек снимаются до перерисовки (старый DOM ещё цел),
    // анимация запускается уже поверх готовых составов.
    const origins = captureOrigins();
    roster = res.roster;
    render();
    playDistribution(origins);
  }

  function apply(result) {
    if (result.error) return onToast(result.error, "error");
    roster = result.roster || roster;
    render();
  }

  // ---------- Анимация распределения ----------
  // Карточки участников вылетают из исходного списка в свои команды, по
  // дороге оставляют светящиеся частицы; в конце обе команды проявляются,
  // капитаны вспыхивают. Составы считает distribute() — анимация только
  // показывает уже готовый roster и ничего в нём не меняет.
  //
  // Запускается исключительно из distribute() по клику: составы после
  // перезагрузки страницы не восстанавливаются, поэтому эффект сам по себе
  // не повторяется. В Node (тесты) и при prefers-reduced-motion распределение
  // остаётся мгновенным — canAnimate() ниже отсекает оба случая.
  const PREP_MS = 420;   // подготовительный этап: карточки проявляются на месте
  const FLIGHT_MS = 460; // полёт одной карточки (то же число — в style гостя)
  const SPARKS = 3;      // частиц на карточку, живут только внутри полёта
  let animToken = 0;     // защита от повторного и параллельного запуска
  let animTimers = [];
  let animOverlay = null;

  function canAnimate() {
    return typeof window !== "undefined"
      && typeof document !== "undefined"
      && typeof document.body !== "undefined"
      && typeof window.matchMedia === "function"
      && typeof Element !== "undefined"
      && typeof Element.prototype.getBoundingClientRect === "function";
  }

  function prefersReduced() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches === true; }
    catch { return false; }
  }

  // Снимает эффект целиком: таймеры, оверлей и все классы состояния.
  // Вызывается из render(), поэтому любая перерисовка во время полёта
  // (перенос игрока, подгрузка списка тестов) гасит анимацию без конфликтов.
  function stopAnimation() {
    animToken++;
    for (const t of animTimers) clearTimeout(t);
    animTimers = [];
    if (animOverlay) { animOverlay.remove(); animOverlay = null; }
    for (const cls of ["bp-landing", "bp-land", "bp-pop", "bp-flash", "is-flying"]) {
      for (const el of root.querySelectorAll("." + cls)) el.classList.remove(cls);
    }
  }

  // Откуда стартует каждая карточка: пул до распределения или прошлые строки
  // при «Перераспределить». Снимается ДО render(), который старый DOM сносит.
  function captureOrigins() {
    const map = new Map();
    if (!canAnimate()) return map;
    // Два отдельных запроса вместо составного селектора: одинаково работает
    // и в браузере, и в минимальном DOM тестов.
    const seen = new Set();
    for (const sel of [".bp-pool-item", ".battle-prep-row"]) {
      for (const el of root.querySelectorAll(sel)) {
        if (seen.has(el)) continue;
        seen.add(el);
        const uid = el.getAttribute("data-uid");
        if (!uid) continue;
        try {
          const r = el.getBoundingClientRect();
          if (r && r.width) map.set(uid, r);
        } catch { /* layout недоступен — полёта не будет */ }
      }
    }
    return map;
  }

  function playDistribution(origins) {
    if (!origins.size || !canAnimate() || prefersReduced()) return;

    const teamOf = (uid) => roster.teams.a.includes(uid) ? "a"
      : roster.teams.b.includes(uid) ? "b" : "reserve";

    // Цели — уже отрисованные строки: их позиция и есть место приземления.
    const flights = [];
    for (const el of root.querySelectorAll(".battle-prep-row")) {
      const uid = el.getAttribute("data-uid");
      const from = origins.get(uid);
      if (!uid || !from) continue;
      let to = null;
      try { to = el.getBoundingClientRect(); } catch { to = null; }
      if (!to || !to.width) continue;
      flights.push({ uid, el, from, to, team: teamOf(uid) });
    }
    if (!flights.length) return;

    const token = ++animToken;
    const alive = () => token === animToken;
    const later = (fn, ms) => { animTimers.push(setTimeout(() => { if (alive()) fn(); }, ms)); };

    const overlay = h("div", { class: "bp-fly", "aria-hidden": "true" });
    document.body.appendChild(overlay);
    animOverlay = overlay;

    const out = root.querySelector(".battle-prep-out");
    if (out) out.classList.add("is-flying");

    // При многих участниках очередь не должна тянуться: ступень сжимается.
    const stagger = Math.max(40, Math.min(80, Math.floor(900 / flights.length)));

    flights.forEach((f, i) => {
      const cap = roster.captains.a === f.uid || roster.captains.b === f.uid;
      const label = name(f.uid);
      const avatar = players.find((p) => p.uid === f.uid)?.avatar || null;
      // Гость выглядит как строка списка, но живёт в оверлее и двигается
      // transform'ом — без пересчёта раскладки на каждом кадре.
      const ghost = h("div", {
        class: `bp-ghost team-${f.team}${cap ? " captain" : ""}`,
        style: `width:${Math.round(f.to.width)}px;`
          + ` transform: translate(${Math.round(f.from.left)}px, ${Math.round(f.from.top)}px);`
          + ` transition: transform ${FLIGHT_MS}ms cubic-bezier(.2,.85,.3,1);`
      },
        avatarChip(avatar, label, "bp-avatar"),
        h("span", { class: "bp-name" }, label),
        cap ? h("span", { class: "bp-role" }, "Капитан") : null);
      overlay.appendChild(ghost);

      // Строка в команде скрыта, пока карточка в пути: двойного списка нет.
      f.el.classList.add("bp-landing");

      later(() => {
        ghost.classList.add("flying");
        ghost.style.transform = `translate(${Math.round(f.to.left)}px, ${Math.round(f.to.top)}px)`;
        // Частицы создаются в момент старта и умирают вместе с карточкой —
        // постоянных DOM-элементов на частицы нет.
        for (let s = 0; s < SPARKS; s++) {
          ghost.appendChild(h("i", { class: `bp-spark bp-spark-${s}`, "aria-hidden": "true" }));
        }
      }, PREP_MS + i * stagger);

      later(() => {
        f.el.classList.remove("bp-landing");
        f.el.classList.add("bp-land");
        later(() => f.el.classList.remove("bp-land"), 360);
        ghost.remove();
      }, PREP_MS + i * stagger + FLIGHT_MS);
    });

    // Финал: команды проявляются, капитаны вспыхивают, оверлей снимается
    // и управление панелью возвращается полностью.
    const total = PREP_MS + (flights.length - 1) * stagger + FLIGHT_MS;
    later(() => {
      for (const el of root.querySelectorAll(".battle-prep-group")) {
        el.classList.add("bp-pop");
        later(() => el.classList.remove("bp-pop"), 560);
      }
      for (const el of root.querySelectorAll(".battle-prep-row")) {
        if (el.classList.contains("captain")) el.classList.add("bp-flash");
      }
      later(() => {
        for (const el of root.querySelectorAll(".bp-flash")) el.classList.remove("bp-flash");
        if (animOverlay === overlay) { overlay.remove(); animOverlay = null; }
        for (const el of root.querySelectorAll(".is-flying")) el.classList.remove("is-flying");
        animTimers = [];
      }, 900);
    }, total);
  }

  // Поля ввода чисел: значение пишется в form, а переданный attrs (минимум,
  // максимум, step) — в элемент. Важно: attrs.oninput НЕ должен переписывать
  // наш обработчик (см. weightLive), поэтому берём его отдельно и вызываем
  // после базового: сначала form[key], потом пользовательская логика
  // (например, пересчёт веса Battle так, чтобы сумма была 100%).
  const num = (key, label, attrs = {}) => {
    const userOninput = typeof attrs.oninput === "function" ? attrs.oninput : null;
    const rest = { ...attrs };
    delete rest.oninput;
    return h("label", { class: "field" }, label,
      h("input", { type: "number", value: form[key], ...rest,
        oninput: (e) => {
          form[key] = Number(e.target.value);
          if (userOninput) userOninput(e);
        }
      }));
  };

  function memberRow(uid, teamId) {
    const cap = roster.captains.a === uid || roster.captains.b === uid;
    const targets = [["a", "→ A"], ["b", "→ B"], ["reserve", "→ резерв"]].filter(([t]) => t !== teamId);
    const label = name(uid);
    const avatar = players.find((p) => p.uid === uid)?.avatar || null;
    // Капитан выделяется и цветом строки, и отдельным значком: на проекторе
    // роль должно быть видно с последнего ряда. Имя остаётся обычным текстом,
    // чтобы длинные ФИО переносились, а не распирали карточку.
    return h("li", {
      class: cap ? "battle-prep-row captain" : "battle-prep-row",
      // Метка для анимации: по ней карточка из исходного списка находится
      // её будущая строка в команде.
      "data-uid": uid
    },
      avatarChip(avatar, label, "bp-avatar"),
      h("span", { class: "bp-name", title: label }, label),
      cap ? h("span", { class: "bp-role" }, "Капитан") : null,
      cap ? null : h("span", { class: "btn-row bp-actions" },
        ...targets.map(([t, lb]) => h("button", { type: "button", class: "btn secondary small", onclick: () => apply(movePlayer(roster, uid, t)) }, lb)),
        teamId !== "reserve" ? h("button", { type: "button", class: "btn secondary small", onclick: () => apply(setCaptain(roster, teamId, uid)) }, "Капитан") : null));
  }

  // Одинаковая карточка для обеих команд: заголовок (название + число
  // участников) и список. Резерв — тот же блок без командного акцента.
  function group(title, uids, teamId) {
    const meta = TEAMS[teamId];
    return h("section", {
      class: meta ? "battle-prep-group bp-team" : "battle-prep-group bp-reserve",
      "data-team": teamId
    },
      h("header", { class: "bp-head" },
        meta ? h("span", { class: "bp-no", "aria-hidden": "true" }, meta.no) : null,
        h("div", { class: "bp-head-text" },
          h("h3", {}, title),
          h("span", { class: "bp-count" }, `${uids.length} ${plural(uids.length, PEOPLE)}`))),
      uids.length
        ? h("ul", { class: "bp-list", "aria-label": title }, ...uids.map((u) => memberRow(u, teamId)))
        : h("p", { class: "form-hint bp-none" }, teamId === "reserve" ? "Резерв пуст." : "Пока пусто."));
  }

  function render() {
    // Любая перерисовка гасит незавершённый полёт: классы состояния снимаются,
    // оверлей убирается — конфликтующих анимаций не бывает.
    stopAnimation();
    const sizes = roster ? teamSizes(roster) : null;
    root.replaceChildren(
      h("h2", {}, "Подготовка Командной битвы"),
      h("p", { class: "muted" }, `Участников: ${players.length}. Капитаны — 1-е и 2-е места Live; остальные распределяются случайно.`),
      hint ? h("p", { class: "form-hint battle-prep-hint", role: "status" }, hint) : null,
      h("fieldset", { class: "field" },
        h("label", { class: "field" }, "Набор вопросов для битвы",
          h("select", { onchange: (e) => { bankId = e.target.value; notify(); } },
            h("option", { value: "", selected: !bankId }, "Вопросы этого теста"),
            ...banks.filter((b) => b.id !== currentTestId).map((b) => h("option", { value: b.id, selected: bankId === b.id }, b.title || b.id)))),
        num("questionCount", "Количество вопросов", { min: 1, max: 50, oninput: notify }),
        num("questionSeconds", "Время на вопрос, сек", { min: 5, max: 3600, oninput: notify }),
        h("label", { class: "field" }, "Порядок вопросов",
          h("select", { onchange: (e) => { form.questionOrder = e.target.value; notify(); } },
            h("option", { value: "random", selected: form.questionOrder === "random" }, "Случайный"),
            h("option", { value: "set", selected: form.questionOrder === "set" }, "Заданный"))),
        num("teamworkThreshold", "Порог командной работы (0–1)", { min: 0.1, max: 1, step: 0.05 }),
        num("weightLive", "Вес Live в итоге (0–1)", { min: 0, max: 1, step: 0.05, oninput: (e) => { form.weightBattle = Math.round((1 - form.weightLive) * 100) / 100; notify(); } }),
        h("label", { class: "field" }, "Seed (необязательно)",
          h("input", { type: "text", maxlength: 20, value: seed, oninput: (e) => { seed = e.target.value; } }))),
      h("div", { class: "btn-row" },
        h("button", { type: "button", class: "btn primary", onclick: distribute }, roster ? "Перераспределить" : "Распределить команды")),
      // До распределения — исходное состояние: участники уже видны карточками
      // (по ним анимация стартует), но data-team нет — составов ещё нет.
      roster ? h("div", { class: "battle-prep-out" },
        h("div", { class: "battle-prep-rosters" },
          group(TEAMS.a.title, roster.teams.a, "a"),
          group(TEAMS.b.title, roster.teams.b, "b")),
        group("Общий резерв", roster.reserve, "reserve"),
        h("p", { class: "muted bp-summary" },
          `Итог: ${TEAMS.a.title} — ${sizes.a} · ${TEAMS.b.title} — ${sizes.b} · резерв — ${sizes.reserve}`),
        h("div", { class: "btn-row" },
          h("button", { type: "button", class: "btn primary", onclick: () => {
            const { settings: s, errors } = normalizeSettings(form);
            if (errors.length) return onToast(errors[0], "error");
            onStart && onStart({ settings: { ...s, ...(bankId ? { battleTestId: bankId } : {}) }, roster });
          } }, "Запустить битву")))
      : h("div", { class: "battle-prep-empty bp-pool", role: "status" },
          h("div", { class: "bp-pool-head" },
            h("p", { class: "bp-empty-title" }, "Команды ещё не распределены"),
            h("p", { class: "muted" },
              "Капитаны — 1-е и 2-е места Live, остальные участники делятся поровну. Нажмите «Распределить команды», чтобы собрать составы.")),
          h("ul", { class: "bp-pool-list", "aria-label": "Участники до распределения" },
            ...players.map((p) => h("li", { class: "bp-pool-item", "data-uid": p.uid },
              avatarChip(p.avatar, p.displayName, "bp-avatar"),
              h("span", { class: "bp-name", title: p.displayName }, p.displayName))))));
  }

  render();
  return root;
}
