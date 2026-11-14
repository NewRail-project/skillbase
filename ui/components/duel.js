// ui/components/duel.js — «Дуэль» перед финалом: два лидера, пошаговое
// сравнение ответов по вопросам. Раунд выигрывает тот, кто ответил верно,
// когда соперник ошибся или пропустил; иначе — ничья раунда.
// Чистая логика раундов живёт в core/duel-logic.js — она же используется
// разрешением ничьих итогового рейтинга; здесь только анимация.
import { h } from "../../shared/dom.js";
import { duelRounds } from "../../core/duel-logic.js";
import { animateNumber } from "./leaderboard.js";

export const DUEL_STEP_MS = 1100;

export { duelRounds };

const MARK = { true: "✓", false: "✗", null: "–" };
const MARK_LABEL = { true: "верно", false: "неверно", null: "пропуск" };

export function buildDuel(a, b, { avatar, onDone } = {}) {
  const { rounds, winsA, winsB } = duelRounds(a, b);
  const rows = h("ol", { class: "duel-rounds" });
  const tallyA = h("span", { class: "duel-tally-num" }, "0");
  const tallyB = h("span", { class: "duel-tally-num" }, "0");
  let done = false;
  const timers = [];
  const finish = () => { if (done) return; done = true; timers.forEach(clearTimeout); onDone?.(); };

  const side = (row, tally, cls) => h("div", { class: `duel-side ${cls}` },
    avatar ? avatar(row) : null,
    h("b", { class: "duel-name" }, row.name || "Участник"),
    h("span", { class: "duel-total" }, `${row.score ?? 0} б.`),
    h("span", { class: "duel-tally" }, "раундов: ", tally));

  const banner = h("div", { class: "duel-banner", role: "status", hidden: true });
  const skip = h("button", { type: "button", class: "btn secondary duel-skip", onclick: finish }, "Пропустить");
  const el = h("section", { class: "panel duel", "aria-label": "Дуэль лидеров" },
    h("div", { class: "panel-head" }, h("h2", {}, "Дуэль лидеров"), skip),
    h("div", { class: "duel-head" }, side(a, tallyA, "duel-a"), h("span", { class: "duel-vs", "aria-hidden": "true" }, "VS"), side(b, tallyB, "duel-b")),
    rows, banner);

  const winnerText = () => {
    // После разрешения ничьей места уникальны: показываем лидера по месту,
    // а не «Ничья — места делятся» для строк с равными баллами.
    if (typeof a.place === "number" && typeof b.place === "number"
      && a.place !== b.place) {
      return `Впереди ${(a.place < b.place ? a : b).name}`;
    }
    if ((a.score ?? 0) === (b.score ?? 0)) return "Ничья — места делятся!";
    return `Впереди ${(a.score ?? 0) > (b.score ?? 0) ? a.name : b.name}`;
  };

  let shownA = 0;
  let shownB = 0;
  const reducedMotion = typeof window !== "undefined" && window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const addRound = (round, index) => {
    rows.appendChild(h("li", { class: `duel-round win-${round.winner}` },
      h("span", { class: `duel-mark m-${round.a}`, "aria-label": MARK_LABEL[round.a] }, MARK[round.a]),
      h("span", { class: "duel-q" }, `Вопрос ${index + 1}`),
      h("span", { class: `duel-mark m-${round.b}`, "aria-label": MARK_LABEL[round.b] }, MARK[round.b])));
    if (round.winner === "a") { animateNumber(tallyA, shownA, shownA + 1, { dur: 300 }); shownA += 1; }
    if (round.winner === "b") { animateNumber(tallyB, shownB, shownB + 1, { dur: 300 }); shownB += 1; }
  };
  const showBanner = () => {
    banner.hidden = false;
    banner.textContent = winnerText();
    timers.push(setTimeout(finish, 2200));
  };

  const start = () => {
    if (!rounds.length) { showBanner(); return; }
    if (reducedMotion) {
      rounds.forEach(addRound);
      tallyA.textContent = String(winsA); tallyB.textContent = String(winsB);
      showBanner();
      return;
    }
    rounds.forEach((round, i) => {
      timers.push(setTimeout(() => addRound(round, i), 500 + i * DUEL_STEP_MS));
    });
    timers.push(setTimeout(showBanner, 500 + rounds.length * DUEL_STEP_MS + 300));
  };
  return { el, start, stop: () => { done = true; timers.forEach(clearTimeout); } };
}
