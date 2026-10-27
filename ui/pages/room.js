// ui/pages/room.js — единый экран Live-комнаты: host, player, observer.
// Перерисовка только при изменении сигнатуры состояния (roomSignature),
// чтобы поле ввода участника не теряло фокус на каждом снапшоте.
// Автозакрытие вопроса у ведущего срабатывает один раз на вопрос; если
// оно не прошло (нет сети), кнопка «Закрыть» продолжает работать.
import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { loadTest } from "../../core/editor.js";
import {
  subscribeRoom, openQuestion, closeQuestion, saveAnswer, closeRoom,
  questionDurationSec
} from "../../core/rooms.js";
import {
  roomSignature, questionTimeMs, answeredCount
} from "../../core/rooms-logic.js";
import {
  db, doc, getDoc, onSnapshot, collection
} from "../../shared/firebase.js";
import { icons } from "../../shared/icons.js";
import { toast } from "../components/toast.js";

let unsubs = [];
let autoTimer = null;
let pageRef = null;
const autoClosed = new Set();
let lastSignature = null;
let local = null;

function reset() {
  unsubs.forEach(fn => { try { fn(); } catch (e) { /* уже отписаны */ } });
  unsubs = [];
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  autoClosed.clear();
  lastSignature = null;
  pageRef = null;
  local = { room: null, players: [], scores: [], reveals: {}, test: null, keys: null, receivedMs: 0, code: "" };
}
reset();

export function cleanup() {
  reset();
}

function toMs(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function formatClock(remainingMs) {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function role() {
  if (!local.room) return null;
  if (isStaff() && local.room.hostId === State.user?.uid) return "host";
  const me = local.players.find(p => p.uid === State.user?.uid);
  if (me) return me.observer ? "observer" : "player";
  return null;
}

function myPlayer() {
  return local.players.find(p => p.uid === State.user?.uid) || null;
}

function signature() {
  const room = local.room;
  const my = myPlayer();
  const myAnswer = room?.phase === "opened" && room?.currentQuestionId
    ? my?.answers?.[String(room.currentQuestionId)]
    : null;
  const board = (local.scores || []).map(s => `${String(s.uid).slice(0, 6)}:${s.score ?? 0}`).join(",");
  const revealId = room?.phase === "closed" && room?.currentQuestionId
    ? (local.reveals?.[String(room.currentQuestionId)] ? "on" : "off")
    : "-";
  const answers = (local.players || [])
    .filter(p => !p.observer)
    .map(p => `${String(p.uid).slice(0, 6)}:${Object.keys(p.answers || {}).length}`)
    .sort()
    .join(",");
  return [
    room ? room.status : "no-room",
    String(room?.currentQuestionId ?? ""),
    String(room?.phase ?? ""),
    String(room?.qStartedMs ?? ""),
    String(local.players.length),
    `answers=${answers}`,
    `board=${board}`,
    `reveal=${revealId}`,
    `me=${myAnswer != null ? 1 : 0}`,
    `role=${role()}`,
    `test=${local.test ? 1 : 0}`
  ].join("~");
}

// Оставшееся время открытого вопроса в мс (или null, если не ограничено).
function openMsLeft() {
  const room = local.room;
  if (!room || room.phase !== "opened") return null;
  const started = questionTimeMs(room.qStartedMs, local.receivedMs);
  const duration = questionDurationSec(local.test, room.settings);
  if (!duration) return null;
  return started + duration * 1000 - Date.now();
}

export default async function RoomPage() {
  const page = h("div", { class: "page room-page" });
  const codeRaw = decodeURIComponent((State.routeParam || "").split("/")[0] || "");

  let code = "";
  try {
    const probe = await probeRoom(codeRaw);
    if (!probe) {
      page.appendChild(notFoundPanel());
      return page;
    }
    code = probe.id;
    local.code = code;
    local.room = { ...probe, id: probe.id };
    local.test = await loadTestPublic(probe.testId);
    if (probe.hostId === State.user.uid && isStaff()) {
      local.keys = await loadKeys(probe.testId);
    }
  } catch (err) {
    console.error("Комната:", err);
    page.appendChild(errorPanel(err));
    return page;
  }

  // Подписки. Каждый снапшот обновляет состояние и дергает render(),
  // который перерисовывает экран только при смене сигнатуры.
  const wake = () => scheduleRender(page);
  unsubs.push(subscribeRoom(code, {
    onRoom: room => {
      local.room = room ? { ...room, qStartedMs: toMs(room.qStartedAt) } : null;
      local.receivedMs = Date.now();
      wake();
    },
    onPlayers: players => { local.players = players; wake(); },
    onError: error => console.error("Комната snapshot:", error)
  }));

  unsubs.push(onSnapshot(
    collection(db, "rooms", code, "scores"),
    snapshot => {
      local.scores = snapshot.docs.map(item => ({ uid: item.id, ...item.data() }));
      wake();
    },
    error => console.error("scores snapshot:", error)
  ));

  unsubs.push(onSnapshot(
    collection(db, "rooms", code, "reveals"),
    snapshot => {
      local.reveals = {};
      snapshot.docs.forEach(item => { local.reveals[item.id] = item.data(); });
      wake();
    },
    error => console.error("reveals snapshot:", error)
  ));

  page.appendChild(statusBar());
  scheduleRender(page);
  return page;
}

// ---------- Загрузка данных ----------

async function probeRoom(codeRaw) {
  const code = String(codeRaw || "").toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) return null;
  const snap = await getDoc(doc(db, "rooms", code));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function loadTestPublic(testId) {
  const snap = await getDoc(doc(db, "tests", testId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function loadKeys(testId) {
  try {
    const snap = await getDoc(doc(db, "testKeys", testId));
    if (snap.exists()) {
      const data = snap.data();
      return data.items || data.keys || {};
    }
  } catch (err) {
    console.error("testKeys:", err);
  }
  return {};
}

// ---------- Каркас ----------

function statusBar() {
  const room = local.room;
  const text = !room
    ? "Ждём комнату…"
    : room.status === "closed"
      ? "Комната закрыта"
      : room.phase === "idle"
        ? "Ожидание первого вопроса"
        : room.phase === "opened"
          ? `Вопрос ${Number(room.currentQuestionId) + 1} из ${room.questionCount || "?"}`
          : "Вопрос закрыт";
  const me = myPlayer();
  const suffix = me ? me.observer ? " · вы наблюдатель" : " · вы участник" : "";
  return h("div", { class: "room-status", role: "status" }, text + suffix);
}

function scheduleRender(page) {
  if (page) pageRef = page;
  const target = page || pageRef;
  const sig = signature();
  if (sig === lastSignature) return;
  lastSignature = sig;
  if (target) renderPage(target);
  manageAutoClose(target);
}

function renderPage(page) {
  const existing = page.querySelector(".room-view");
  const next = buildView();
  if (existing) existing.replaceWith(next);
  else page.appendChild(next);
}

function notFoundPanel() {
  return h("div", { class: "panel" },
    h("div", { class: "empty-state" },
      h("div", { class: "empty-state-icon", innerHTML: icons.users }),
      h("h2", {}, "Комната не найдена"),
      h("p", { class: "muted" }, "Проверьте код: 6 символов, без 0, O, 1 и I."),
      h("a", { class: "btn primary", href: "#join" }, "Ввести код заново")
    )
  );
}

function errorPanel(err) {
  return h("div", { class: "panel" },
    h("div", { class: "empty-state" },
      h("div", { class: "empty-state-icon", innerHTML: icons.users }),
      h("h2", {}, "Не удалось открыть комнату"),
      h("p", { class: "muted" }, err?.code === "permission-denied"
        ? "Правила Firestore не разрешают доступ."
        : "Проверьте подключение к сети и попробуйте снова."),
      h("a", { class: "btn secondary", href: "#join" }, "Вернуться к входу")
    )
  );
}

function questionPanel(question, { showAnswer = false } = {}) {
  if (!question) return null;
  const panel = h("div", { class: "room-question panel" },
    h("div", { class: "panel-head" },
      h("h2", {}, question.text || "Вопрос без текста"),
      h("span", { class: "badge badge-neutral" }, `${question.points || 1} б.`)
    )
  );
  if (Array.isArray(question.options) && question.options.length) {
    panel.appendChild(h("ul", { class: "room-options" },
      question.options.map((option, index) =>
        h("li", {
          class: showAnswer
            ? (showAnswer.correct?.includes(index) ? "option correct" : "option")
            : "option"
        }, option.text || "—")
      )
    ));
  }
  if (showAnswer && showAnswer.type === "short") {
    panel.appendChild(h("div", { class: "option correct" },
      `Правильный ответ: ${showAnswer.answer || ""}`));
  }
  if (showAnswer?.explanation) {
    panel.appendChild(h("p", { class: "muted" }, showAnswer.explanation));
  }
  return panel;
}

function scoresTable() {
  if (!local.scores.length) return null;
  // Ведущему и наблюдателям таблица нужна всегда; участникам — по
  // настройке теста showLeaderboard.
  const roleHere = role();
  if (roleHere === "player" && local.room?.showLeaderboard !== true) return null;
  const rows = [...local.scores]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || String(a.name).localeCompare(String(b.name), "ru"));
  return h("div", { class: "panel" },
    h("div", { class: "panel-head" }, h("h2", {}, "Таблица результатов")),
    h("table", { class: "table" },
      h("thead", {}, h("tr", {},
        h("th", {}, "#"), h("th", {}, "Участник"), h("th", {}, "Верно"), h("th", {}, "Баллы"))),
      h("tbody", {},
        rows.map((entry, index) => h("tr", {},
          h("td", {}, String(index + 1)),
          h("td", {}, entry.name || "Участник"),
          h("td", {}, `${entry.correctCount ?? 0}`),
          h("td", {}, `${entry.score ?? 0} из ${entry.max ?? 0}`)
        ))
      )
    )
  );
}

// ---------- Вид ведущего ----------

function hostView() {
  const room = local.room;
  const test = local.test;
  const wrap = h("div", { class: "room-view" });

  wrap.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Live-комната · вы ведущий"),
      h("h1", {}, room.testTitle || "Комната"),
      h("p", { class: "page-sub" }, `Код комнаты: `),
    )
  ));
  // Код крупно, чтобы продемонстрировать на экране/камере.
  wrap.appendChild(h("div", { class: "room-code-badge" }, room.code || room.id));

  const playersCount = local.players.filter(p => !p.observer).length;
  const observersCount = local.players.length - playersCount;
  wrap.appendChild(h("div", { class: "quick-actions" },
    h("div", { class: "quick-action" },
      h("b", {}, String(playersCount)),
      h("span", {}, "участников")
    ),
    h("div", { class: "quick-action" },
      h("b", {}, String(observersCount)),
      h("span", {}, "наблюдателей")
    )
  ));

  const questions = test?.questions || [];
  const currentId = room.phase === "opened" || room.phase === "closed"
    ? String(room.currentQuestionId)
    : null;
  const question = currentId !== null ? questions[Number(currentId)] : null;
  const reveal = room.phase === "closed" ? local.reveals?.[currentId] : null;

  if (!question) {
    wrap.appendChild(h("div", { class: "panel" },
      h("div", { class: "empty-state" },
        h("h2", {}, "Задайте первый вопрос"),
        h("p", { class: "muted" }, `Всего вопросов: ${room.questionCount || questions.length}.`)
      )
    ));
  } else {
    wrap.appendChild(questionPanel(question));
    if (reveal) wrap.appendChild(revealPanel(reveal, question, { mine: null }));
    if (room.phase === "opened") {
      const counter = answeredCount(local.players.filter(p => !p.observer), currentId);
      const controls = h("div", { class: "panel" },
        h("div", { class: "panel-head" },
          h("h2", {}, "Ответили"),
          h("span", { class: "badge badge-neutral" }, `${counter} из ${playersCount}`)
        ),
        h("div", { class: "panel-body" },
          h("div", { class: "btn-row" },
            h("button", {
              type: "button",
              class: "btn primary",
              onclick: () => manualClose(room)
            }, "Закрыть вопрос"),
            !left ? h("span", { class: "muted" }, "Без ограничения времени: закрытие вручную") : null
          ),
          left && left > 0
            ? h("p", { class: "form-hint" }, "Автозакрытие сработает по таймеру, кнопка останется рабочей.")
            : null
        )
      );
      wrap.appendChild(controls);
    } else {
      wrap.appendChild(h("div", { class: "panel" },
        h("div", { class: "btn-row" },
          h("button", {
            type: "button",
            class: "btn primary",
            disabled: Number(currentId) + 1 >= (room.questionCount || questions.length),
            onclick: () => {
              openQuestion(local.code, Number(currentId) + 1).catch(err => {
                console.error("Не удалось открыть вопрос:", err);
                toast("Не удалось открыть следующий вопрос", "error");
              });
            }
          }, "Следующий вопрос"),
          Number(currentId) + 1 >= (room.questionCount || questions.length)
            ? h("button", {
                type: "button", class: "btn secondary",
                onclick: () => {
                  closeRoom(local.code).then(() => toast("Комната закрыта", "success"))
                    .catch(err => toast("Не удалось закрыть комнату", "error"));
                }
              }, "Завершить комнату")
            : null
        )
      ));
    }
  }

  const board = scoresTable();
  if (board) wrap.appendChild(board);
  return wrap;
}

async function manualClose(room) {
  try {
    await closeQuestion({
      code: local.code,
      index: Number(room.currentQuestionId),
      keys: local.keys,
      test: local.test,
      players: local.players
    });
    // Снапшоты обновят состояние; принудительно перерисуем, чтобы
    // кнопка «Следующий вопрос» появилась сразу.
    lastSignature = null;
    scheduleRender(null);
  } catch (err) {
    console.error("Закрытие вопроса:", err);
    toast("Не удалось закрыть вопрос (нет сети?) — кнопка останется активной.", "error");
  }
}

// Автозакрытие: раз в секунду проверяем, истёк ли вопрос; срабатывает
// один раз на вопрос, кнопка «Закрыть» при сбое остаётся рабочей.
function manageAutoClose(page) {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  if (role() !== "host") return;
  const room = local.room;
  if (!room || room.phase !== "opened" || !room.currentQuestionId) return;
  const questionId = String(room.currentQuestionId);
  if (autoClosed.has(questionId)) return;

  const tick = () => {
    const left = openMsLeft();
    if (left === null) return;
    if (left <= 0 && !autoClosed.has(questionId)) {
      autoClosed.add(questionId);
      manualClose(room);
    }
  };
  tick();
  if (openMsLeft() !== null) {
    autoTimer = setInterval(() => {
      if (!local.room || local.room.phase !== "opened") { clearInterval(autoTimer); autoTimer = null; return; }
      tick();
    }, 1000);
  }
}

// ---------- Вид участника ----------

function playerView() {
  const room = local.room;
  const me = myPlayer();
  const test = local.test;
  const questions = test?.questions || [];
  const wrap = h("div", { class: "room-view" });

  wrap.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Live-комната · вы участник"),
      h("h1", {}, room.testTitle || "Комната"),
      h("p", { class: "page-sub" }, `Код комнаты: ${room.code || room.id}`)
    )
  ));

  const currentId = room.phase === "opened" || room.phase === "closed"
    ? String(room.currentQuestionId)
    : null;
  const question = currentId !== null ? questions[Number(currentId)] : null;
  const myAnswer = question ? me?.answers?.[currentId] : null;
  const reveal = room.phase === "closed" ? local.reveals?.[currentId] : null;

  if (!room || room.status !== "active") {
    wrap.appendChild(h("div", { class: "panel" },
      h("div", { class: "empty-state" }, h("h2", {}, "Комната закрыта"), h("p", { class: "muted" }, "Ведущий завершил сеанс."))
    ));
    const board = scoresTable();
    if (board) wrap.appendChild(board);
    return wrap;
  }

  if (!question) {
    wrap.appendChild(waitPanel("Ведущий скоро задаст вопрос, следите за экраном."));
  } else if (myAnswer != null && reveal) {
    wrap.appendChild(revealPanel(reveal, question, { mine: myAnswer }));
  } else if (myAnswer != null) {
    wrap.appendChild(waitPanel("Ответ принят. Ждём закрытия вопроса."));
  } else {
    wrap.appendChild(answerForm(question, currentId));
  }

  const board = scoresTable();
  if (board) wrap.appendChild(board);
  return wrap;
}

function waitPanel(text) {
  return h("div", { class: "panel" },
    h("div", { class: "empty-state" },
      h("div", { class: "empty-state-icon", innerHTML: icons.clock }),
      h("h2", {}, text)
    )
  );
}

// Форма ответа участника — единственная часть с фокусом, потому и
// перерисовываемся только по сигнатуре.
function answerForm(question, questionId) {
  const room = local.room;
  const left = openMsLeft();
  const wrap = h("div", { class: "panel" });
  wrap.appendChild(h("div", { class: "panel-head" },
    h("h2", {}, question.text || "Вопрос без текста"),
    left && left > 0 ? h("span", { class: "timer badge badge-neutral" }, formatClock(left)) : null
  ));

  const submitBtn = h("button", { type: "button", class: "btn primary btn-block" }, "Ответить");
  const message = h("div", { class: "form-hint", role: "status" });
  const name = `room-q-${questionId}`;

  if (question.type === "short") {
    const input = h("input", {
      class: "form-control",
      type: "text",
      placeholder: "Ваш ответ",
      "aria-label": "Ответ"
    });
    wrap.appendChild(h("div", { class: "panel-body" },
      h("div", { class: "field" }, input),
      submitBtn, message
    ));
    submitBtn.addEventListener("click", async () => {
      const value = input.value.trim();
      if (!value) { message.textContent = "Введите ответ."; message.className = "form-error"; return; }
      await submitAnswer(room, questionId, value, message, submitBtn, input);
    });
  } else if (question.type === "multiple") {
    const checkboxes = [];
    const box = h("div", { class: "options" },
      (question.options || []).map((option, index) => {
        const cb = h("input", { type: "checkbox", id: `${name}-${index}`, value: String(index) });
        checkboxes.push(cb);
        return h("label", { class: "option", for: `${name}-${index}` }, cb, option.text || "—");
      })
    );
    wrap.appendChild(h("div", { class: "panel-body" }, box, submitBtn, message));
    submitBtn.addEventListener("click", async () => {
      const value = checkboxes.filter(cb => cb.checked).map(cb => Number(cb.value));
      if (!value.length) { message.textContent = "Отметьте хотя бы один вариант."; message.className = "form-error"; return; }
      await submitAnswer(room, questionId, value, message, submitBtn, box);
    });
  } else {
    const radios = [];
    const box = h("div", { class: "options" },
      (question.options || []).map((option, index) => {
        const rb = h("input", { type: "radio", name, id: `${name}-${index}`, value: String(index) });
        radios.push(rb);
        return h("label", { class: "option", for: `${name}-${index}` }, rb, option.text || "—");
      })
    );
    wrap.appendChild(h("div", { class: "panel-body" }, box, submitBtn, message));
    submitBtn.addEventListener("click", async () => {
      const checked = radios.find(rb => rb.checked);
      if (!checked) { message.textContent = "Выберите вариант."; message.className = "form-error"; return; }
      await submitAnswer(room, questionId, Number(checked.value), message, submitBtn, box);
    });
  }
  return wrap;
}

async function submitAnswer(room, questionId, value, message, submitBtn, focusEl) {
  message.textContent = "";
  message.className = "form-hint";
  submitBtn.disabled = true;
  try {
    await saveAnswer(local.code, questionId, value);
    // Снапшот players придёт сам; но перерисуем сразу, чтобы заблокировать
    // повторную отправку, даже если сеть туго тянет подписку.
    const me = myPlayer();
    if (me) {
      me.answers = me.answers || {};
      me.answers[String(questionId)] = value;
      lastSignature = null;
    }
    submitBtn.textContent = "Ответ отправлен";
    toast("Ответ записан", "success");
    scheduleRender(null);
  } catch (err) {
    console.error("Не удалось отправить ответ:", err);
    message.textContent = err?.code === "permission-denied"
      ? "Ответ отклонён (правила Firestore): ведущий мог уже закрыть вопрос или вы уже отвечали."
      : "Ответ не отправлен. Проверьте подключение.";
    message.className = "form-error";
    submitBtn.disabled = false;
    if (focusEl && focusEl.focus) focusEl.focus();
  }
}

// ---------- Вид наблюдателя ----------

function observerView() {
  const room = local.room;
  const test = local.test;
  const questions = test?.questions || [];
  const wrap = h("div", { class: "room-view" });

  wrap.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Live-комната · вы наблюдатель"),
      h("h1", {}, room.testTitle || "Комната"),
      h("p", { class: "page-sub" }, `Код комнаты: ${room.code || room.id} · отвечать нельзя`)
    )
  ));

  const playersCount = local.players.filter(p => !p.observer).length;
  const currentId = room.phase === "opened" || room.phase === "closed"
    ? String(room.currentQuestionId)
    : null;
  const question = currentId !== null ? questions[Number(currentId)] : null;
  const reveal = room.phase === "closed" ? local.reveals?.[currentId] : null;

  if (!question) {
    wrap.appendChild(waitPanel("Ведущий пока не задал вопрос."));
  } else if (reveal) {
    wrap.appendChild(revealPanel(reveal, question, { mine: null }));
  } else {
    wrap.appendChild(questionPanel(question, {}));
    wrap.appendChild(h("div", { class: "panel" },
      h("div", { class: "panel-head" },
        h("h2", {}, "Ответили"),
        h("span", { class: "badge badge-neutral" },
          `${answeredCount(local.players.filter(p => !p.observer), currentId)} из ${playersCount}`)
      )
    ));
  }
  const board = scoresTable();
  if (board) wrap.appendChild(board);
  return wrap;
}

// Раскрытый правильный ответ (после закрытия вопроса).
function revealPanel(reveal, question, { mine }) {
  const data = reveal.reveal || {};
  return h("div", {},
    questionPanel(question, {
      showAnswer: {
        correct: data.correct || [],
        type: data.type,
        answer: data.answer,
        explanation: data.explanation
      }
    }),
    h("div", { class: "panel" },
      h("div", { class: "panel-body" }, h("p", { class: "muted", role: "status" },
        mine !== null && mine !== undefined
          ? "Ответ записан и проверен ведущим. Ждём следующий вопрос."
          : "Вопрос закрыт, правильный ответ раскрыт."))
    )
  );
}

// ---------- Роутер вида ----------

function buildView() {
  const current = role();
  if (current === "host") return hostView();
  if (current === "observer") return observerView();
  if (current === "player") return playerView();
  // Роль ещё не определена: вероятно, игрок не вошёл в комнату.
  return h("div", { class: "room-view" },
    h("div", { class: "panel" },
      h("div", { class: "empty-state" },
        h("div", { class: "empty-state-icon", innerHTML: icons.users }),
        h("h2", {}, "Вы не в этой комнате"),
        h("p", { class: "muted" }, `Войдите по коду ${local.room?.code || local.code || ""}.`),
        h("a", { class: "btn primary", href: `#join/${local.code || ""}` }, "Войти по коду")
      )
    )
  );
}
