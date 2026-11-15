// ui/components/live-train.js — паровоз Live-теста.
// Рельсы с остановками: каждая станция — один вопрос. Во время теста
// паровоз едет к станции текущего вопроса; после завершения стоит на
// конечной станции (под названием темы), на вагонах — лучшие участники.
// Узел создаётся один раз и переиспользуется между перерисовками вида,
// поэтому движение плавное (CSS-переход left), а не «прыжок».
import { h } from "../../shared/dom.js";
import { avatarSvg, RAIL_AVATARS } from "../../shared/avatars.js";
import { stationProgress } from "./express.js";

export const TRAIN_MOVE_MS = 950;
export const MAX_STATIONS = 40;

// Чистая логика состояния: что показывать для позиции/итога.
// position — индекс текущего вопроса (0..total-1), finished — тест окончен.
export function trainState({ position = 0, total = 0, finished = false } = {}) {
  const n = Math.max(0, Math.min(MAX_STATIONS, Number(total) || 0));
  if (!n) return { stations: 0, index: 0, passed: 0, progress: 0, parked: true, label: "Ожидание старта" };
  if (finished) return { stations: n, index: n - 1, passed: n, progress: 1, parked: true, label: "Конечная! Все вопросы пройдены" };
  const index = Math.max(0, Math.min(n - 1, Number(position) || 0));
  return {
    stations: n, index, passed: index, progress: stationProgress(index, n),
    parked: false, label: `Станция «Вопрос ${index + 1}» из ${n}`
  };
}

function locoSvg() {
  const preset = RAIL_AVATARS.find(a => a.shape === "loco");
  return preset ? avatarSvg({ ...preset, bg: "#1B3A57" }, 64) : "";
}

export function buildLiveTrain() {
  const loco = h("div", { class: "ex-loco", "aria-hidden": "true" });
  loco.innerHTML = locoSvg(); // статичный SVG из констант проекта
  const wagons = h("div", { class: "lt-wagons" });
  const train = h("div", { class: "ex-train is-parked", "aria-hidden": "true" },
    loco, wagons, h("span", { class: "ex-smoke" }), h("span", { class: "ex-smoke s2" }));
  const stationsEl = h("ol", { class: "ex-stations" });
  const track = h("div", { class: "ex-track" }, stationsEl, h("div", { class: "ex-rails" }), train);
  const info = h("p", { class: "ex-info", role: "status" }, "Ожидание старта");
  const el = h("div", { class: "express live-train", "aria-label": "Ход теста: станции — вопросы" }, track, info);

  let stationCount = -1;
  let lastKey = "";
  let parkTimer = null;

  const place = (p) => {
    train.style.setProperty("--ex-train-w", `${train.offsetWidth || 90}px`);
    train.style.left = `calc((100% - var(--ex-train-w, 0px)) * ${p})`;
  };

  function update({ position = 0, total = 0, finished = false, riders = [] } = {}) {
    const st = trainState({ position, total, finished });
    const key = `${st.stations}|${st.index}|${st.parked}|${riders.join(",")}`;
    if (key === lastKey) return;
    const moved = lastKey !== "" && !lastKey.startsWith(`${st.stations}|${st.index}|`);
    lastKey = key;

    if (st.stations !== stationCount) {
      stationCount = st.stations;
      stationsEl.replaceChildren(...Array.from({ length: st.stations }, (_, i) =>
        h("li", { class: "ex-station" }, h("span", { class: "ex-post" }),
          h("span", { class: "ex-label" }, st.stations > 12 ? (i % 5 === 0 ? String(i + 1) : "") : `В${i + 1}`))));
    }
    [...stationsEl.children].forEach((li, i) => li.classList.toggle("passed", i < st.passed || (finished && i < st.stations)));

    wagons.replaceChildren(...riders.slice(0, 3).map(name =>
      h("div", { class: "ex-wagon", title: name },
        h("span", { class: "ex-wagon-name" }, (name || "").split(" ")[0] || "—"))));

    clearTimeout(parkTimer);
    const reduced = typeof window !== "undefined" && window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (st.parked || reduced) {
      train.classList.add("is-parked");
    } else if (moved) {
      train.classList.remove("is-parked");
      parkTimer = setTimeout(() => train.classList.add("is-parked"), TRAIN_MOVE_MS);
    }
    requestAnimationFrame(() => place(st.progress));
    info.textContent = st.label;
  }

  return { el, update, destroy: () => clearTimeout(parkTimer) };
}
