import { h } from "../../shared/dom.js";
import { buildAttemptOrder } from "../../core/shuffle.js";
import { State, isStaff } from "../../core/auth.js";
import { loadTest } from "../../core/editor.js";
import {
  startAttempt,
  saveAttemptAnswers,
  submitAttemptById,
  listMyAttemptsForTest
} from "../../core/attempts.js";
import { getAssignment, getStudentAssignments } from "../../core/assign.js";
import { effectiveSettings } from "../../core/settings.js";
import { materialCompleted } from "../../core/materials.js";
import { isDeadlinePassed, attemptDeadlineMs as calcAttemptDeadlineMs } from "../../core/timing.js";
import { db, doc, getDoc } from "../../shared/firebase.js";
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
  graded: "Проверена",
  expired: "Просрочена"
};

const STATUS_BADGE = {
  in_progress: "badge-warning",
  submitted: "badge-info",
  graded: "badge-success",
  expired: "badge-danger"
};

// Таймеры и отложенное сохранение живут на уровне модуля: роутер вызывает
// cleanup() при уходе со страницы, даже если DOM уже заменён.
let timerId = null;
let saveTimer = null;
let questionTimerId = null; // таймер отдельного вопроса
let unloadHandler = null;
let flushSave = null;

export function cleanup() {
  try { flushSave?.(); } catch (_) {}
  if (timerId) clearInterval(timerId);
  if (saveTimer) clearTimeout(saveTimer);
  if (questionTimerId) clearInterval(questionTimerId);
  if (unloadHandler) window.removeEventListener("beforeunload", unloadHandler);
  timerId = null;
  saveTimer = null;
  questionTimerId = null;
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
  const settings = effectiveSettings(test);
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

  // Задание читаем по ссылке или ищем активное назначение группы из каталога.
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
  } else if (!staff && profile?.groupId && profile?.orgId) {
    try {
      const activeList = await getStudentAssignments(profile.groupId, profile.orgId);
      const matched = activeList.filter(item => item.testId === test.id);
      if (matched.length > 0) {
        // Выбираем назначение с наипозже дедлайном
        matched.sort((a, b) => {
          const aTime = toDate(a.deadline)?.getTime() || Infinity;
          const bTime = toDate(b.deadline)?.getTime() || Infinity;
          return bTime - aTime;
        });
        assignment = matched[0];
      }
    } catch (_) {
      // Автоподбор задания необязателен (например, если нет связи)
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

  // Обучающее задание (kind=training): тест открывается только после
  // прочтения материала-книги (materialProgress.completed == true).
  let needMaterialRead = false;
  if (!staff && assignment?.kind === "training") {
    try {
      needMaterialRead = !(await materialCompleted(State.user.uid, test.id));
    } catch (_) {
      needMaterialRead = true;
    }
  }

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

  // Если ученик закрыл вкладку, а время истекло — отправляем сохранённые
  // ответы. Это не оценка: проверку всё равно делает преподаватель.
  if (!staff) {
    const active = activeAttempt();
    if (active) {
      const deadlineMs = calcAttemptDeadlineMs({
        startedMs: toDate(active?.startedAt)?.getTime() || Date.now(),
        limitSeconds: totalSeconds(settings, questions.length),
        storedMs: toDate(active?.deadlineAt)?.getTime() || null,
        assignedMs: assignmentDeadline?.getTime() || null
      });
      if (deadlineMs && Date.now() >= deadlineMs) {
        try {
          const local = readLocal(active.id);
          const answers = { ...(active.answers || {}), ...(local?.answers || {}) };
          const expireMode = effectiveSettings(test).onTotalTimeout === "expire";
          await submitAttemptById(active.id, answers, { expire: expireMode });
          clearLocal(active.id);
          autoSubmitted = true;
          attempts = attempts.map(item => item.id === active.id
            ? {
              ...item,
              status: expireMode ? "expired" : "submitted",
              submittedAt: new Date(),
              finishedAt: new Date()
            }
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
      actions.append(
        h("div", { class: "section-title", style: "margin-top:var(--space-5)" },
          h("h2", {}, "Как провести")),
        h("p", { class: "muted" }, "Выберите режим: Live-комната, обучающее задание или проверка знаний."),
        h("div", { class: "btn-row" },
          h("a", { class: "btn primary", href: `#launch/${encodeURIComponent(test.id)}` }, "Запустить")
        )
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
      } else if (needMaterialRead) {
        // Обучающее задание: сначала дочитать материал-книгу.
        startBtn.disabled = true;
        startBtn.textContent = "Сначала материал";
        actions.append(h("div", { class: "btn-row" },
          h("a", { class: "btn primary", href: `#material/${encodeURIComponent(test.id)}` }, "Открыть материал")));
      } else {
        startBtn.addEventListener("click", handleStart);
      }

      actions.append(h("div", { class: "btn-row" }, startBtn));

      if (limitReached) {
        actions.append(h("p", { class: "muted" },
          "Лимит попыток исчерпан. Обратитесь к преподавателю, если нужна ещё одна."));
      } else if (needMaterialRead) {
        actions.append(h("p", { class: "muted" },
          "Для обучающего задания нужно дочитать материал до последней страницы."));
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
    if (needMaterialRead) {
      window.location.hash = `#material/${encodeURIComponent(test.id)}`;
      return;
    }
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
    if (questionTimerId) {
      clearInterval(questionTimerId);
      questionTimerId = null;
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

    // Перемешивание только для учеников; ответы хранятся по исходным индексам.
    const order = buildAttemptOrder(questions, settings, attempt.id, !staff);

    const limitMs = calcAttemptDeadlineMs({
      startedMs: toDate(attempt.startedAt)?.getTime() || Date.now(),
      limitSeconds: totalSeconds(settings, questions.length),
      storedMs: toDate(attempt.deadlineAt)?.getTime() || null,
      assignedMs: assignmentDeadline?.getTime() || null
    });
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

    // Политика ответов и таймеры (эффективные настройки уже нормализованы).
    const finalPolicy = settings.answerPolicy === "final";
    const questionTimeout = settings.onQuestionTimeout; // "next" | "lock"
    const onTotalTimeout = settings.onTotalTimeout;     // "submit" | "expire"
    const perQuestionSec = Number(settings.timePerQuestion) > 0
      ? Number(settings.timePerQuestion)
      : null;
    // Зафиксированные вопросы (answerPolicy=final): номер исходного вопроса.
    const locked = new Set();
    if (finalPolicy) {
      Object.keys(current.answers).forEach(key => {
        if (isAnswered(current.answers[key])) locked.add(key);
      });
    }
    let questionDeadline = null; // мс, привязано к моменту показа вопроса
    let questionTimerId = null;

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
        if (isAnswered(current.answers[String(order.questions[index])])) {
          button.style.borderColor = "var(--primary)";
        }
        button.addEventListener("click", () => {
          current.index = index;
          renderQuestion();
        });
        palette.appendChild(button);
      });
    }

    // Черновик ответов для политики final: до нажатия «Ответить» ответ
    // нигде не сохраняется.
    const draftAnswers = {};
    let correctKeysCache = null;
    const correctKeysPromise = () => getDoc(doc(db, "testKeys", test.id));

    function isLockedQuestion(key) {
      return locked.has(key);
    }

    // Полный ответ: бейдж-таймер текущего вопроса при включённом
    // timePerQuestion. По истечении срабатывает onQuestionTimeout.
    function questionClock(key) {
      if (questionTimerId) { clearInterval(questionTimerId); questionTimerId = null; }
      if (perQuestionSec == null || isLockedQuestion(key)) return null;
      questionDeadline = Date.now() + perQuestionSec * 1000;
      const el = h("span", { class: "badge badge-neutral", "aria-label": "Осталось времени на вопрос" });
      const update = () => {
        const left = questionDeadline - Date.now();
        if (left <= 0) {
          el.textContent = "00:00";
          el.className = "badge badge-danger";
          if (questionTimerId) { clearInterval(questionTimerId); questionTimerId = null; }
          handleQuestionTimeout(key);
          return;
        }
        el.textContent = formatDuration(left);
        el.className = left < 15000 ? "badge badge-danger" : "badge badge-neutral";
      };
      questionTimerId = setInterval(update, 1000);
      update();
      return el;
    }

    // «next»: автопереход, вопрос остаётся без ответа; «lock»: вопрос
    // блокируется, ученик идёт дальше сам.
    function handleQuestionTimeout(key) {
      if (submitting || isLockedQuestion(key)) return;
      if (questionTimeout === "next") {
        delete current.answers[key];
        delete draftAnswers[key];
        queueSave();
        if (current.index < questions.length - 1) {
          current.index += 1;
        }
        renderQuestion();
      } else {
        locked.add(String(order.questions[current.index]));
        renderQuestion();
      }
      if (questionTimeout === "next") {
        setSaveState("Время вопроса истекло: переход к следующему без ответа.");
      }
    }

    // Расшифровка правильного ответа для showCorrectAfterQuestion.
    // Правильные ответы читаются из закрытого testKeys: правила разрешают
    // чтение только пока идёт активная попытка, и только если настройка
    // включена (постановка Части 1).
    async function correctOutlook(key, question) {
      if (!settings.showCorrectAfterQuestion) return null;
      if (!correctKeysCache) {
        try {
          const snap = await correctKeysPromise();
          correctKeysCache = snap.exists() ? (snap.data().items || {}) : {};
        } catch (err) {
          console.error("Показ верного ответа:", err);
          return null;
        }
      }
      const item = correctKeysCache[key];
      if (!item) return null;
      const parts = [];
      if (Array.isArray(item.correct) && Array.isArray(question.options)) {
        parts.push("Верный: " + item.correct
          .map(i => question.options[i]?.text || "?")
          .join(", "));
      } else if (item.type === "short") {
        parts.push(`Верный ответ: ${item.answer ?? ""}`);
      }
      if (item.explanation) parts.push(item.explanation);
      return h("div", { class: "option correct", role: "status" }, parts.join(". "));
    }

    function renderQuestion() {
      const questionIndex = order.questions[current.index];
      const question = questions[questionIndex];
      const key = String(questionIndex);
      const isLocked = isLockedQuestion(key);
      const answer = current.answers[key];
      const draft = draftAnswers[key];
      const options = Array.isArray(question.options) ? question.options : [];

      questionBox.textContent = "";
      const headLine = h("div", { class: "eyebrow", style: "margin-top:var(--space-4)" },
        `Вопрос ${current.index + 1} · ${TYPE_LABEL[question.type] || "Вопрос"} · ${question.points || 1} б.`
      );
      const clockEl = questionClock(key);
      if (clockEl) {
        clockEl.style.marginLeft = "8px";
        headLine.append(clockEl);
      }
      questionBox.append(
        headLine,
        h("h2", { style: "margin-top:var(--space-2)" }, question.text || "Вопрос без текста"),
        question.explanation && staff
          ? h("p", { class: "muted" }, question.explanation)
          : null
      );

      const lockedView = (viewAnswer) => {
        // Read-only: политика final после фиксации или блокировки по
        // вопросному таймеру (policy lock). Ответ менять нельзя.
        const resolved = viewAnswer;
        if (question.type === "short") {
          questionBox.append(h("div", { class: "field", style: "margin-top:var(--space-3)" },
            h("label", {}, "Ваш ответ"),
            h("div", { class: "option", style: "padding:var(--space-2)" }, typeof resolved === "string" ? resolved : "—")));
        } else {
          const selected = new Set((Array.isArray(resolved) ? resolved
            : (resolved === undefined || resolved === null ? [] : [resolved]))
            .map(Number)
            .filter(Number.isInteger));
          const opts = h("div", { class: "options" });
          (order.options[questionIndex] || []).forEach(optionIndex => {
            const option = options[optionIndex];
            opts.appendChild(h("label", {
              class: "option" + (selected.has(optionIndex) ? " correct" : ""),
              style: "display:flex;gap:var(--space-2);align-items:center"
            }, option?.text || "—"));
          });
          questionBox.append(opts);
        }
      };

      if (isLocked) {
        lockedView(answer);
        correctOutlook(key, question).then(outlook => {
          if (outlook) questionBox.append(h("div", { style: "margin-top:var(--space-3)" }, outlook));
        });
      } else if (question.type === "short") {
        const source = finalPolicy ? draft : answer;
        const input = h("textarea", {
          rows: "4",
          placeholder: "Введите ответ",
          maxlength: "4000"
        });
        input.value = typeof source === "string" ? source : "";
        input.addEventListener("input", () => {
          if (finalPolicy) draftAnswers[key] = input.value;
          else { current.answers[key] = input.value; queueSave(); }
        });
        questionBox.append(h("div", { class: "field", style: "margin-top:var(--space-3)" },
          h("label", {}, "Ваш ответ"), input));
      } else {
        const multiple = question.type === "multiple";
        const source = finalPolicy ? draft : answer;
        const rawSelected = multiple
          ? (Array.isArray(source) ? source : [])
          : (Array.isArray(source) ? source : (source === undefined || source === null ? [] : [source]));
        const selected = new Set(rawSelected
          .map(value => typeof value === "string" ? Number(value) : value)
          .filter(value => Number.isInteger(value) && value >= 0));
        const optionsBox = h("div", { class: "options" });
        const confirmBtn = finalPolicy
          ? h("button", { type: "button", class: "btn primary", style: "margin-top:var(--space-3)" }, "Ответить")
          : null;

        order.options[questionIndex].forEach((optionIndex) => {
          const option = options[optionIndex];
          const input = h("input", {
            type: multiple ? "checkbox" : "radio",
            name: `question-${questionIndex}`,
            value: String(optionIndex),
            checked: selected.has(optionIndex)
          });
          const label = h("label", {
            class: "option" + (selected.has(optionIndex) ? " correct" : ""),
            style: "display:flex;gap:var(--space-2);align-items:center;cursor:pointer"
          }, input, h("span", {}, option.text || "—"));

          input.addEventListener("change", () => {
            if (!finalPolicy) {
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
            } else {
              if (multiple) {
                if (input.checked) selected.add(optionIndex);
                else selected.delete(optionIndex);
                draftAnswers[key] = [...selected].sort((a, b) => a - b);
              } else {
                selected.clear();
                selected.add(optionIndex);
                draftAnswers[key] = optionIndex;
              }
              label.classList.toggle("correct", input.checked);
              if (!multiple) {
                optionsBox.querySelectorAll("input").forEach(other => {
                  const otherLabel = other.closest("label");
                  if (other !== input && otherLabel) otherLabel.classList.remove("correct");
                });
              }
            }
          });

          optionsBox.appendChild(label);
        });

        questionBox.append(optionsBox);
        if (confirmBtn) {
          // Фиксация кнопкой: сохраняем на сервере и ставим замок.
          confirmBtn.addEventListener("click", () => {
            if (finalPolicy && draftAnswers[key] !== undefined && !isAnswered(current.answers[key])) {
              current.answers[key] = draftAnswers[key];
            }
            locked.add(key);
            if (finalPolicy) persistNow();
            renderQuestion();
          });
          questionBox.append(confirmBtn);
        }
      }

      counter.textContent = `Вопрос ${current.index + 1} из ${questions.length}`;
      progressBar.style.width = `${((current.index + 1) / questions.length) * 100}%`;
      // Навигация: в final политика назад к зафиксированному вопросу нельзя.
      const canGoBack = () => {
        if (current.index === 0) return false;
        const prevKey = String(order.questions[current.index - 1]);
        return !(finalPolicy && locked.has(prevKey));
      };
      backBtn.disabled = !canGoBack();
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

      const deadlineMs = current.deadlineMs;

      if (deadlineMs == null) {
        timerEl.textContent = "Без ограничения";
        timerEl.className = "badge badge-neutral";
        return;
      }

      const tick = () => {
        const left = deadlineMs - Date.now();
        if (left <= 0) {
          timerEl.textContent = "00:00";
          timerEl.className = "badge badge-danger";
          if (timerId) clearInterval(timerId);
          timerId = null;
          if (!submitting && !autoSubmitTriggered) {
            autoSubmitTriggered = true;
            doSubmit({ auto: true, expire: onTotalTimeout === "expire" });
          }
          return;
        }
        timerEl.textContent = formatDuration(left);
        timerEl.className = left < 60000 ? "badge badge-danger" : "badge badge-neutral";
      };

      tick();
      if (deadlineMs > Date.now()) {
        timerId = setInterval(tick, 1000);
      }
    }

    async function doSubmit({ auto = false, expire = false } = {}) {
      if (submitting) return;
      submitting = true;
      setError("");
      if (timerId) clearInterval(timerId);
      if (questionTimerId) clearInterval(questionTimerId);
      timerId = null;
      questionTimerId = null;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      finishBtn.disabled = true;
      backBtn.disabled = true;
      nextBtn.disabled = true;
      confirmYes.disabled = true;
      setSaveState(expire ? "Время истекло. Попытка будет помечена просроченной…"
        : auto ? "Время истекло. Отправляем…" : "Отправляем…");

      try {
        // Ждём уже начатое сохранение ответов, чтобы оно не пришло после
        // отправки и не было отклонено правилами как изменение submitted.
        await savePromise.catch(() => {});
        await submitAttemptById(current.attempt.id, current.answers, { expire });
        clearLocal(current.attempt.id);
        if (unloadHandler) {
          window.removeEventListener("beforeunload", unloadHandler);
          unloadHandler = null;
        }
        flushSave = null;
        const updated = {
          ...current.attempt,
          answers: { ...current.answers },
          status: expire ? "expired" : "submitted",
          submittedAt: new Date(),
          finishedAt: new Date()
        };
        attempts = attempts.map(item => item.id === updated.id ? updated : item)
          .sort((a, b) => attemptTime(b) - attemptTime(a));
        submitting = false;
        toast(expire ? "Время истекло, попытка просрочена" : "Ответы отправлены",
          expire ? "warning" : "success");
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
