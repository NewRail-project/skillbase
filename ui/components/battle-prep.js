// ui/components/battle-prep.js — панель подготовки «Командной битвы» (ТЗ §5.5, §4.1).
// Три логических шага: 1) настройки и распределение, 2) проверка и правка
// составов, 3) запуск (onStart). Игровая логика — core/battle-logic.js;
// компонент ничего не пишет в Firestore сам: результат отдаётся в onStart.
import { h } from "../../shared/dom.js";
import {
  normalizeSettings, pickCaptains, resolveCaptainsAfterDuel, buildRoster,
  movePlayer, setCaptain, teamSizes, createSeededRng, DEFAULT_BATTLE_SETTINGS
} from "../../core/battle-logic.js";

// buildBattlePrep({ players, ranking, settings, onStart, onToast, duelWinners })
//   players  — [{ uid, displayName }] без наблюдателей
//   ranking  — [{ uid, score }] итог основного Live (с учётом «Дуэли»)
//   settings — сохранённые настройки битвы (необязательно)
//   duelWinners — uid победителей существующей «Дуэли» за 2-е место
export function buildBattlePrep({ players = [], ranking = [], settings = {}, onStart, onToast = () => {}, duelWinners = [], loadBanks = null, currentTestId = "" } = {}) {
  const root = h("div", { class: "panel battle-prep" });
  const name = (uid) => players.find((p) => p.uid === uid)?.displayName || uid;
  const form = { ...DEFAULT_BATTLE_SETTINGS, ...settings };
  let roster = null;
  let seed = "";
  let bankId = settings.battleTestId || "";
  let banks = [];
  if (loadBanks) loadBanks().then((list) => { banks = list || []; render(); }).catch(() => {});

  function distribute() {
    const { settings: s, errors } = normalizeSettings(form);
    if (errors.length) return onToast(errors[0], "error");
    const memberIds = players.map((p) => p.uid);
    if (memberIds.length < s.minPlayers) return onToast(`Нужно минимум ${s.minPlayers} участников, сейчас ${memberIds.length}.`, "error");
    const pick = pickCaptains(ranking.filter((r) => memberIds.includes(r.uid)));
    if (pick.error) return onToast(pick.error, "error");
    const resolved = pick.needsDuel ? resolveCaptainsAfterDuel(pick, duelWinners) : pick;
    if (resolved.error) return onToast("Ничья за 2-е место: сначала проведите «Дуэль».", "error");
    const res = buildRoster({ memberIds, captains: resolved.captains, rng: createSeededRng(seed || undefined), minPlayers: s.minPlayers });
    if (res.error) return onToast(res.error, "error");
    roster = res.roster;
    render();
  }

  function apply(result) {
    if (result.error) return onToast(result.error, "error");
    roster = result.roster || roster;
    render();
  }

  const num = (key, label, attrs = {}) => h("label", { class: "field" }, label,
    h("input", { type: "number", value: form[key], ...attrs, oninput: (e) => { form[key] = Number(e.target.value); } }));

  function memberRow(uid, teamId) {
    const cap = roster.captains.a === uid || roster.captains.b === uid;
    const targets = [["a", "→ A"], ["b", "→ B"], ["reserve", "→ резерв"]].filter(([t]) => t !== teamId);
    return h("li", { class: "battle-prep-row" },
      h("span", { class: cap ? "chip captain" : "chip" }, name(uid) + (cap ? " (капитан)" : "")),
      cap ? null : h("span", { class: "btn-row" },
        ...targets.map(([t, label]) => h("button", { type: "button", class: "btn secondary small", onclick: () => apply(movePlayer(roster, uid, t)) }, label)),
        teamId !== "reserve" ? h("button", { type: "button", class: "btn secondary small", onclick: () => apply(setCaptain(roster, teamId, uid)) }, "Капитан") : null));
  }

  function group(title, uids, teamId) {
    return h("section", { class: "battle-prep-group", "data-team": teamId },
      h("h3", {}, `${title}: ${uids.length}`),
      h("ul", {}, ...uids.map((u) => memberRow(u, teamId))));
  }

  function render() {
    const sizes = roster ? teamSizes(roster) : null;
    root.replaceChildren(
      h("h2", {}, "Подготовка Командной битвы"),
      h("p", { class: "muted" }, `Участников: ${players.length}. Капитаны — 1-е и 2-е места Live; остальные распределяются случайно.`),
      h("fieldset", { class: "field" },
        h("label", { class: "field" }, "Набор вопросов для битвы",
          h("select", { onchange: (e) => { bankId = e.target.value; } },
            h("option", { value: "", selected: !bankId }, "Вопросы этого теста"),
            ...banks.filter((b) => b.id !== currentTestId).map((b) => h("option", { value: b.id, selected: bankId === b.id }, b.title || b.id)))),
        num("questionCount", "Количество вопросов", { min: 1, max: 50 }),
        num("questionSeconds", "Время на вопрос, сек", { min: 5, max: 3600 }),
        h("label", { class: "field" }, "Порядок вопросов",
          h("select", { onchange: (e) => { form.questionOrder = e.target.value; } },
            h("option", { value: "random", selected: form.questionOrder === "random" }, "Случайный"),
            h("option", { value: "set", selected: form.questionOrder === "set" }, "Заданный"))),
        num("teamworkThreshold", "Порог командной работы (0–1)", { min: 0.1, max: 1, step: 0.05 }),
        num("weightLive", "Вес Live в итоге (0–1)", { min: 0, max: 1, step: 0.05, oninput: (e) => { form.weightLive = Number(e.target.value); form.weightBattle = Math.round((1 - form.weightLive) * 100) / 100; } }),
        h("label", { class: "field" }, "Seed (необязательно)",
          h("input", { type: "text", maxlength: 20, value: seed, oninput: (e) => { seed = e.target.value; } }))),
      h("div", { class: "btn-row" },
        h("button", { type: "button", class: "btn primary", onclick: distribute }, roster ? "Перераспределить" : "Распределить команды")),
      roster ? h("div", { class: "battle-prep-rosters" },
        group("Команда A", roster.teams.a, "a"),
        group("Команда B", roster.teams.b, "b"),
        group("Общий резерв", roster.reserve, "reserve"),
        h("p", { class: "muted" }, `A: ${sizes.a} · B: ${sizes.b} · резерв: ${sizes.reserve}`),
        h("div", { class: "btn-row" },
          h("button", { type: "button", class: "btn primary", onclick: () => {
            const { settings: s, errors } = normalizeSettings(form);
            if (errors.length) return onToast(errors[0], "error");
            onStart && onStart({ settings: { ...s, ...(bankId ? { battleTestId: bankId } : {}) }, roster });
          } }, "Запустить битву"))) : null);
  }

  render();
  return root;
}
