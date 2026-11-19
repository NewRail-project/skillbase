// ui/components/battle-player.js — интерфейс обычного игрока Командной битвы.
// Игрок видит вопрос, варианты, таймер, количество голосовавших, 
// состояние голосования, счёт команд, но не видит личные голоса.
// Работает с core/battle-game.js для управления потоком.
import { h } from "../../shared/dom.js";
import { ringTimer } from "./ring-timer.js";
import { ROUND_STATES } from "../../core/battle-game.js";

export function buildBattlePlayer({ test, room, player, gameController, onVote, onVoteChange }) {
  const state = {
    question: null,
    options: [],
    timeLeft: 0,
    totalTime: 0,
    hasVoted: false,
    votingOpen: false,
    teamScore: { a: 0, b: 0 }, // счет команд
    votesCount: 0, // общее количество голосов
    participantCount: 0 // общее количество участников
  };

  // Основной контейнер: вопрос + варианты + панель игрока
  const el = h("section", { class: "battle-interface player-interface", "aria-label": "Интерфейс игрока Командной битвы" });

  // Header с информацией об игроке
  const playerHeader = h("div", { class: "battle-header player-header" },
    h("div", { class: "player-info" },
      h("span", { class: "player-avatar" }, player.avatar || ""),
      h("b", { class: "player-name" }, player.displayName || player.uid),
      h("span", { class: "player-role" }, "Участник")
    ),
    h("div", { class: "player-stats" },
      h("div", { class: "votes-info", "aria-live": "polite", "aria-atomic": "true" },
        h("span", { class: "votes-count-label" }, "Голосовавших:"),
        h("span", { class: "votes-count-value" }, "0 / 0")
      ),
      h("div", { class: "voting-status" },
        h("span", { class: "voting-label" }, "Состояние:"),
        h("span", { class: "voting-indicator" }, "Ожидание...")
      )
    )
  );

  // Основной вопрос: текст + варианты
  const questionPanel = h("div", { class: "battle-question-panel player-question-panel" },
    h("div", { class: "question-header" },
      h("div", { class: "question-index" }, "Вопрос #"),
      h("div", { class: "question-text" }, "Загрузка...")
    ),
    h("div", { class: "options-grid player-options-grid", "role": "group", "aria-label": "Варианты ответа" })
  );

  // Таймер вопроса
  const timerContainer = h("div", { class: "battle-timer player-timer" });

  // Панель скандирования очков команд
  const scoresPanel = h("div", { class: "battle-scores player-scores" },
    h("div", { class: "score-row team-a-row" },
      h("span", { class: "team-label" }, "Команда А:"),
      h("span", { class: "score-value team-a" }, "0")
    ),
    h("div", { class: "score-row team-b-row" },
      h("span", { class: "team-label" }, "Команда Б:"),
      h("span", { class: "score-value team-b" }, "0")
    )
  );

  // Информация для запасного участника (если он запасной)
  const reserveInfo = h("div", { class: "reserve-info player-reserve-info", hidden: true },
    h("div", { class: "reserve-status" },
      h("span", { class: "reserve-icon" }, "🔒"),
      h("span", { class: "reserve-text" }, "Вы в резерве, ожидаете замены")
    )
  );

  function updateQuestionUI() {
    const index = questionPanel.querySelector(".question-index");
    const text = questionPanel.querySelector(".question-text");
    const grid = questionPanel.querySelector(".options-grid");

    if (index) index.textContent = `Вопрос #${state.question?.position || ""}`;
    if (text) text.textContent = state.question?.text || "Загрузка вопроса...";

    // Очищаем варианты
    grid.replaceChildren();

    if (state.options && state.options.length) {
      state.options.forEach((opt, idx) => {
        const isCorrect = opt.isCorrect;
        const isSelected = opt.isSelected;
        const isVoted = opt.isVoted;

        const button = h("button", {
          type: "button",
          class: `option-btn player-option-btn ${isSelected ? "selected" : ""} ${isVoted ? "voted" : ""} ${isCorrect ? "correct" : ""}`, 
          "aria-label": `${opt.text}${isCorrect ? ", верный ответ" : ""}${isSelected ? ", выбран вами" : ""}${isVoted ? ", проголосовали" : ""}`, 
          onclick: () => {
            if (!state.votingOpen || state.hasVoted) return;
            const newSelected = !isSelected;
            gameController.castVote({ uid: player.uid, selected: [opt.text] });
            onVote?.(opt.text, newSelected);
          },
          disabled: !state.votingOpen || state.hasVoted
        }, h("span", { class: "option-letter" }, String.fromCharCode(65 + idx)), h("span", { class: "option-text" }, opt.text));

        grid.appendChild(button);
      });
    }
  }

  function updateTimerUI() {
    timerContainer.replaceChildren();
    if (state.timeLeft > 0 && state.totalTime > 0) {
      timerContainer.appendChild(ringTimer({ totalMs: state.totalTime * 1000, leftMs: state.timeLeft * 1000, label: "Время на вопрос" }));
    }
  }

  function updateScoresUI() {
    const aScore = scoresPanel.querySelector(".team-a .score-value");
    const bScore = scoresPanel.querySelector(".team-b .score-value");
    if (aScore) aScore.textContent = String(state.teamScore.a);
    if (bScore) bScore.textContent = String(state.teamScore.b);
  }

  function updateVotesUI() {
    const container = playerHeader.querySelector(".votes-info");
    const countEl = container.querySelector(".votes-count-value");
    if (countEl) countEl.textContent = `${state.votesCount} / ${state.participantCount}`;

    const statusEl = playerHeader.querySelector(".voting-indicator");
    if (statusEl) {
      if (state.votingOpen) {
        statusEl.textContent = state.hasVoted ? "Голосование открыто, ваш ответ выбран" : "Голосование открыто";
        statusEl.className = "voting-indicator open";
      } else {
        statusEl.textContent = "Голосование закрыто";
        statusEl.className = "voting-indicator closed";
      }
    }

    // Показать/скрыть резервную информацию
    if (state.hasVoted && !state.votingOpen) {
      reserveInfo.hidden = false;
    } else {
      reserveInfo.hidden = true;
    }
  }

  function render() {
    // Показать/скрыть элементы
    const grid = questionPanel.querySelector(".options-grid");
    if (grid) {
      if (state.votingOpen && !state.hasVoted) {
        grid.classList.add("voting-open");
      } else {
        grid.classList.remove("voting-open");
      }

      // Для запасного участника блокируем кнопки, если он в резерве
      if (grid.querySelectorAll(".option-btn").length > 0) {
        grid.querySelectorAll(".option-btn").forEach(btn => {
          btn.disabled = !state.votingOpen || state.hasVoted;
        });
      }
    }

    el.replaceChildren(playerHeader, questionPanel, timerContainer, scoresPanel, reserveInfo);
    updateVotesUI();
  }

  return {
    el,
    updateQuestion: (q) => { state.question = q; updateQuestionUI(); render(); },
    updateOptions: (options) => { state.options = options; updateQuestionUI(); },
    updateTimer: (left, total) => { state.timeLeft = left; state.totalTime = total; updateTimerUI(); },
    updateScores: (scores) => { state.teamScore = scores; updateScoresUI(); },
    updateVotes: (votes, participants) => {
      state.votesCount = votes;
      state.participantCount = participants;
      updateVotesUI();
    },
    setVotingOpen: (open) => { state.votingOpen = open; render(); },
    setHasVoted: (voted) => { state.hasVoted = voted; render(); },
    setReserveMode: (reserve) => { reserveInfo.hidden = !reserve; }
  };
}

export const BATTLE_PLAYER_CLASS = "player-interface";