// core/battle-ui.js — контроллер пользовательского интерфейса Skillbase Battle.
// Управляет показом интерфейсов капитана, игрока и запасного участника.
// Соединяет компоненты с battle.js (если он будет создан) или другими источниками данных.
// Не содержит игровой логики — только отображение и обработку событий.
import { h } from "../shared/dom.js";
import { isStaff } from "./auth.js";
import { buildBattleCaptain } from "../ui/components/battle-captain.js";
import { buildBattlePlayer } from "../ui/components/battle-player.js";
import { buildBattleReserve } from "../ui/components/battle-reserve.js";

export class BattleUIController {
  constructor(room, test, localState, updateService) {
    this.room = room;
    this.test = test;
    this.localState = localState;
    this.updateService = updateService; // { subscribe, unsubscribe }
    this.components = {};

    // Определяем роль текущего пользователя в битве
    this.role = this.determineBattleRole();

    // Создаем UI контейнеры для каждого типа интерфейса
    this.createUIContainers();

    // Создаем компоненты в зависимости от роли
    this.createComponents();

    // Подписываемся на обновления данных битвы
    this.subscribeToBattleUpdates();
  }

  determineBattleRole() {
    const player = this.localState.player;
    if (!player) return "none";

    const role = player.role || "player";
    const isCaptain = player.isCaptain || false;
    const isReserve = player.isReserve || false;

    if (isCaptain) return "captain";
    if (isReserve) return "reserve";
    if (role === "player" || !isStaff()) return "player";

    return "observer";
  }

  createUIContainers() {
    // Создаем контейнеры для каждого типа интерфейса (скрыты по умолчанию)
    this.ui = {
      captain: h("div", { class: "battle-interface-container captain-container", hidden: true }),
      player: h("div", { class: "battle-interface-container player-container", hidden: true }),
      reserve: h("div", { class: "battle-interface-container reserve-container", hidden: true }),
      observer: h("div", { class: "battle-interface-container observer-container", hidden: true })
    };

    // Добавляем контейнеры в DOM (они будут управлять видимостью)
    const app = document.getElementById("app");
    if (app) {
      Object.values(this.ui).forEach(container => app.appendChild(container));
    }
  }

  createComponents() {
    const player = this.localState.player;
    const test = this.test;
    const room = this.room;

    switch (this.role) {
      case "captain":
        this.components.captain = buildBattleCaptain({
          test,
          room,
          player,
          onSelfAnswer: () => this.handleCaptainSelfAnswer(),
          onOpenVote: () => this.handleCaptainOpenVote(),
          onUpdateScore: (scoreA, scoreB) => this.updateTeamScores(scoreA, scoreB)
        });
        this.ui.captain.appendChild(this.components.captain.el);
        break;

      case "player":
        this.components.player = buildBattlePlayer({
          test,
          room,
          player,
          onVote: (option, selected) => this.handlePlayerVote(option, selected),
          onVoteChange: () => this.handleVoteChange()
        });
        this.ui.player.appendChild(this.components.player.el);
        break;

      case "reserve":
        this.components.reserve = buildBattleReserve({
          test,
          room,
          player,
          onSubstitution: () => this.handleReserveSubstitution(),
          onReady: () => this.handleReserveReady()
        });
        this.ui.reserve.appendChild(this.components.reserve.el);
        break;

      case "observer":
        // Наблюдатель может видеть общую информацию, но не участвует в битве
        this.createObserverView();
        break;
    }
  }

  createObserverView() {
    const observerView = h("div", { class: "battle-observer-view" },
      h("div", { class: "observer-header" },
        h("h3", {}, "Интерфейс наблюдателя"),
        h("p", { class: "muted" }, "Вы наблюдаете за битвой, не участвуя в ней")
      ),
      h("div", { class: "observer-content" },
        h("div", { class: "observer-placeholder" },
          h("p", {}, "Данные о битве будут отображаться здесь для наблюдателей")
        )
      )
    );

    this.ui.observer.appendChild(observerView);
  }

  subscribeToBattleUpdates() {
    if (!this.updateService) return;

    // Подписываемся на вопросы битвы
    this.updateService.subscribe("battleQuestion", (question) => {
      if (this.components.captain) this.components.captain.updateQuestion(question);
      if (this.components.player) this.components.player.updateQuestion(question);
      if (this.components.reserve) this.components.reserve.updateQuestion(question);
    });

    // Подписываемся на варианты ответов
    this.updateService.subscribe("battleOptions", (options) => {
      if (this.components.captain) this.components.captain.updateOptions(options);
      if (this.components.player) this.components.player.updateOptions(options);
    });

    // Подписываемся на таймер
    this.updateService.subscribe("battleTimer", (left, total) => {
      if (this.components.captain) this.components.captain.updateTimer(left, total);
      if (this.components.player) this.components.player.updateTimer(left, total);
      if (this.components.reserve) this.components.reserve.updateTimer(left, total);
    });

    // Подписываемся на голоса
    this.updateService.subscribe("battleVotes", (votes, participants) => {
      if (this.components.player) {
        this.components.player.updateVotes(votes, participants);
      }
    });

    // Подписываемся на состояние голосования
    this.updateService.subscribe("battleVotingState", (votingOpen, hasVoted) => {
      if (this.components.captain) this.components.captain.setVotingOpen(votingOpen);
      if (this.components.player) {
        this.components.player.setVotingOpen(votingOpen);
        this.components.player.setHasVoted(hasVoted);
      }
      if (this.components.reserve) {
        this.components.reserve.setSubstitutionApproved(votingOpen && hasVoted);
      }
    });

    // Подписываемся на счета команд
    this.updateService.subscribe("battleScores", (scores) => {
      if (this.components.captain) this.components.captain.updateScore(scores.a, scores.b);
      if (this.components.player) this.components.player.updateScores(scores);
      if (this.components.reserve) this.components.reserve.updateScores(scores);
    });

    // Подписываемся на статус битвы
    this.updateService.subscribe("battleStatus", (status) => {
      if (this.components.reserve) this.components.reserve.setBattleStatus(status);
      this.updateUIVisibility();
    });

    // Подписываемся на статус резервного участника
    this.updateService.subscribe("reserveStatus", (status) => {
      if (this.components.reserve) {
        if (status === "substitution_requested") this.components.reserve.setReadyToSubstitute(true);
        if (status === "substituted") this.components.reserve.setSubstitutionApproved(true);
      }
    });
  }

  handleCaptainSelfAnswer() {
    this.updateService.send("captainSelfAnswer", {
      roomId: this.room.code,
      testId: this.test.id,
      playerId: this.localState.player.uid
    });
  }

  handleCaptainOpenVote() {
    this.updateService.send("captainOpenVote", {
      roomId: this.room.code,
      testId: this.test.id,
      playerId: this.localState.player.uid
    });
  }

  handlePlayerVote(option, selected) {
    this.updateService.send("playerVote", {
      roomId: this.room.code,
      testId: this.test.id,
      playerId: this.localState.player.uid,
      option: option,
      selected: selected
    });
  }

  handleVoteChange() {
    this.updateService.send("voteChange", {
      roomId: this.room.code,
      testId: this.test.id,
      playerId: this.localState.player.uid
    });
  }

  handleReserveSubstitution() {
    this.updateService.send("reserveSubstitution", {
      roomId: this.room.code,
      testId: this.test.id,
      playerId: this.localState.player.uid
    });
  }

  handleReserveReady() {
    this.updateService.send("reserveReady", {
      roomId: this.room.code,
      testId: this.test.id,
      playerId: this.localState.player.uid
    });
  }

  updateTeamScores(scoreA, scoreB) {
    this.updateService.send("updateScores", {
      roomId: this.room.code,
      testId: this.test.id,
      scores: { a: scoreA, b: scoreB }
    });
  }

  updateUIVisibility() {
    // Показываем только интерфейс для текущей роли
    Object.keys(this.ui).forEach(role => {
      this.ui[role].hidden = role !== this.role;
    });

    // Для капитана и игрока показываем battle-interface-контейнеры
    if (["captain", "player"].includes(this.role)) {
      this.ui[this.role].classList.add("active");
    }
  }

  destroy() {
    if (this.updateService) {
      this.updateService.unsubscribeAll();
    }

    Object.values(this.ui).forEach(container => {
      if (container.parentNode) container.parentNode.removeChild(container);
    });
  }
}

// Фабрика для создания battle UI контроллера
export function createBattleUI(room, test, localState, updateService) {
  return new BattleUIController(room, test, localState, updateService);
}