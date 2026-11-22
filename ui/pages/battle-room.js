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
import { openBattleOverlay } from "../components/battle-overlay.js";

let current = null; // { key, el, dispose }

export function disposeBattle() {
  if (current) { try { current.dispose(); } catch { /* уже остановлено */ } }
  current = null;
}

function message(text) {
  return h("div", { class: "battle-view" }, h("p", { class: "battle-status" }, text));
}

// mountBattle({ code, kind: "host"|"player"|"screen", uid, test, players, liveInfo, now, onToast })
//   getPlayers — () => [{ uid, displayName, avatar }]: имена и аватары берутся
//   в момент отрисовки, поэтому поздно догрузившийся профиль не теряется.
//   backHref   — ссылка «Вернуться» на отдельной странице экрана (#room/КОД/screen).
// Возвращает DOM-элемент (один и тот же для одинаковых параметров).
export function mountBattle({ code, kind, uid, test, players = [], getPlayers = null, backHref = "", liveInfo = {}, now = () => Date.now(), onToast = () => {}, getPresence = null, loadTest = null, isObserver = false }) {
  const key = `${code}|${kind}|${uid}`;
  if (current?.key === key) return current.el;
  disposeBattle();

  const el = h("div", { class: "battle-root" }, message("Загрузка…"));
  const show = (node) => el.replaceChildren(node);
  const roster = () => (typeof getPlayers === "function" ? getPlayers() : players) || [];
  const nameOf = (u) => roster().find((p) => p.uid === u)?.displayName || u;
  const avatarOf = (u) => roster().find((p) => p.uid === u)?.avatar || null;
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
    closeScreen();
    offs.forEach((f) => { try { f(); } catch { /* отписка */ } });
    hostView?.stop();
    play?.destroy();
    screen?.destroy();
  };
  current = { key, el, dispose };

  // Оверлей «Экран битвы» ведущего: отдельная подписка на публичный документ.
  let overlay = null;
  let bankForScreen = test;
  function openScreen(opener) {
    if (overlay || disposed) return;
    overlay = openBattleOverlay({
      opener,
      subscribe: (onData, onError) => subscribeBattle(code, onData, onError),
      buildScreen: (controls) => buildBattleScreen({ test: bankForScreen, nameOf, avatarOf, now, controls }),
      onClosed: () => { overlay = null; }
    });
  }
  function closeScreen() { overlay?.close(); overlay = null; }

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
        bankForScreen = bank;
        const questions = (doc.questions || []).map((q) => ({ ...q, correct: keys[q.id] || [] }));
        const extraQuestions = (doc.extraQuestions || []).map((q) => ({ ...q, correct: keys[q.id] || [] }));
        const game = BattleGame.restore({ doc, questions, extraQuestions, rounds, liveInfo, store, now });
        hostView = buildBattleHost({
          game, test: bank, players, onToast, getPresence,
          onFinish: async (g) => {
            const snap = buildBattleSnapshot({
              state: g.state, liveInfo, initialRoster: g.initialRoster, events: g.events,
              questions: [...questions, ...extraQuestions].map(({ correct, ...pub }) => pub), finishedAtMs: now()
            });
            const res = await attachBattleToHistory(code, snap);
            onToast(res.saved ? "Итоги битвы сохранены в историю." : "Итоги не сохранены в историю (" + (res.reason === "exists" ? "уже сохранены" : "история Live не найдена") + ").", res.saved ? "success" : "info");
          }
        });
        hostView.start();
        // «Экран битвы» — заметная кнопка наверху: открывает полноэкранный
        // просмотр поверх вида ведущего (без прокрутки и без смены страницы,
        // поэтому игровой цикл hostView продолжает работать).
        const openBtn = h("button", { type: "button", class: "btn primary battle-open-screen", "data-action": "open-battle-screen" }, "Экран битвы");
        openBtn.addEventListener("click", () => openScreen(openBtn));
        show(h("div", { class: "battle-host-wrap" },
          h("div", { class: "battle-host-bar" }, openBtn), hostView.el));
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
    start((t) => {
      screen = buildBattleScreen({
        test: t, nameOf, avatarOf, now,
        controls: backHref ? [{ label: "Вернуться", href: backHref, kind: "back" }] : []
      });
      show(screen.el);
      // Имена и аватары участников могут догрузиться позже битвы.
      const refresh = setInterval(() => screen?.refresh(), 3000);
      offs.push(() => clearInterval(refresh));
    });
    return el;
  }

  start((t) => {
    play = buildBattlePlay({
      uid, test: t, now, onToast, nameOf,
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
