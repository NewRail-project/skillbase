// ui/components/battle-reserve.js — интерфейс запасного участника Командной битвы.
// Запасной видит состояние битвы, но не может голосовать до выхода на замену.
import { h } from "../../shared/dom.js";
import { ringTimer } from "./ring-timer.js";

export function buildBattleReserve({ test, room, player, onSubstitution, onReady }) {
  const state = {
    question: null,
    options: [],
    timeLeft: 0,
    totalTime: 0,
    teamScore: { a: 0, b: 0 },
    battleStatus: "waiting", // waiting, active, completed
    myTeam: null,
    readyToSubstitute: false,
    substitutionApproved: false
  };

  // Основной контейнер: информация о резерве + состояние битвы
  const el = h("section", { class: "battle-interface reserve-interface", "aria-label": "Интерфейс запасного участника Командной битвы" });

  // Header с информацией о резерве
  const reserveHeader = h("div", { class: "battle-header reserve-header" },
    h("div", { class: "reserve-info-header" },
      h("span", { class: "reserve-icon" }, "🔒"),
      h("b", { class: "reserve-name" }, player.displayName || player.uid),
      h("span", { class: "reserve-badge" }, "Запасной")
    ),
    h("div", { class: "substitution-status" },
      h("span", { class: "substitution-label" }, "Статус:"),
      h("span", { class: "substitution-indicator" }, "В резерве, ожидаете")
    )
  );

  // Панель состояния битвы (видна только когда битва активна)
  const battleStatusPanel = h("div", { class: "battle-status-panel reserve-battle-status" },
    h("div", { class: "status-header" },
      h("h3", {}, "Состояние битвы"),
      h("span", { class: "status-indicator status-" + state.battleStatus }, state.battleStatus === "active" ? "Активна" : "Ожидание")
    ),
    h("div", { class: "status-content" },
      h("div", { class: "question-info" },
        h("span", { class: "label" }, "Вопрос:"),
        h("span", { class: "value question-text" }, "Загрузка...")
      ),
      h("div", { class: "timer-info" },
        h("span", { class: "label" }, "Осталось времени:"),
        h("span", { class: "value timer-text" }, "—")
      ),
      h("div", { class: "scores-info" },
        h("div", { class: "team-score" },
          h("span", { class: "team-label" }, "Команда А:"),
          h("span", { class: "score-value team-a" }, "0")
        ),
        h("div", { class: "team-score" },
          h("span", { class: "team-label" }, "Команда Б:"),
          h("span", { class: "score-value team-b" }, "0")
        )
      ),
      h("div", { class: "voting-info" },
        h("span", { class: "label" }, "Голосование:"),
        h("span", { class: "value voting-text" }, "Ожидание открытия")
      )
    )
  );

  // Панель управления запасным участником
  const controlPanel = h("div", { class: "battle-controls reserve-controls" },
    h("button", {
      type: "button",
      class: "btn secondary substitute-btn",
      onclick: () => {
        if (state.battleStatus === "active" && !state.readyToSubstitute && !state.substitutionApproved) {
          onSubstitution?.();
          state.readyToSubstitute = true;
          render();
        }
      },
      disabled: state.battleStatus !== "active" || state.readyToSubstitute || state.substitutionApproved
    }, state.readyToSubstitute ? "Запрошена замена" : "Запросить замену"),
    h("button", {
      type: "button",
      class: "btn primary ready-btn",
      onclick: () => {
        onReady?.();
      },
      disabled: state.battleStatus !== "active"
    }, "Готов к выходу")
  );

  function updateQuestionUI() {
    const textEl = battleStatusPanel.querySelector(".question-text");
    if (textEl) textEl.textContent = state.question?.text || "Загрузка...";
  }

  function updateTimerUI() {
    const textEl = battleStatusPanel.querySelector(".timer-text");
    if (textEl && state.timeLeft > 0 && state.totalTime > 0) {
      const minutes = Math.floor(state.timeLeft / 60);
      const seconds = state.timeLeft % 60;
      textEl.textContent = `${minutes}:${seconds.toString().padStart(2, "0")}`;
    } else if (textEl) {
      textEl.textContent = "—";
    }
  }

  function updateScoresUI() {
    const aScore = battleStatusPanel.querySelector(".team-a .score-value");
    const bScore = battleStatusPanel.querySelector(".team-b .score-value");
    if (aScore) aScore.textContent = String(state.teamScore.a);
    if (bScore) bScore.textContent = String(state.teamScore.b);
  }

  function updateVotingUI() {
    const textEl = battleStatusPanel.querySelector(".voting-text");
    if (textEl) {
      if (state.battleStatus === "active") {
        if (state.substitutionApproved) {
          textEl.textContent = "Голосование открыто (вы вышли на замену)";
          textEl.className = "value voting-text active";
        } else {
          textEl.textContent = "Голосование ожидает вашего входа";
          textEl.className = "value voting-text waiting";
        }
      } else {
        textEl.textContent = "Битва не началась";
        textEl.className = "value voting-text idle";
      }
    }
  }

  function updateStatusUI() {
    const indicator = reserveHeader.querySelector(".substitution-indicator");
    const controlBtn = controlPanel.querySelector(".substitute-btn");

    if (indicator) {
      if (state.substitutionApproved) {
        indicator.textContent = "Замена одобрена, ожидаете выхода";
        indicator.className = "substitution-indicator approved";
      } else if (state.readyToSubstitute) {
        indicator.textContent = "Запрос на замену отправлен";
        indicator.className = "substitution-indicator pending";
      } else {
        indicator.textContent = "В резерве, ожидаете";
        indicator.className = "substitution-indicator waiting";
      }
    }

    if (controlBtn) {
      controlBtn.disabled = state.battleStatus !== "active" || state.readyToSubstitute || state.substitutionApproved;
      controlBtn.textContent = state.readyToSubstitute ? "Запрошена замена" : "Запросить замену";
      controlBtn.className = `btn secondary substitute-btn ${state.readyToSubstitute ? "active" : ""}`;
    }
  }

  function render() {
    // Показать/скрыть элементы в зависимости от состояния
    if (state.battleStatus === "active") {
      battleStatusPanel.hidden = false;
      controlPanel.hidden = false;
      reserveInfo.hidden = true;
    } else {
      battleStatusPanel.hidden = true;
      controlPanel.hidden = true;
      reserveInfo.hidden = false;
    }

    updateVotingUI();
    updateStatusUI();

    el.replaceChildren(reserveHeader, battleStatusPanel, controlPanel);
  }

  return {
    el,
    updateQuestion: (q) => { state.question = q; updateQuestionUI(); render(); },
    updateTimer: (left, total) => { state.timeLeft = left; state.totalTime = total; updateTimerUI(); },
    updateScores: (scores) => { state.teamScore = scores; updateScoresUI(); },
    setBattleStatus: (status) => { state.battleStatus = status; render(); },
    setSubstitutionApproved: (approved) => { state.substitutionApproved = approved; render(); },
    setMyTeam: (team) => { state.myTeam = team; },
    setReadyToSubstitute: (ready) => { state.readyToSubstitute = ready; render(); }
  };
}

export const BATTLE_RESERVE_CLASS = "reserve-interface";