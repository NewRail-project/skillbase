// ui/components/battle-captain.js — интерфейс капитана Командной битвы.
// Капитан видит вопрос, варианты, таймер, счет команды,
// может сделать самостоятельный ответ (без голосования), начать голосование.
// Работает с core/battle-game.js для управления потоком.
import { h } from "../../shared/dom.js";
import { isStaff } from "../../core/auth.js";
import { ringTimer } from "./ring-timer.js";
import { ROUND_STATES } from "../../core/battle-game.js";

export function buildBattleCaptain({ test, room, player, gameController, onSelfAnswer, onOpenVote, onUpdateScore }) {
  const state = { showSelfAnswer: false, votingOpen: false, decisionQuestion: null };

  // Основной контейнер: вопрос + варианты + панель капитана
  const el = h("section", { class: "battle-interface captain-interface", "aria-label": "Интерфейс капитана Командной битвы" });

  // Header с командой капитана и счётом
  const captainHeader = h("div", { class: "battle-header captain-header" },
    h("div", { class: "captain-info" },
      h("span", { class: "captain-avatar" }, player.avatar || ""),
      h("b", { class: "captain-name" }, player.displayName || player.uid),
      h("span", { class: "captain-role" }, "Капитан")
    ),
    h("div", { class: "captain-score", "aria-live": "polite", "aria-atomic": "true" },
      h("span", { class: "score-label" }, "Командный счёт:"),
      h("span", { class: "score-value team-a" }, "0"),
      h("span", { class: "score-separator" }, "/"),
      h("span", { class: "score-value team-b" }, "0")
    )
  );

  // Основной вопрос: текст + варианты (только варианты, без личных ответов)
  const questionPanel = h("div", { class: "battle-question-panel captain-question-panel" },
    h("div", { class: "question-header" },
      h("div", { class: "question-index" }, "Вопрос #"),
      h("div", { class: "question-text" }, "Загрузка...")
    ),
    h("div", { class: "options-grid captain-options-grid", "role": "group", "aria-label": "Варианты ответа" })
  );

  // Таймер вопроса
  const timerContainer = h("div", { class: "battle-timer captain-timer" });

  // Панель управления капитана
  const controlsPanel = h("div", { class: "battle-controls captain-controls" },
    h("button", {
      type: "button",
      class: "btn self-answer-btn captain-self-answer",
      onclick: () => {
        // Делаем самостоятельный ответ
        gameController.captainSelfAnswer(player.uid, []);
        state.showSelfAnswer = true;
        render();
      },
      disabled: state.showSelfAnswer || gameController.state.roundState !== ROUND_STATES.OPEN
    }, state.showSelfAnswer ? "Ответ дан" : "Самостоятельный ответ"),
    h("button", {
      type: "button",
      class: "btn primary open-vote-btn captain-open-vote",
      onclick: () => onOpenVote?.(),
      disabled: state.showSelfAnswer || gameController.state.roundState !== ROUND_STATES.OPEN
    }, state.votingOpen ? "Голосование открыто" : "Открыть голосование")
  );

  // Для батона: временный результат самоотвода (показывается после самостоятельного ответа)
  const selfAnswerResult = h("div", { class: "self-answer-result", hidden: true },
    h("div", { class: "result-banner" }, "Ты дал самостоятельный ответ")
  );

  // Интерфейс решающего вопроса (показывается при ничьей)
  const decisionPanel = h("div", { class: "decision-panel", hidden: true },
    h("div", { class: "decision-header" },
      h("h3", {}, "Решающий вопрос!"),
      h("p", { class: "decision-subtitle" }, "Выберите правильный ответ первым")
    ),
    h("div", { class: "question-text" }),
    h("div", { class: "options-grid decision-options" })
  );

  function updateScoreUI(scoreA, scoreB) {
    const captainScoreValue = captainHeader.querySelector(".score-value.team-a");
    const visitorScoreValue = captainHeader.querySelector(".score-value.team-b");
    if (captainScoreValue) captainScoreValue.textContent = String(scoreA);
    if (visitorScoreValue) visitorScoreValue.textContent = String(scoreB);
  }

  function updateQuestionUI(question, options) {
    const index = questionPanel.querySelector(".question-index");
    const text = questionPanel.querySelector(".question-text");
    const grid = questionPanel.querySelector(".options-grid");

    if (index) index.textContent = `Вопрос #${question?.position || ""}`;
    if (text) text.textContent = question?.text || "Загрузка вопроса...";

    // Очищаем варианты
    grid.replaceChildren();

    if (options && options.length) {
      options.forEach((opt, idx) => {
        const isCorrect = opt.isCorrect;
        const button = h("button", {
          type: "button",
          class: `option-btn captain-option-btn ${isCorrect ? "correct" : ""}`, 
          "aria-label": `${opt.text}${isCorrect ? ", верный ответ" : ""}`, 
          disabled: true // Капитан не может голосовать за варианты
        }, h("span", { class: "option-letter" }, String.fromCharCode(65 + idx)), h("span", { class: "option-text" }, opt.text));

        grid.appendChild(button);
      });
    }
  }

  function updateTimerUI(secondsLeft, totalSeconds) {
    timerContainer.replaceChildren();
    timerContainer.appendChild(ringTimer({ totalMs: totalSeconds * 1000, leftMs: secondsLeft * 1000, label: "Время на вопрос" }));
  }

  // Обновление интерфейса решающего вопроса
  function updateDecisionQuestion(question) {
    if (!question) {
      decisionPanel.hidden = true;
      return;
    }
    
    decisionPanel.hidden = false;
    decisionPanel.querySelector(".question-text").textContent = question.text;
    
    const grid = decisionPanel.querySelector(".decision-options");
    grid.replaceChildren();
    
    question.options.forEach((opt, idx) => {
      const btn = h("button", {
        class: "option-btn decision-option-btn",
        onclick: () => {
          // Вызываем метод контроллера для обработки решения капитана
          gameController.makeCaptainDecision(player.uid, opt.id);
        }
      }, h("span", { class: "option-letter" }, String.fromCharCode(65 + idx)), h("span", { class: "option-text" }, opt.text));
      
      grid.appendChild(btn);
    });
  }

  // Функция перерисовки (вызывается после изменений состояния)
  function render() {
    // Показать/скрыть элементы в зависимости от состояния
    controlsPanel.querySelector(".self-answer-btn").textContent = state.showSelfAnswer ? "Ответ дан" : "Самостоятельный ответ";
    controlsPanel.querySelector(".self-answer-btn").classList.toggle("active", state.showSelfAnswer);

    // Показать результат самостоятельного ответа
    if (state.showSelfAnswer) {
      selfAnswerResult.hidden = false;
      controlsPanel.querySelector(".open-vote-btn").disabled = false;
    } else {
      selfAnswerResult.hidden = true;
      controlsPanel.querySelector(".open-vote-btn").disabled = true;
    }

    el.replaceChildren(captainHeader, questionPanel, timerContainer, selfAnswerResult, decisionPanel, controlsPanel);
  }

  // Публичный API
  return {
    el,
    updateQuestion: updateQuestionUI,
    updateTimer: updateTimerUI,
    updateScore: updateScoreUI,
    setSelfAnswerMode: (enabled) => { state.showSelfAnswer = enabled; render(); },
    setVotingOpen: (open) => {
      state.votingOpen = open;
      controlsPanel.querySelector(".open-vote-btn").textContent = open ? "Голосование открыто" : "Открыть голосование";
      controlsPanel.querySelector(".open-vote-btn").disabled = open || state.showSelfAnswer || gameController.state.roundState !== ROUND_STATES.OPEN;
    },
    setDecisionQuestion: (question) => {
      state.decisionQuestion = question;
      updateDecisionQuestion(question);
      render();
    }
  };
}

export const BATTLE_CAPTAIN_CLASS = "captain-interface";