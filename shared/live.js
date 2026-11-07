// shared/live.js — «живые» тексты и атрибуты.
//
// Нужны для переключения режима Education / Workforce без перерисовки страницы:
// страница рисуется один раз, а подписи, которые зависят от режима,
// пересчитываются на месте. Поля ввода, прокрутка, открытые разделы и
// несохранённые данные при этом не затрагиваются.
//
// Контракт:
//   liveText(fn)            -> Text-узел, текст которого = fn(); обновляется при смене режима
//   liveAttr(el, name, fn)  -> то же для атрибута элемента (placeholder, aria-label, title…)
//   refreshLive()           -> пересчитать все привязки (вызывается по событию sb:modechange)
//
// Ссылки на узлы слабые (WeakRef): ушедшая со страницы разметка не держится в памяти.

export const MODE_EVENT = "sb:modechange";

const bindings = new Set();
let listening = false;

function ensureListener() {
  if (listening || typeof window === "undefined" || !window.addEventListener) return;
  listening = true;
  window.addEventListener(MODE_EVENT, refreshLive);
}

function makeRef(node) {
  return typeof WeakRef === "function" ? new WeakRef(node) : { deref: () => node };
}

function evaluate(fn) {
  try {
    const v = fn();
    return v == null ? "" : String(v);
  } catch (err) {
    console.error("Живой текст: ошибка вычисления", err);
    return "";
  }
}

export function liveText(fn) {
  ensureListener();
  const node = document.createTextNode(evaluate(fn));
  bindings.add({ ref: makeRef(node), fn, kind: "text" });
  return node;
}

export function liveAttr(el, name, fn) {
  ensureListener();
  el.setAttribute(name, evaluate(fn));
  bindings.add({ ref: makeRef(el), fn, kind: "attr", name });
  return el;
}

export function refreshLive() {
  for (const b of [...bindings]) {
    const target = b.ref.deref();
    if (!target) { bindings.delete(b); continue; }
    const value = evaluate(b.fn);
    if (b.kind === "text") {
      if (target.nodeValue !== value) target.nodeValue = value;
    } else if (target.getAttribute(b.name) !== value) {
      target.setAttribute(b.name, value);
    }
  }
}

// Для тестов и диагностики.
export function liveCount() { return bindings.size; }
