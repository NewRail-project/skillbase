// core/score-fx.js — какие визуальные эффекты нужны при начислении очков Battle.
//
// Чистая логика без DOM и таймеров. Ничего не считает за игру: очки уже
// начислены и лежат в публичном документе битвы (roundSummaries[].teams[id].
// points.total). Здесь только определяется, ЧТО показать: «+N» у команды,
// подсветка, усиленный эффект для решающего начисления.
//
// Защита от повторов: у каждого раунда есть ключ «вид:индекс». Один ключ даёт
// эффект один раз за жизнь трекера. Первый снимок (открыли страницу,
// переподключились, обновили вкладку) эффектов не создаёт — иначе уже
// сыгранная история «проигрывалась» бы заново.
const TEAM_IDS = ["a", "b"];

export const roundKey = (summary) => `${summary?.kind || "main"}:${summary?.index}`;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (v) => Math.round(v * 100) / 100;

// Счёт после каждого раунда нарастающим итогом: [{ key, a, b }].
export function runningScores(summaries = []) {
  let a = 0;
  let b = 0;
  return summaries.map(s => {
    a = round2(a + num(s?.teams?.a?.points?.total));
    b = round2(b + num(s?.teams?.b?.points?.total));
    return { key: roundKey(s), a, b };
  });
}

const leaderOf = ({ a, b }) => (a === b ? null : a > b ? "a" : "b");

export function createScoreFxTracker() {
  const seen = new Set();
  let primed = false;

  return {
    // battle — публичный документ битвы. Возвращает НОВЫЕ эффекты по порядку.
    consume(battle) {
      const summaries = Array.isArray(battle?.roundSummaries) ? battle.roundSummaries : [];
      const totalMain = Array.isArray(battle?.questions) ? battle.questions.length : 0;
      if (!primed) {
        primed = true;
        for (const s of summaries) seen.add(roundKey(s));
        return [];
      }
      const running = runningScores(summaries);
      const effects = [];
      summaries.forEach((s, i) => {
        const key = roundKey(s);
        if (seen.has(key)) return;
        seen.add(key);
        const before = i > 0 ? running[i - 1] : { a: 0, b: 0 };
        const after = running[i];
        const kind = s.kind || "main";
        const lastMain = kind === "main" && totalMain > 0 && s.index === totalMain - 1;
        const flipped = Boolean(leaderOf(before)) && Boolean(leaderOf(after)) && leaderOf(before) !== leaderOf(after);
        const decisive = kind === "extra" || lastMain || flipped;
        for (const team of TEAM_IDS) {
          const points = round2(num(s?.teams?.[team]?.points?.total));
          if (points > 0) effects.push({ key, team, points, decisive, kind, index: s.index });
        }
      });
      return effects;
    },
    // Сколько раундов уже учтено (для проверок и отладки).
    seenCount: () => seen.size
  };
}

// Эффекты не должны «забивать» экран, если пришла пачка раундов (например,
// после долгого фона вкладки): показываем только последние `max`, а счёт
// всё равно обновится на итоговое значение.
export function limitEffects(effects, max = 4) {
  if (!Array.isArray(effects) || effects.length <= max) return effects || [];
  const decisive = effects.filter(e => e.decisive);
  const rest = effects.filter(e => !e.decisive);
  return [...rest.slice(-(max - Math.min(decisive.length, max))), ...decisive.slice(-max)]
    .sort((x, y) => effects.indexOf(x) - effects.indexOf(y))
    .slice(-max);
}

// ---------- Состояние команды в текущем раунде ----------
// Из публичных данных раунда (modes, closedAt, voted, tiebreak) определяет, что
// сейчас делает команда. «Активная» — та, от которой раунд ещё ждёт действия.
// Игровую механику не затрагивает: только подпись и подсветка.
const hasTie = (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v));

export function teamStatus(battle, team) {
  const idle = { state: "idle", label: "", active: false };
  const r = battle?.currentRound;
  if (!r || battle.phase === "finished" || r.status === "closed") return idle;
  if (r.closedAt && r.closedAt[team] != null) return { state: "answered", label: "Ответила", active: false };
  if (r.status === "tiebreak") {
    return hasTie(r.tiebreak?.[team])
      ? { state: "tiebreak", label: "Капитан решает при ничьей", active: true }
      : { state: "answered", label: "Ответила", active: false };
  }
  const mode = r.modes?.[team];
  if (mode === "vote") {
    const v = r.voted?.[team];
    return { state: "voting", label: v ? `Голосует: ${v.voted} из ${v.total}` : "Голосует", active: true };
  }
  if (!mode) return { state: "choosing", label: "Капитан выбирает способ", active: true };
  return { state: "answered", label: "Ответила", active: false };
}

export const activeTeams = (battle) => ["a", "b"].filter(t => teamStatus(battle, t).active);
