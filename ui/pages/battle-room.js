// ui/pages/battle-room.js — среда выполнения «Командной битвы» в комнате.
// Держит долгоживущие виды (ведущий, игрок, проектор) вне room.js: room.js
// только вызывает mountBattle() и dispose() при смене комнаты.
//
// Вид создаётся один раз на (комната, роль, пользователь) и дальше
// обновляется сам по подписке Firestore — страница не перерисовывается
// целиком при каждом голосе (ТЗ §26).
import { h } from "../../shared/dom.js";
import { subscribeBattle, getBattle, createBattleStore, loadBattleKeys, castVote, makeCaptainDecision, attachBattleToHistory, touchPresence, BATTLE_PULSE_MS } from "../../core/battle.js";
import { BattleGame } from "../../core/battle-game.js";
import { buildBattleSnapshot } from "../../core/battle-snapshot.js";
import { buildBattlePlay } from "../components/battle-play.js";
import { buildBattleHost } from "../components/battle-host.js";
import { buildBattleScreen } from "../components/battle-screen.js";

let current = null; // { key, el, dispose }

export function disposeBattle() {
  if (current) { try { current.dispose(); } catch { /* уже остановлено */ } }
  current = null;
}

function message(text) {
  return h("div", { class: "battle-view" }, h("p", { class: "battle-status" }, text));
}

// mountBattle({ code, kind: "host"|"player"|"screen", uid, test, players, liveInfo, now, onToast })
// Возвращает DOM-элемент (один и тот же для одинаковых параметров).
export function mountBattle({ code, kind, uid, test, players = [], liveInfo = {}, now = () => Date.now(), onToast = () => {}, getPresence = null, loadTest = null, isObserver = false }) {
  const key = `${code}|${kind}|${uid}`;
  if (current?.key === key) return current.el;
  disposeBattle();

  const el = h("div", { class: "battle-root" }, message("Загрузка…"));
  const show = (node) => el.replaceChildren(node);
  const nameOf = (u) => players.find((p) => p.uid === u)?.displayName || u;
  const offs = [];
  let hostView = null;
  let play = null;
  let screen = null;
  let disposed = false;

  // Тест-источник вопросов: тот же, что в Live, либо отдельный набор (battle.testId).
  const sourceTest = async (doc) => {
    if (!doc?.testId || doc.testId === test?.id || !loadTest) return test;
    return (await loadTest(doc.testId)) || test;
  };

  const dispose = () => {
    disposed = true;
    offs.forEach((f) => { try { f(); } catch { /* отписка */ } });
    hostView?.stop();
    play?.destroy();
    screen?.destroy();
  };
  current = { key, el, dispose };

  if (kind === "host") {
    (async () => {
      try {
        const doc = await getBattle(code);
        if (disposed) return;
        if (!doc) return show(message("Битва ещё не запущена."));
        const store = createBattleStore(code);
        const [keys, rounds] = await Promise.all([loadBattleKeys(code), store.loadRounds()]);
        if (disposed) return;
        const bank = await sourceTest(doc);
        if (disposed) return;
        const questions = (doc.questions || []).map((q) => ({ ...q, correct: keys[q.id] || [] }));
        const game = BattleGame.restore({ doc, questions, rounds, liveInfo, store, now });
        hostView = buildBattleHost({
          game, test: bank, players, onToast, getPresence,
          onFinish: async (g) => {
            const snap = buildBattleSnapshot({
              state: g.state, liveInfo, initialRoster: g.initialRoster, events: g.events,
              questions: questions.map(({ correct, ...pub }) => pub), finishedAtMs: now()
            });
            const res = await attachBattleToHistory(code, snap);
            onToast(res.saved ? "Итоги битвы сохранены в историю." : "Итоги не сохранены в историю (" + (res.reason === "exists" ? "уже сохранены" : "история Live не найдена") + ").", res.saved ? "success" : "info");
          }
        });
        hostView.start();
        show(hostView.el);
      } catch (err) {
        show(message(err?.message || "Не удалось загрузить битву."));
      }
    })();
    return el;
  }

  // Участник и проектор: ждём первый снимок битвы, подгружаем тест-источник
  // (если вопросы из отдельного набора) и дальше только обновляем вид.
  let ready = null;
  const start = (build) => {
    offs.push(subscribeBattle(code, async (b) => {
      if (disposed) return;
      if (!ready) {
        ready = (async () => {
          try { const t = await sourceTest(b); if (!disposed) { build(t); } }
          catch { if (!disposed) build(test); }
        })();
      }
      await ready;
      (play || screen)?.update(b);
    }, () => show(message("Нет доступа к битве."))));
  };

  if (kind === "screen") {
    start((t) => { screen = buildBattleScreen({ test: t, nameOf, now }); show(screen.el); });
    return el;
  }

  start((t) => {
    play = buildBattlePlay({
      uid, test: t, now, onToast,
      api: {
        castVote: (x) => castVote(code, x),
        makeCaptainDecision: (x) => makeCaptainDecision(code, x)
      }
    });
    show(play.el);
  });
  // Пульс присутствия: по нему ведущий определяет потерю связи.
  if (!isObserver) {
    touchPresence(code);
    const pulse = setInterval(() => touchPresence(code), BATTLE_PULSE_MS);
    offs.push(() => clearInterval(pulse));
  }
  return el;
}
