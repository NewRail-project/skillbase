import { h } from "../../shared/dom.js";
import { State, isStaff } from "../../core/auth.js";
import { loadTest } from "../../core/editor.js";
import {
  startAttempt,
  saveAttemptAnswers,
  submitAttemptById,
  listMyAttemptsForTest
} from "../../core/attempts.js";
import { getAssignment, assignTest } from "../../core/assign.js";
import { isDeadlinePassed } from "../../core/timing.js";
import { icons } from "../../shared/icons.js";
import { toast } from "../components/toast.js";

const TYPE_LABEL = {
  single: "Один ответ",
  multiple: "Несколько ответов",
  short: "Короткий ответ"
};

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

// Таймеры и отложенное сохранение живут на уровне модуля: роутер вызывает
// cleanup() при уходе со страницы, даже если DOM уже заменён.
let timerId = null;
let saveTimer = null;
let unloadHandler = null;
let flushSave = null;

export function cleanup() {
  try { flushSave?.(); } catch (_) {}
  if (timerId) clearInterval(timerId);
  if (saveTimer) clearTimeout(saveTimer);
  if (unloadHandler) window.removeEventListener("beforeunload", unloadHandler);
  timerId = null;
  saveTimer = null;
  unloadHandler = null;
  flushSave = null;
}

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
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function totalSeconds(settings, questionCount) {
  const total = Number(settings?.totalTime);
  if (Number.isFinite(total) && total > 0) return total;

  const perQuestion = Number(settings?.timePerQuestion);
  if (Number.isFinite(perQuestion) && perQuestion > 0) {
    return perQuestion * Math.max(1, questionCount);
  }
  return null;
}

function errorText(err, fallback) {
  if (err?.code === "permission-denied") {
    return "Правила Firestore не разрешили это действие. Обратитесь к администратору.";
  }
  if (err?.code === "unavailable" || err?.code === "failed-precondition") {
    return "Нет связи с Firestore. Проверьте интернет и повторите попытку.";
  }
  return err?.message || fallback;
}

function localKey(attemptId) {
  return `sb:attempt:${attemptId}`;
}

function readLocal(attemptId) {
  try {
    const raw = localStorage.getItem(localKey(attemptId));
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function writeLocal(attemptId, answers) {
  try {
    localStorage.setItem(localKey(attemptId), JSON.stringify({ answers, savedAt: Date.now() }));
  } catch (_) {}
}

function clearLocal(attemptId) {
  try { localStorage.removeItem(localKey(attemptId)); } catch (_) {}
}

function isAnswered(value) {
  if (typeof value === "number") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return false;
}

function scoreText(attempt) {
  if (attempt?.status !== "graded") return null;
  const score = Number(attempt.score) || 0;
  const total = Number(attempt.total) || 0;
  const percent = Number(attempt.percent) || 0;
  return { score, total, percent };
}

function attemptTime(attempt) {
  return toDate(attempt?.submittedAt || attempt?.startedAt)?.getTime() || 0;
}

export default async function QuizPage() {
  cleanup();

  const page = h("div", { class: "page" });
  const content = h("div");
  const back = h("a", { class: "btn secondary", href: "#tests" }, "К каталогу");
  let submitting = false;

  const parts = (State.routeParam || "").split("/");
  const testId = decodeURIComponent(parts[0] || "");
  const assignmentId = decodeURIComponent(parts[1] || "");

  if (!testId) {
    page.append(errorPanel("Тест не указан", "Откройте тест из каталога или списка заданий.", back));
    return page;
  }

  let test = null;
  let loadError = null;
  try {
    test = await loadTest(testId);
  } catch (err) {
    loadError = err;
  }

  if (loadError || !test) {
    const text = loadError?.code === "permission-denied"
      ? "Правила Firestore не разрешают чтение этого теста."
      : loadError?.code === "unavailable"
        ? "Нет связи с Firestore. Проверьте подключение к интернету."
        : "Возможно, тест снят с публикации или ссылка устарела.";
    page.append(errorPanel(loadError ? "Не удалось открыть тест" : "Тест не найден", text, back));
    return page;
  }

  const questions = Array.isArray(test.questions) ? test.questions : [];
  const settings = test.settings || {};
  const staff = isStaff();
  const profile = State.profile || {};

  if (!staff && test.status !== "published") {
    page.append(errorPanel("Тест недоступен", "Тест ещё не опубликован.", back));
    return page;
  }

  if (test.orgId && profile.orgId && test.orgId !== profile.orgId) {
    page.append(errorPanel("Тест недоступен", "Тест принадлежит другой организации.", back));
    return page;
  }

  if (!questions.length) {
    page.append(errorPanel("В тесте нет вопросов", "Преподаватель ещё не добавил вопросы.", back));
    return page;
  }

  // Задание читаем только при переходе по ссылке из «Заданий».
  let assignment = null;
  let assignmentError = null;
  if (assignmentId) {
    try {
      assignment = await getAssignment(assignmentId);
      if (!assignment) assignmentError = "Задание не найдено.";
    } catch (err) {
      assignmentError = err?.code === "permission-denied"
        ? "Задание закрыто или назначено другой группе."
        : errorText(err, "Не удалось прочитать задание.");
    }
  }

  if (assignment && assignment.testId !== test.id) {
    assignmentError = "Ссылка на задание не соответствует тесту.";
  }

  if (!staff && assignment) {
    if (assignment.status !== "active") {
      assignmentError = "Задание закрыто.";
    } else if (assignment.orgId && profile.orgId && assignment.orgId !== profile.orgId) {
      assignmentError = "Задание принадлежит другой организации.";
    } else if (profile.groupId && assignment.groupId !== profile.groupId) {
      assignmentError = "Задание назначено другой группе.";
    } else if (!profile.groupId) {
      assignmentError = "В профиле не указана группа. Обратитесь к администратору.";
    }
  }

  const assignmentDeadline = toDate(assignment?.deadline);
  const deadlinePassed = isDeadlinePassed(assignmentDeadline);
  const timeLimit = totalSeconds(settings, questions.length);

  const rawLimit = assignment?.attemptsLimit ?? settings.attemptsLimit;
  const parsedLimit = Number(rawLimit);
  const attemptsLimit = Number.isFinite(parsedLimit) && parsedLimit >= 1
    ? Math.min(100, Math.floor(parsedLimit))
    : 1;

  let attempts = [];
  let attemptsError = null;
  let autoSubmitted = false;
  let expiredError = null;

  if (!staff) {
    try {
      attempts = await listMyAttemptsForTest(State.user.uid, test.id);
    } catch (err) {
      attemptsError = err;
    }
  }

  // Лимит попыток относится к конкретному назначению. Иначе попытки,
  // сделанные по прямой ссылке или по другому заданию, расходовали бы
  // лимит нового назначения.
  const scopedAttempts = () => assignment
    ? attempts.filter(item => (item.assignmentId || "") === assignment.id)
    : attempts;
  const activeAttempt = () => scopedAttempts().find(item => item.status === "in_progress") || null;
  const completedCount = () => scopedAttempts().filter(item => item.status !== "in_progress").length;

  function attemptDeadlineMs(attempt) {
    const started = toDate(attempt?.startedAt)?.getTime();
    const byTime = started && timeLimit ? started + timeLimit * 1000 : null;
    const stored = toDate(attempt?.deadlineAt)?.getTime() || null;
    const assigned = assignmentDeadline?.getTime() || null;
    const limits = [byTime, stored, assigned].filter(value => Number.isFinite(value));
    return limits.length ? Math.min(...limits) : null;
  }

  // Если ученик закрыл вкладку, а время истекло — отправляем сохранённые
  // ответы. Это не оценка: проверку всё равно делает преподаватель.
  if (!staff) {
    const active = activeAttempt();
    if (active) {
      const deadline = attemptDeadlineMs(active);
      if (deadline && Date.now() >= deadline) {
        try {
          const local = readLocal(active.id);
          const answers = { ...(active.answers || {}), ...(local?.answers || {}) };
          await submitAttemptById(active.id, answers);
          clearLocal(active.id);
          autoSubmitted = true;
          attempts = attempts.map(item => item.id === active.id
            ? { ...item, status: "submitted", submittedAt: new Date(), finishedAt: new Date() }
            : item);
          try {
            attempts = await listMyAttemptsForTest(State.user.uid, test.id);
          } catch (_) {
            // Отправка уже прошла; список обновится при следующем открытии.
          }
        } catch (err) {
          expiredError = err;
        }
      }
    }
  }

  page.appendChild(h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Тест"),
      h("h1", {}, test.title || "Без названия"),
      test.description ? h("p", { class: "page-sub" }, test.description) : null
    ),
    h("div", { class: "page-head-actions" }, back)
  ));
  page.appendChild(content);

  if (staff) {
    renderStaffIntro();
  } else {
    renderStudentIntro();
  }

  return page;

  // ---------- Общие панели ----------

  function errorPanel(title, text, action) {
    return h("div", { class: "panel" },
      h("div", { class: "empty-state" },
        h("div", { class: "empty-state-icon", innerHTML: icons.book }),
        h("h2", {}, title),
        h("p", { class: "muted" }, text),
        action
      )
    );
  }

  function statsGrid() {
    return h("section", { class: "stat-grid" },
      h("div", { class: "stat" },
        h("div", { class: "stat-value" }, String(questions.length)),
        h("div", { class: "stat-label" }, "вопросов")
      ),
      h("div", { class: "stat" },
        h("div", { class: "stat-value" }, settings.timePerQuestion ? settings.timePerQuestion + " с" : "—"),
        h("div", { class: "stat-label" }, "на вопрос")
      ),
      h("div", { class: "stat" },
        h("div", { class: "stat-value" }, settings.passScore != null ? settings.passScore + "%" : "—"),
        h("div", { class: "stat-label" }, "проходной балл")
      ),
      h("div", { class: "stat" },
        h("div", { class: "stat-value" }, String(attemptsLimit)),
        h("div", { class: "stat-label" }, "попыток")
      )
    );
  }

  function instructionsPanel() {
    if (!test.instructions) return null;
    return h("section", { class: "panel" },
      h("div", { class: "section-title" }, h("h2", {}, "Инструкция")),
      h("p", { class: "muted", style: "margin:8px 0 0;white-space:pre-line" }, test.instructions)
    );
  }

  function resultPanel(attempt) {
    if (!attempt) return null;
    const score = scoreText(attempt);
    if (score) {
      const passed = settings.passScore != null ? score.percent >= Number(settings.passScore) : null;
      return h("section", { class: "panel" },
        h("div", { class: "section-title" },
          h("h2", {}, "Результат"),
          h("span", { class: "badge " + (passed === true ? "badge-success" : passed === false ? "badge-danger" : "badge-neutral") },
            passed === true ? "Пройден" : passed === false ? "Не пройден" : "Проверен")
        ),
        h("p", { style: "font-size:1.5rem;margin:8px 0" },
          `${score.score} из ${score.total} · ${score.percent}%`),
        settings.passScore != null
          ? h("p", { class: "muted" }, `Проходной балл: ${settings.passScore}%.`)
          : null
      );
    }

    if (attempt.status === "submitted") {
      return h("section", { class: "panel" },
        h("div", { class: "notice" },
          h("strong", {}, "Ответы отправлены. "),
          "Преподаватель проверит их и выставит оценку. Правильные ответы ученику не показываются."
        )
      );
    }
    return null;
  }

  function historyPanel() {
    if (!attempts.length) return null;
    const list = h("div", { class: "list" });
    attempts.slice(0, 6).forEach(attempt => {
      const score = scoreText(attempt);
      list.appendChild(h("div", { class: "list-row" },
        h("span", { class: "badge " + (STATUS_BADGE[attempt.status] || "badge-neutral") },
          STATUS_LABEL[attempt.status] || attempt.status),
        h("div", { class: "list-row-main" },
          h("div", { class: "list-row-title" },
            score ? `${score.score} из ${score.total} · ${score.percent}%` : "Попытка"),
          h("div", { class: "list-row-sub" },
            `${formatDateTime(attempt.submittedAt || attempt.startedAt)} · попытка ${attempt.attemptNo || "—"}`)
        )
      ));
    });
    return h("section", { class: "panel panel-flush" },
      h("div", { class: "panel-head" }, h("h2", {}, "Мои попытки")),
      list
    );
  }

  // ---------- Преподаватель ----------

  function renderStaffIntro() {
    content.textContent = "";
    content.append(statsGrid());
    const instructions = instructionsPanel();
    if (instructions) content.append(instructions);

    const list = h("section", { class: "panel panel-flush" });
    list.appendChild(h("div", { class: "panel-head" },
      h("h2", {}, "Содержание"),
      h("span", { class: "badge " + (test.status === "published" ? "badge-success" : "badge-warning") },
        test.status === "published" ? "Опубликован" : "Черновик")
    ));

    const questionsBox = h("div", { class: "list" });
    questions.forEach((question, index) => {
      const options = Array.isArray(question.options) ? question.options : [];
      questionsBox.appendChild(h("div", { class: "list-row", style: "align-items:flex-start" },
        h("span", { class: "badge badge-neutral" }, String(index + 1)),
        h("div", { class: "list-row-main" },
          h("div", { class: "list-row-title" }, question.text || "Вопрос без текста"),
          h("div", { class: "list-row-sub" },
            `${TYPE_LABEL[question.type] || "Вопрос"} · ${question.points || 1} б.`),
          options.length
            ? h("ul", { class: "muted", style: "margin:8px 0 0;padding-left:20px" },
                options.map(option => h("li", {}, `${option.text || "—"}${option.correct ? "  ✓" : ""}`)))
            : null,
          question.type === "short" && question.answer
            ? h("div", { class: "option correct", style: "margin-top:8px" }, `Ответ: ${question.answer}`)
            : null
        )
      ));
    });
    list.appendChild(questionsBox);
    content.append(list);

    const actions = h("section", { class: "panel" },
      h("div", { class: "section-title" }, h("h2", {}, "Действия преподавателя")),
      h("div", { class: "btn-row" },
        h("a", { class: "btn primary", href: `#create-test/${encodeURIComponent(test.id)}` }, "Открыть редактор"),
        h("a", { class: "btn secondary", href: "#results" }, "Результаты")
      )
    );

    if (test.status === "published") {
      const groupInput = h("input", { type: "text", placeholder: "Например, ИТ-01", maxlength: "100" });
      const deadlineInput = h("input", { type: "datetime-local" });
      const limitInput = h("input", {
        type: "number", min: "1", max: "50",
        value: String(settings.attemptsLimit || 1)
      });
      const message = h("div", { class: "form-hint", role: "status" });
      const assignBtn = h("button", { type: "button", class: "btn primary" }, "Назначить группе");

      assignBtn.addEventListener("click", async () => {
        message.textContent = "";
        message.className = "form-hint";
        const groupId = groupInput.value.trim();
        if (!groupId) {
          message.textContent = "Укажите группу.";
          message.className = "form-error";
          return;
        }
        if (deadlineInput.value && new Date(deadlineInput.value).getTime() <= Date.now()) {
          message.textContent = "Срок выполнения должен быть в будущем.";
          message.className = "form-error";
          return;
        }

        assignBtn.disabled = true;
        assignBtn.textContent = "Назначаем…";
        try {
          await assignTest({
            test,
            teacherId: State.user.uid,
            groupId,
            deadline: deadlineInput.value || null,
            attemptsLimit: limitInput.value || null
          });
          message.textContent = `Тест назначен группе «${groupId}».`;
          message.className = "form-hint";
          toast("Задание создано", "success");
        } catch (err) {
          console.error("Не удалось назначить тест:", err);
          message.textContent = errorText(err, "Не удалось назначить тест.");
          message.className = "form-error";
        } finally {
          assignBtn.disabled = false;
          assignBtn.textContent = "Назначить группе";
        }
      });

      actions.append(
        h("div", { class: "section-title", style: "margin-top:var(--space-5)" },
          h("h2", {}, "Назначить группе")),
        h("p", { class: "muted" }, "Студенты увидят задание, если администратор указал им эту группу."),
        h("div", { class: "field-grid" },
          h("div", { class: "field" }, h("label", {}, "Группа"), groupInput),
          h("div", { class: "field" }, h("label", {}, "Срок сдачи"), deadlineInput),
          h("div", { class: "field" }, h("label", {}, "Попыток"), limitInput)
        ),
        h("div", { class: "btn-row" }, assignBtn),
        message
      );
    } else {
      actions.append(h("p", { class: "muted", style: "margin-top:var(--space-3)" },
        "Опубликуйте тест, чтобы назначать его группам."));
    }

    content.append(actions);
  }

  // ---------- Ученик ----------

  function renderStudentIntro() {
    content.textContent = "";
    content.append(statsGrid());
    const instructions = instructionsPanel();
    if (instructions) content.append(instructions);

    if (autoSubmitted) {
      content.append(h("div", { class: "notice" },
        "Время попытки истекло. Сохранённые ответы отправлены на проверку."));
    }

    if (assignmentError) {
      content.append(h("div", { class: "notice" },
        h("strong", {}, "Задание недоступно. "), assignmentError));
    }

    if (attemptsError) {
      content.append(h("div", { class: "notice" },
        h("strong", {}, "Не удалось загрузить попытки. "),
        errorText(attemptsError, "Обновите страницу и попробуйте снова.")));
    }

    const latest = scopedAttempts()[0] || null;
    const result = resultPanel(latest);
    if (result) content.append(result);
    const history = historyPanel();
    if (history) content.append(history);

    const active = activeAttempt();
    const completed = completedCount();
    const limitReached = completed >= attemptsLimit;
    const activeDeadline = active ? attemptDeadlineMs(active) : null;
    const activeExpired = activeDeadline ? activeDeadline <= Date.now() : false;

    const actions = h("section", { class: "panel" },
      h("div", { class: "section-title" }, h("h2", {}, "Прохождение")));

    actions.append(h("p", { class: "muted" },
      active
        ? `У вас есть незавершённая попытка. Ответы сохраняются автоматически.`
        : `Использовано попыток: ${completed} из ${attemptsLimit}.`));

    if (assignmentDeadline) {
      actions.append(h("p", { class: "muted" },
        `Срок сдачи: ${formatDateTime(assignmentDeadline)}${deadlinePassed ? " (истёк)" : ""}.`));
    }

    if (expiredError && active) {
      const retry = h("button", { type: "button", class: "btn primary" }, "Отправить сохранённые ответы");
      retry.addEventListener("click", async () => {
        retry.disabled = true;
        retry.textContent = "Отправляем…";
        try {
          const local = readLocal(active.id);
          const answers = { ...(active.answers || {}), ...(local?.answers || {}) };
          await submitAttemptById(active.id, answers);
          clearLocal(active.id);
          autoSubmitted = true;
          expiredError = null;
          attempts = attempts.map(item => item.id === active.id
            ? { ...item, status: "submitted", submittedAt: new Date(), finishedAt: new Date() }
            : item);
          try {
            attempts = await listMyAttemptsForTest(State.user.uid, test.id);
          } catch (_) {
            // Ответы отправлены; повторная отправка не нужна.
          }
          renderStudentIntro();
        } catch (err) {
          expiredError = err;
          renderStudentIntro();
        }
      });
      actions.append(
        h("div", { class: "notice" },
          h("strong", {}, "Попытка просрочена, но не отправлена. "),
          errorText(expiredError, "Повторите отправку.")),
        h("div", { class: "btn-row" }, retry)
      );
    } else if (active) {
      const resumeBtn = h("button", { type: "button", class: "btn primary" }, "Продолжить попытку");
      const expired = activeExpired;
      if (expired) {
        resumeBtn.disabled = true;
        resumeBtn.textContent = "Время истекло";
      } else {
        resumeBtn.addEventListener("click", () => openRunner(active));
      }
      actions.append(h("div", { class: "btn-row" }, resumeBtn));
      if (expired) {
        actions.append(h("p", { class: "muted" },
          "Обновите страницу: сохранённые ответы будут отправлены автоматически."));
      }
    } else {
      const startBtn = h("button", { type: "button", class: "btn primary" },
        completed ? "Начать новую попытку" : "Начать прохождение");
      const blocked = Boolean(
        attemptsError
        || fromDeadline()
        || limitReached
        || (assignmentId && assignmentError)
      );

      if (blocked) {
        startBtn.disabled = true;
        startBtn.textContent = limitReached ? "Попытки исчерпаны" : "Прохождение недоступно";
      } else {
        startBtn.addEventListener("click", handleStart);
      }

      actions.append(h("div", { class: "btn-row" }, startBtn));

      if (limitReached) {
        actions.append(h("p", { class: "muted" },
          "Лимит попыток исчерпан. Обратитесь к преподавателю, если нужна ещё одна."));
      }
    }

    content.append(actions);
  }

  function fromDeadline() {
    // Срок проверяем в момент нажатия: страница могла быть открыта заранее.
    return isDeadlinePassed(assignmentDeadline);
  }

  async function handleStart() {
    if (submitting) return;
    submitting = true;
    try {
      if (fromDeadline()) {
        toast("Срок выполнения истёк", "error");
        renderStudentIntro();
        return;
      }
      const latest = activeAttempt();
      if (latest) {
        openRunner(latest);
        return;
      }
      if (completedCount() >= attemptsLimit) {
        toast("Лимит попыток исчерпан", "error");
        renderStudentIntro();
        return;
      }

      const attemptNo = scopedAttempts().length + 1;
      const id = await startAttempt({
        test,
        user: State.user,
        profile,
        assignmentId: assignment?.id || "",
        attemptNo,
        deadlineAt: assignment?.deadline || null
      });

      const attempt = {
        id,
        userId: State.user.uid,
        userEmail: State.user.email || "",
        userName: String(profile.fullName || "").trim(),
        groupId: profile.groupId || "",
        orgId: profile.orgId,
        testId: test.id,
        testTitle: test.title || "",
        assignmentId: assignment?.id || "",
        answers: {},
        status: "in_progress",
        attemptNo,
        deadlineAt: assignment?.deadline || null,
        startedAt: new Date()
      };
      attempts = [attempt, ...attempts];
      openRunner(attempt);
    } catch (err) {
      console.error("Не удалось начать попытку:", err);
      toast(errorText(err, "Не удалось начать попытку."), "error");
    } finally {
      submitting = false;
    }
  }

  // ---------- Прохождение ----------

  function openRunner(attempt) {
    submitting = false;
    if (unloadHandler) {
      window.removeEventListener("beforeunload", unloadHandler);
      unloadHandler = null;
    }
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    const storedAnswers = attempt.answers && typeof attempt.answers === "object"
      ? attempt.answers
      : {};
    const local = readLocal(attempt.id);

    const current = {
      attempt,
      answers: { ...storedAnswers, ...(local?.answers || {}) },
      index: 0,
      startedAt: toDate(attempt.startedAt)?.getTime() || Date.now()
    };

    const limitMs = attemptDeadlineMs(attempt);
    current.deadlineMs = limitMs;

    if (!staff) writeLocal(attempt.id, current.answers);

    content.textContent = "";
    const saveState = h("div", { class: "form-hint", role: "status", "aria-live": "polite" }, "Ответы сохраняются автоматически");
    const errorBox = h("div", { class: "form-error", role: "alert" });
    const timerEl = h("span", { class: "badge badge-neutral" }, "—");
    const progressBar = h("div", { class: "progress-bar" });
    const counter = h("span", { class: "muted" });
    const palette = h("div", { class: "btn-row", style: "margin-top:0" });
    const questionBox = h("div");
    const confirmBar = h("div", { class: "notice" });
    confirmBar.hidden = true;
    const confirmText = h("p", { style: "margin:0 0 var(--space-3)" });
    const confirmYes = h("button", { type: "button", class: "btn primary" }, "Отправить ответы");
    const confirmNo = h("button", { type: "button", class: "btn secondary" }, "Вернуться к вопросам");
    confirmBar.append(confirmText, h("div", { class: "btn-row" }, confirmYes, confirmNo));

    const backBtn = h("button", { type: "button", class: "btn secondary" }, "Назад");
    const nextBtn = h("button", { type: "button", class: "btn secondary" }, "Далее");
    const finishBtn = h("button", { type: "button", class: "btn primary" }, "Проверить и отправить");

    const runner = h("section", { class: "panel" },
      h("div", { class: "panel-head" },
        h("div", {},
          h("div", { class: "eyebrow" }, "Прохождение"),
          h("div", { style: "display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap" },
            counter,
            timerEl
          )
        ),
        h("div", { class: "progress", style: "flex:1;min-width:120px;max-width:280px" }, progressBar)
      ),
      palette,
      questionBox,
      h("div", { class: "btn-row" }, backBtn, nextBtn, finishBtn),
      confirmBar,
      saveState,
      errorBox
    );

    content.append(runner);

    submitting = false;
    let autoSubmitTriggered = false;
    let savePromise = Promise.resolve();

    function setSaveState(text, isError) {
      saveState.textContent = text;
      saveState.className = isError ? "form-error" : "form-hint";
    }

    function setError(text) {
      errorBox.textContent = text || "";
    }

    function persistNow() {
      if (submitting) return savePromise;
      const snapshot = { ...current.answers };
      writeLocal(current.attempt.id, snapshot);
      setSaveState("Сохраняем…");
      savePromise = saveAttemptAnswers(current.attempt.id, snapshot)
        .then(() => {
          setSaveState("Ответы сохранены");
        })
        .catch(err => {
          console.error("Не удалось сохранить ответы:", err);
          setSaveState("Не удалось сохранить в облако. Ответы сохранены в этом браузере.", true);
        });
      return savePromise;
    }

    function queueSave() {
      // После начала отправки новые автосохранения не нужны: они могли бы
      // прийти уже после перехода в submitted и получить отказ правил.
      if (submitting) return;
      writeLocal(current.attempt.id, current.answers);
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        persistNow();
      }, 500);
    }

    flushSave = () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      writeLocal(current.attempt.id, current.answers);
      return persistNow();
    };

    unloadHandler = (event) => {
      if (submitting) return;
      event.preventDefault();
      event.returnValue = "";
      flushSave();
    };
    window.addEventListener("beforeunload", unloadHandler);

    function renderPalette() {
      palette.textContent = "";
      questions.forEach((_, index) => {
        const button = h("button", {
          type: "button",
          class: "btn " + (index === current.index ? "primary" : "secondary"),
          style: "min-width:38px;min-height:38px;padding:0 8px",
          "aria-label": `Вопрос ${index + 1}`,
          "aria-current": index === current.index ? "step" : "false"
        }, String(index + 1));
        if (isAnswered(current.answers[String(index)])) {
          button.style.borderColor = "var(--primary)";
        }
        button.addEventListener("click", () => {
          current.index = index;
          renderQuestion();
        });
        palette.appendChild(button);
      });
    }

    function renderQuestion() {
      const question = questions[current.index];
      const key = String(current.index);
      const answer = current.answers[key];
      const options = Array.isArray(question.options) ? question.options : [];

      questionBox.textContent = "";
      questionBox.append(
        h("div", { class: "eyebrow", style: "margin-top:var(--space-4)" },
          `Вопрос ${current.index + 1} · ${TYPE_LABEL[question.type] || "Вопрос"} · ${question.points || 1} б.`),
        h("h2", { style: "margin-top:var(--space-2)" }, question.text || "Вопрос без текста"),
        question.explanation && staff
          ? h("p", { class: "muted" }, question.explanation)
          : null
      );

      if (question.type === "short") {
        const input = h("textarea", {
          rows: "4",
          placeholder: "Введите ответ",
          maxlength: "4000"
        });
        input.value = typeof answer === "string" ? answer : "";
        input.addEventListener("input", () => {
          current.answers[key] = input.value;
          queueSave();
        });
        questionBox.append(h("div", { class: "field", style: "margin-top:var(--space-3)" },
          h("label", {}, "Ваш ответ"), input));
      } else {
        const multiple = question.type === "multiple";
        const rawSelected = multiple
          ? (Array.isArray(answer) ? answer : [])
          : (Array.isArray(answer) ? answer : (answer === undefined || answer === null ? [] : [answer]));
        const selected = new Set(rawSelected
          .map(value => typeof value === "string" ? Number(value) : value)
          .filter(value => Number.isInteger(value) && value >= 0));
        const optionsBox = h("div", { class: "options" });

        options.forEach((option, optionIndex) => {
          const input = h("input", {
            type: multiple ? "checkbox" : "radio",
            name: `question-${current.index}`,
            value: String(optionIndex),
            checked: selected.has(optionIndex)
          });
          const label = h("label", {
            class: "option" + (selected.has(optionIndex) ? " correct" : ""),
            style: "display:flex;gap:var(--space-2);align-items:center;cursor:pointer"
          }, input, h("span", {}, option.text || "—"));

          input.addEventListener("change", () => {
            if (multiple) {
              if (input.checked) selected.add(optionIndex);
              else selected.delete(optionIndex);
              const values = [...selected].sort((a, b) => a - b);
              if (values.length) current.answers[key] = values;
              else delete current.answers[key];
            } else {
              selected.clear();
              selected.add(optionIndex);
              current.answers[key] = optionIndex;
            }

            label.classList.toggle("correct", input.checked);
            if (!multiple) {
              optionsBox.querySelectorAll("input").forEach(other => {
                const otherLabel = other.closest("label");
                if (other !== input && otherLabel) otherLabel.classList.remove("correct");
              });
            }
            queueSave();
          });

          optionsBox.appendChild(label);
        });

        questionBox.append(optionsBox);
      }

      counter.textContent = `Вопрос ${current.index + 1} из ${questions.length}`;
      progressBar.style.width = `${((current.index + 1) / questions.length) * 100}%`;
      backBtn.disabled = current.index === 0;
      nextBtn.disabled = current.index >= questions.length - 1;
      renderPalette();
      setError("");
    }

    backBtn.addEventListener("click", () => {
      if (current.index > 0) {
        current.index -= 1;
        renderQuestion();
      }
    });

    nextBtn.addEventListener("click", () => {
      if (current.index < questions.length - 1) {
        current.index += 1;
        renderQuestion();
      }
    });

    finishBtn.addEventListener("click", () => {
      const answered = questions.reduce((count, _, index) => (
        count + (isAnswered(current.answers[String(index)]) ? 1 : 0)
      ), 0);
      confirmText.textContent = `Отправлено будет ${answered} из ${questions.length} ответов. После отправки изменить их нельзя.`;
      confirmBar.hidden = false;
      confirmBar.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    confirmNo.addEventListener("click", () => {
      confirmBar.hidden = true;
    });
    confirmYes.addEventListener("click", () => doSubmit({ auto: false }));

    function startTimer() {
      if (timerId) clearInterval(timerId);
      timerId = null;

      if (!current.deadlineMs) {
        timerEl.textContent = "Без ограничения";
        timerEl.className = "badge badge-neutral";
        return;
      }

      const tick = () => {
        const left = current.deadlineMs - Date.now();
        if (left <= 0) {
          timerEl.textContent = "00:00";
          timerEl.className = "badge badge-danger";
          if (timerId) clearInterval(timerId);
          timerId = null;
          if (!submitting && !autoSubmitTriggered) {
            autoSubmitTriggered = true;
            doSubmit({ auto: true });
          }
          return;
        }
        timerEl.textContent = formatDuration(left);
        timerEl.className = left < 60000 ? "badge badge-danger" : "badge badge-neutral";
      };

      tick();
      timerId = setInterval(tick, 1000);
    }

    async function doSubmit({ auto }) {
      if (submitting) return;
      submitting = true;
      setError("");
      if (timerId) clearInterval(timerId);
      timerId = null;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      finishBtn.disabled = true;
      backBtn.disabled = true;
      nextBtn.disabled = true;
      confirmYes.disabled = true;
      setSaveState(auto ? "Время истекло. Отправляем…" : "Отправляем…");

      try {
        // Ждём уже начатое сохранение ответов, чтобы оно не пришло после
        // отправки и не было отклонено правилами как изменение submitted.
        await savePromise.catch(() => {});
        await submitAttemptById(current.attempt.id, current.answers);
        clearLocal(current.attempt.id);
        if (unloadHandler) {
          window.removeEventListener("beforeunload", unloadHandler);
          unloadHandler = null;
        }
        flushSave = null;
        const updated = {
          ...current.attempt,
          answers: { ...current.answers },
          status: "submitted",
          submittedAt: new Date(),
          finishedAt: new Date()
        };
        attempts = attempts.map(item => item.id === updated.id ? updated : item)
          .sort((a, b) => attemptTime(b) - attemptTime(a));
        submitting = false;
        toast("Ответы отправлены", "success");
        renderStudentIntro();
      } catch (err) {
        console.error("Не удалось отправить попытку:", err);
        submitting = false;
        finishBtn.disabled = false;
        backBtn.disabled = current.index === 0;
        nextBtn.disabled = current.index >= questions.length - 1;
        confirmYes.disabled = false;
        setError(errorText(err, "Не удалось отправить ответы."));
        setSaveState("Ответы сохранены в этом браузере. Отправьте ещё раз.", true);
        if (!auto && current.deadlineMs && current.deadlineMs > Date.now()) startTimer();
      }
    }

    renderQuestion();
    startTimer();
  }
}
