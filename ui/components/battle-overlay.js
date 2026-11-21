// ui/components/battle-overlay.js — полноэкранный оверлей «Экран битвы»
// у ведущего. Открывается поверх вида ведущего без смены страницы: игровой
// цикл ведущего (автошаги раунда, пульс присутствия) не прерывается.
//
// Оверлей — только просмотр. «К управлению» закрывает его и возвращает на
// панель ведущего; настоящие проверки прав остаются в правилах Firestore
// (писать в battle может только ведущий), а не в скрытии кнопок.
import { h } from "../../shared/dom.js";

const FOCUSABLE = "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])";

// openBattleOverlay({ opener, subscribe, buildScreen, onClosed })
//   subscribe(onData, onError) → отписка; buildScreen(controls) → { el, update, refresh, destroy }
export function openBattleOverlay({ opener = null, subscribe, buildScreen, onClosed = () => {} }) {
  let closed = false;
  const view = buildScreen([{ label: "К управлению", onClick: () => close(), kind: "primary" }]);
  const root = h("div", { class: "bs-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Экран битвы" }, view.el);
  const body = document.body;
  const prevOverflow = body.style.overflow;
  body.style.overflow = "hidden";
  body.appendChild(root);

  const off = subscribe((battle) => { if (!closed) view.update(battle); }, () => {
    if (!closed) view.update(null);
  });
  const refresh = setInterval(() => view.refresh?.(), 3000);

  const onKey = (e) => {
    if (e.key === "Escape" && !document.fullscreenElement) { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    const items = Array.from(root.querySelectorAll(FOCUSABLE));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener("keydown", onKey);
  // Фокус — на «К управлению» (последняя кнопка в шапке).
  const buttons = root.querySelectorAll(".bs-controls .bs-btn");
  buttons[buttons.length - 1]?.focus?.();

  function close() {
    if (closed) return;
    closed = true;
    try { off?.(); } catch { /* уже отписаны */ }
    clearInterval(refresh);
    document.removeEventListener("keydown", onKey);
    if (document.fullscreenElement) { try { document.exitFullscreen?.(); } catch { /* ничего */ } }
    view.destroy?.();
    root.remove();
    body.style.overflow = prevOverflow;
    opener?.focus?.();
    onClosed();
  }
  return { close, el: root, view };
}
