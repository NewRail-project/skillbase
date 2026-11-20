// ui/pages/battle-room.js — среда выполнения «Командной битвы» в комнате.
// Держит долгоживущие виды (ведущий, игрок, проектор) вне room.js: room.js
// только вызывает mountBattle() и dispose() при смене комнаты.
//
// Вид создаётся один раз на (комната, роль, пользователь) и дальше
// обновляется сам по подписке Firestore — страница не перерисовывается
// целиком при каждом голосе (ТЗ §26).
import { h } from "../../shared/dom.js";
import { subscribeBattle, getBattle, createBattleStore, loadBattleKeys, castVote, makeCaptainDecision, attachBattleToHistory } from "../../core/battle.js";
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
export function mountBattle({ code, kind, uid, test, players = [], liveInfo = {}, now = () => Date.now(), onToast = () => {} }) {
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
        const questions = (doc.questions || []).map((q) => ({ ...q, correct: keys[q.id] || [] }));
        const game = BattleGame.restore({ doc, questions, rounds, liveInfo, store, now });
        hostView = buildBattleHost({
          game, test, players, onToast,
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

  if (kind === "screen") {
    screen = buildBattleScreen({ test, nameOf, now });
    show(screen.el);
    offs.push(subscribeBattle(code, (b) => screen.update(b), () => show(message("Нет доступа к битве."))));
    return el;
  }

  play = buildBattlePlay({
    uid, test, now, onToast,
    api: {
      castVote: (x) => castVote(code, x),
      makeCaptainDecision: (x) => makeCaptainDecision(code, x)
    }
  });
  show(play.el);
  offs.push(subscribeBattle(code, (b) => play.update(b), () => show(message("Нет доступа к битве."))));
  return el;
}
