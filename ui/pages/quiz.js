// ui/pages/quiz.js — страница прохождения теста (этап 1: стабилизация).
// STATUS: stub, будет заменён на этапе 5.
import { State } from "../../core/auth.js";
import { loadTest } from "../../core/editor.js";
import { h, clear } from "../../shared/dom.js";

export default function QuizPage() {
  const div = h("div", { class: "quiz-container" });

  const showNotice = (msg) => {
    clear(div);
    div.appendChild(h("p", { class: "notice" }, msg));
  };

  const init = async () => {
    const testId = State.routeParam;
    if (!testId) {
      showNotice("Тест не найден");
      return;
    }
    if (!State.user) {
      showNotice("Нужно войти в аккаунт");
      return;
    }
    try {
      const test = await loadTest(testId);
      if (!test) {
        showNotice("Тест не найден");
        return;
      }
      // На этапе 1 полная логика прохождения не реализована.
      showNotice("Раздел обновляется. Прохождение теста будет доступно на этапе 5.");
    } catch (e) {
      showNotice("Ошибка загрузки теста");
    }
  };

  init();
  return div;
}

export function cleanup() {
  // Ничего не очищается на этапе 1.
}