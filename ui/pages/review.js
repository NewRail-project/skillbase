import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { getAttempt, gradeAttempt } from "../../core/attempts.js";
import { getTestForReview } from "../../core/editor.js";
import { isCorrect, normalizeKeys, questionPoints, scoreAttempt } from "../../core/scoring.js";
import { loadPublicProfiles, displayName } from "../../core/profile.js";
import { icons } from "../../shared/icons.js";
import { toast } from "../components/toast.js";

const STATUS_LABEL = {
  in_progress: "Не завершена",
  submitted: "Ожидает проверки",
  graded: "Проверена"
};

const STATUS_BADGE = {
  in_progress: "badge-warning",
  submitted: "badge-info",
  graded: "badge-success"
};

function toDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return "—";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function errorText(err, fallback) {
  if (err?.code === "permission-denied") {
    return "Правила Firestore не разрешают проверку этой попытки.";
  }
  if (err?.code === "unavailable") {
    return "Нет связи с Firestore. Проверьте интернет и повторите.";
  }
  return err?.message || fallback;
}

function optionIndices(answer) {
  return new Set((Array.isArray(answer) ? answer : [answer])
    .map(value => typeof value === "string" ? Number(value) : value)
    .filter(value => Number.isInteger(value)));
}

function correctIndices(key) {
  return new Set((Array.isArray(key?.correct) ? key.correct : [])
    .map(value => typeof value === "string" ? Number(value) : value)
    .filter(value => Number.isInteger(value)));
}

export default async function ReviewPage() {
  const page = h("div", { class: "page" });
  const back = h("a", { class: "btn secondary", href: "#results" }, "К результатам");
  const attemptId = decodeURIComponent((State.routeParam || "").split("/")[0] || "");

  if (!attemptId) {
    page.append(errorPanel("Попытка не указана", "Откройте попытку из журнала результатов.", back));
    return page;
  }

  if (!isStaff()) {
    page.append(errorPanel("Нет доступа", "Проверять попытки могут преподаватели и администраторы.", back));
    return page;
  }

  let attempt = null;
  let attemptError = null;
  try {
    attempt = await getAttempt(attemptId);
  } catch (err) {
    attemptError = err;
  }

  if (attemptError || !attempt) {
    page.append(errorPanel(
      attemptError ? "Не удалось открыть попытку" : "Попытка не найдена",
      attemptError ? errorText(attemptError, "Повторите позже.") : "Ссылка устарела или попытка удалена.",
      back
    ));
    return page;
  }

  const orgId = State.profile?.orgId;
  if (orgId && attempt.orgId !== orgId) {
    page.append(errorPanel("Нет доступа", "Попытка принадлежит другой организации.", back));
    return page;
  }

  let test = null;
  let keysRaw = null;
  let testError = null;
  try {
    const data = await getTestForReview(attempt.testId, attempt.testVersion || null);
    if (data) {
      test = data.test;
      keysRaw = data.keys;
    }
  } catch (err) {
    testError = err;
  }

  if (testError || !test) {
    page.append(errorPanel(
      testError ? "Не удалось открыть тест" : "Тест не найден",
      testError ? errorText(testError, "Повторите позже.") : "Тест удалён, проверить ответы по ключам нельзя.",
      back
    ));
    return page;
  }

  const keys = normalizeKeys(keysRaw);
  if (!keys.length) {
    page.append(errorPanel(
      "Ключи ответов недоступны",
      "Правила Firestore не разрешили прочитать testKeys или ключи не сохранены. Без ключей проверка невозможна.",
      back
    ));
    return page;
  }

  const questions = Array.isArray(test.questions) ? test.questions : [];
  const answers = attempt.answers && typeof attempt.answers === "object" ? attempt.answers : {};
  const canGrade = attempt.status === "submitted" || attempt.status === "graded";

  const decisions = {};
  const storedReview = attempt.review && typeof attempt.review === "object" ? attempt.review : {};
  keys.forEach((key, index) => {
    if (key?.type === "short") {
      const stored = storedReview[String(index)];
      decisions[String(index)] = typeof stored === "boolean"
        ? stored
        : isCorrect(key, answers[String(index)]);
    }
  });

  let studentName = attempt.userName
    || (attempt.userEmail ? attempt.userEmail.split("@")[0] : `Участник ·${(attempt.userId || "").slice(-4)}`);
  try {
    const profiles = await loadPublicProfiles([attempt.userId], orgId);
    const profile = profiles[0];
    if (profile) studentName = displayName(profile, { viewerIsStaff: true, uid: attempt.userId });
  } catch (_) {
    // Имя не критично для проверки; остаётся безопасный запасной вариант.
  }

  const pageHead = h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Проверка"),
      h("h1", {}, test.title || attempt.testTitle || "Попытка"),
      h("p", { class: "page-sub" },
        `${studentName} · ${formatDateTime(attempt.submittedAt || attempt.startedAt)}`)
    ),
    h("div", { class: "page-head-actions" }, back)
  );
  page.appendChild(pageHead);

  const body = h("div");
  page.appendChild(body);

  let saving = false;

  function currentScore() {
    return scoreAttempt(keys, answers, { decisions });
  }

  function questionCorrect(key, index) {
    if (key?.type === "short") return decisions[String(index)] === true;
    return isCorrect(key, answers[String(index)]);
  }

  function updateSummaryScore() {
    const score = currentScore();
    const scoreEl = body.querySelector("[data-score-summary]");
    if (scoreEl) {
      scoreEl.textContent = `${score.score} из ${score.total} · ${score.percent}%`;
    }
    const percentEl = body.querySelector("[data-percent-summary]");
    if (percentEl) percentEl.textContent = `${score.percent}%`;
  }

  function render() {
    body.textContent = "";
    const score = currentScore();

    body.append(h("section", { class: "panel" },
      h("div", { class: "panel-head" },
        h("h2", {}, "Итог"),
        h("span", { class: "badge " + (STATUS_BADGE[attempt.status] || "badge-neutral") },
          STATUS_LABEL[attempt.status] || attempt.status)
      ),
      h("div", { class: "stat-grid" },
        h("div", { class: "stat" },
          h("div", { class: "stat-value", "data-score-summary": "true" },
            `${score.score} из ${score.total} · ${score.percent}%`),
          h("div", { class: "stat-label" }, "баллы")
        ),
        h("div", { class: "stat" },
          h("div", { class: "stat-value", "data-percent-summary": "true" }, `${score.percent}%`),
          h("div", { class: "stat-label" }, "процент")
        ),
        h("div", { class: "stat" },
          h("div", { class: "stat-value" }, test.settings?.passScore != null ? `${test.settings.passScore}%` : "—"),
          h("div", { class: "stat-label" }, "проходной")
        ),
        h("div", { class: "stat" },
          h("div", { class: "stat-value" }, String(keys.length)),
          h("div", { class: "stat-label" }, "вопросов")
        )
      ),
      h("p", { class: "muted" },
        `Ученик: ${studentName}. Отправлено: ${formatDateTime(attempt.submittedAt || attempt.startedAt)}.`)
    ));

    if (attempt.status === "in_progress") {
      body.append(h("div", { class: "notice" },
        "Ученик ещё не отправил попытку. Проверять и сохранять оценку можно только после отправки."));
    }

    const list = h("section", { class: "panel" });
    list.append(h("div", { class: "section-title" },
      h("h2", {}, "Ответы по вопросам"),
      h("span", { class: "muted" }, "Ручная проверка доступна для коротких ответов")
    ));

    keys.forEach((key, index) => {
      const question = questions[index] || {};
      const answer = answers[String(index)];
      const points = questionPoints(key);
      const correct = questionCorrect(key, index);
      const type = key.type || question.type || "single";

      const card = h("div", { class: "item", style: "margin-top:var(--space-3)" });
      card.append(
        h("div", { style: "display:flex;justify-content:space-between;gap:var(--space-3);flex-wrap:wrap" },
          h("div", { class: "list-row-title" }, `${index + 1}. ${question.text || "Вопрос без текста"}`),
          h("span", { class: "badge " + (correct ? "badge-success" : "badge-danger") },
            `${correct ? points : 0} / ${points} б.`)
        ),
        h("div", { class: "list-row-sub" },
          `${type === "short" ? "Короткий ответ" : type === "multiple" ? "Несколько ответов" : "Один ответ"}`)
      );

      if (type === "short") {
        const expected = key.answer ?? "—";
        card.append(
          h("div", { class: "option", style: "white-space:pre-wrap" },
            h("strong", {}, "Ответ ученика: "),
            typeof answer === "string" && answer.trim() ? answer : "нет ответа"),
          h("div", { class: "option correct", style: "white-space:pre-wrap" },
            h("strong", {}, "Ожидаемый ответ: "), String(expected))
        );

        const checkbox = h("input", {
          type: "checkbox",
          checked: Boolean(decisions[String(index)]),
          disabled: !canGrade
        });
        checkbox.addEventListener("change", () => {
          decisions[String(index)] = checkbox.checked;
          updateSummaryScore();
          const badge = card.querySelector("[data-question-badge]");
          if (badge) {
            badge.className = "badge " + (checkbox.checked ? "badge-success" : "badge-danger");
            badge.textContent = `${checkbox.checked ? points : 0} / ${points} б.`;
          }
        });

        const toggle = h("label", {
          class: "option",
          style: "display:flex;gap:var(--space-2);align-items:center;margin-top:var(--space-2);cursor:pointer"
        }, checkbox, h("span", {}, "Засчитать короткий ответ"));
        if (!canGrade) toggle.style.opacity = ".65";
        card.append(toggle);
      } else {
        const options = Array.isArray(question.options) ? question.options : [];
        const selected = optionIndices(answer);
        const expected = correctIndices(key);
        const optionsBox = h("div", { class: "options" });

        if (!options.length) {
          optionsBox.append(h("div", { class: "muted" }, "Варианты ответа недоступны."));
        }

        options.forEach((option, optionIndex) => {
          const isExpected = expected.has(optionIndex);
          const isSelected = selected.has(optionIndex);
          const row = h("div", {
            class: "option" + (isExpected ? " correct" : ""),
            style: "display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap"
          },
            h("span", {}, `${String.fromCharCode(65 + optionIndex)}) ${option.text || "—"}`),
            isExpected ? h("span", { class: "badge badge-success" }, "Верный") : null,
            isSelected ? h("span", { class: "badge badge-info" }, "Ответ ученика") : null
          );
          optionsBox.append(row);
        });

        if (!selected.size) {
          optionsBox.append(h("div", { class: "muted" }, "Ученик не выбрал ответ."));
        }
        card.append(optionsBox);
      }

      // Бейдж пересчитывается при ручной проверке короткого ответа.
      const badge = card.querySelector(".badge");
      if (badge) badge.dataset.questionBadge = "true";
      list.append(card);
    });

    body.append(list);

    const errorBox = h("div", { class: "form-error", role: "alert" });
    const saveBtn = h("button", { type: "button", class: "btn primary" },
      attempt.status === "graded" ? "Сохранить изменения" : "Проверить и сохранить");

    if (!canGrade) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Попытка не отправлена";
    } else {
      saveBtn.addEventListener("click", async () => {
        if (saving) return;
        saving = true;
        saveBtn.disabled = true;
        saveBtn.textContent = "Сохраняем…";
        try {
          const result = await gradeAttempt(attempt, State.user.uid, { [attempt.testId]: keys }, decisions);
          attempt = {
            ...attempt,
            status: "graded",
            score: result.score,
            total: result.total,
            percent: result.percent,
            review: { ...decisions },
            gradedAt: new Date()
          };
          toast("Оценка сохранена", "success");
          saving = false;
          render();
        } catch (err) {
          console.error("Не удалось сохранить проверку:", err);
          saving = false;
          saveBtn.disabled = false;
          saveBtn.textContent = attempt.status === "graded" ? "Сохранить изменения" : "Проверить и сохранить";
          errorBox.textContent = errorText(err, "Не удалось сохранить проверку.");
        }
      });
    }

    const actions = h("section", { class: "panel" },
      h("div", { class: "section-title" }, h("h2", {}, "Оценка")),
      h("p", { class: "muted" },
        "Объективные вопросы проверяются автоматически. Для коротких ответов преподаватель может засчитать ответ вручную."),
      h("div", { class: "btn-row" },
        saveBtn,
        h("a", { class: "btn secondary", href: "#results" }, "К результатам")),
      errorBox
    );
    body.append(actions);
  }

  function errorPanel(title, text, action) {
    return h("div", { class: "panel" },
      h("div", { class: "empty-state" },
        h("div", { class: "empty-state-icon", innerHTML: icons.clipboard }),
        h("h2", {}, title),
        h("p", { class: "muted" }, text),
        action
      )
    );
  }

  render();
  return page;
}
