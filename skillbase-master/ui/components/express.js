// ui/components/express.js — «Экспресс»: короткая анимация в конце.
// Тепловоз едет по рельсам, на нём едут все участники (по вагону на
// каждого), каждая станция — один вопрос. На станции показывается, как
// справилась вся группа с этим вопросом.
import { h } from "../../shared/dom.js";
import { avatarPreset, avatarSvg, RAIL_AVATARS } from "../../shared/avatars.js";

export const EXPRESS_STOP_MS = 1500;
export const MAX_WAGONS = 8;

// Чистая логика: станции из вердиктов участников (стоит одна на вопрос).
export function expressStations(rows) {
  const byQ = new Map();
  for (const row of rows || []) {
    for (const v of row.verdicts || []) {
      const cur = byQ.get(v.qid) || { correct: 0, total: 0 };
      if (v.verdict !== null) cur.total += 1;
      if (v.verdict === true) cur.correct += 1;
      byQ.set(v.qid, cur);
    }
  }
  return [...byQ.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([qid, c], i) => ({
      qid, n: i + 1, correct: c.correct, total: c.total,
      percent: c.total ? Math.round((c.correct / c.total) * 100) : 0
    }));
}

// Позиция поезда (доля пути 0..1) для станции i из n.
export function stationProgress(i, n) {
  return n <= 1 ? 1 : Math.max(0, Math.min(1, i / (n - 1)));
}

function locoSvg() {
  const preset = RAIL_AVATARS.find(a => a.shape === "loco");
  return avatarSvg({ ...preset, bg: "#1B3A57" }, 64);
}

export function buildExpress(rows, { avatar, questionCount = 0 } = {}) {
  let stations = expressStations(rows);
  if (!stations.length && questionCount > 0) {
    stations = Array.from({ length: questionCount }, (_, i) => ({ qid: String(i), n: i + 1, correct: 0, total: 0, percent: 0 }));
  }
  const riders = (rows || []).slice(0, MAX_WAGONS);
  const extra = Math.max(0, (rows || []).length - riders.length);

  const loco = h("div", { class: "ex-loco", "aria-hidden": "true" });
  loco.innerHTML = locoSvg(); // статичный SVG из констант
  const wagons = riders.map(row => h("div", { class: "ex-wagon", title: row.name || "" },
    avatar ? avatar(row) : null,
    h("span", { class: "ex-wagon-name" }, (row.name || "").split(" ")[0] || "—")));
  if (extra) wagons.push(h("div", { class: "ex-wagon ex-more" }, `+${extra}`));
  const train = h("div", { class: "ex-train", "aria-hidden": "true" }, loco, wagons,
    h("span", { class: "ex-smoke" }), h("span", { class: "ex-smoke s2" }));

  const stops = stations.map(st => h("li", { class: "ex-station", "data-n": String(st.n) },
    h("span", { class: "ex-post" }),
    h("span", { class: "ex-label" }, `Вопрос ${st.n}`)));
  const info = h("p", { class: "ex-info", role: "status" }, "Экспресс отправляется…");
  const track = h("div", { class: "ex-track" },
    h("ol", { class: "ex-stations" }, stops), h("div", { class: "ex-rails" }), train);
  const skip = h("button", { type: "button", class: "btn secondary ex-skip" }, "Пропустить");
  const el = h("section", { class: "panel express", "aria-label": "Экспресс: итоги по вопросам" },
    h("div", { class: "panel-head" }, h("h2", {}, "Экспресс"), skip), track, info);

  let timers = [];
  const place = (i, instant) => {
    const p = stationProgress(i, stations.length);
    train.style.transition = instant ? "none" : "";
    train.style.left = `calc((100% - var(--ex-train-w, 0px)) * ${p})`;
  };
  const stop = () => { timers.forEach(clearTimeout); timers = []; };
  skip.addEventListener("click", () => { stop(); stations.forEach((_, i) => stops[i]?.classList.add("passed")); place(stations.length - 1, true); info.textContent = "Конечная! Все доехали."; train.classList.add("is-parked"); skip.hidden = true; });

  const start = () => {
    const reducedMotion = typeof window !== "undefined" && window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Ширина поезда нужна для расчёта конечной позиции.
    train.style.setProperty("--ex-train-w", `${train.offsetWidth || 160}px`);
    if (!stations.length || reducedMotion) { skip.click(); return; }
    place(0, true);
    stations.forEach((st, i) => {
      timers.push(setTimeout(() => {
        place(i, false);
        train.classList.remove("is-parked");
        timers.push(setTimeout(() => {
          train.classList.add("is-parked");
          stops[i]?.classList.add("passed");
          info.textContent = st.total
            ? `Станция «Вопрос ${st.n}»: верно ${st.correct} из ${st.total} (${st.percent}%)`
            : `Станция «Вопрос ${st.n}»`;
        }, 900));
      }, 300 + i * EXPRESS_STOP_MS));
    });
    timers.push(setTimeout(() => {
      info.textContent = "Конечная! Все доехали.";
      skip.hidden = true;
    }, 300 + stations.length * EXPRESS_STOP_MS + 400));
  };
  return { el, start, stop };
}
