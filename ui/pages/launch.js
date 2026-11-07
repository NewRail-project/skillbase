// ui/pages/launch.js — экран «Как провести тест»: #launch/<testId>, staff.
// Три режима: Live-комната, Обучающее задание, Проверка знаний.
// Заменяет прежнюю форму «Назначить группе» на странице теста.
import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { loadCss } from "../../shared/load-css.js";
import { loadTest } from "../../core/editor.js";
import { assignTest } from "../../core/assign.js";
import { createRoom } from "../../core/rooms.js";
import {
  LIVE_MODE_AUTO, LIVE_MODE_MANUAL, questionSecFor,
  QUESTION_SEC_MIN, QUESTION_SEC_MAX
} from "../../core/live-auto.js";
import { KIND_TRAINING, validateAssignmentDraft } from "../../core/assignment-logic.js";
import { icons } from "../../shared/icons.js";
import { toast } from "../components/toast.js";
import { t as tr, lt } from "../../core/i18n.js";

function errorBody(err, fallback) {
  if (err?.code === "permission-denied") {
    return "Правила Firestore не разрешают это действие.";
  }
  if (err?.code === "unavailable") {
    return "Нет связи с Firestore. Проверьте подключение к сети.";
  }
  return err?.message || fallback;
}

function modeCard({ title, lead, bullets, form, button, onclick, extra }) {
  const card = h("section", { class: "panel launch-mode" });
  card.appendChild(h("div", { class: "panel-head" }, h("h2", {}, title)));
  const body = h("div", { class: "panel-body" });
  body.appendChild(h("p", { class: "muted" }, lead));
  if (bullets?.length) {
    body.appendChild(h("ul", { class: "launch-mode-list" },
      bullets.map(item => h("li", {}, item))));
  }
  if (form) body.appendChild(form);
  if (button) {
    body.appendChild(h("div", { class: "btn-row" }, button));
    if (onclick) button.addEventListener("click", onclick);
  }
  if (extra) body.appendChild(extra);
  card.appendChild(body);
  return card;
}

export default async function LaunchPage() {
  // Стили Live-комнаты нужны экрану запуска (превью комнаты).
  await loadCss("ui/css/live.css");
  const testId = decodeURIComponent((State.routeParam || "").split("/")[0] || "");
  const page = h("div", { class: "page" });

  let test = null;
  try {
    test = await loadTest(testId);
  } catch (err) {
    console.error("Загрузка теста:", err);
    return h("div", { class: "page" },
      h("div", { class: "panel" },
        h("div", { class: "empty-state" },
          h("div", { class: "empty-state-icon", innerHTML: icons.book }),
          h("h2", {}, lt("launch.notFound")),
          h("p", { class: "muted" }, errorBody(err, "Не удалось загрузить тест.")),
          h("a", { class: "btn secondary", href: "#tests" }, "В каталог")
        )
      )
    );
  }

  if (test.status !== "published") {
    return h("div", { class: "page" },
      h("div", { class: "panel" },
        h("div", { class: "empty-state" },
          h("div", { class: "empty-state-icon", innerHTML: icons.book }),
          h("h2", {}, lt("launch.notPublished")),
          h("p", { class: "muted" }, lt("launch.notPublishedHint")),
          h("a", { class: "btn primary", href: `#create-test/${encodeURIComponent(testId)}` }, "Открыть редактор")
        )
      )
    );
  }

  const questions = (test.questions || []).length;

  page.appendChild(hero(test, questions));

  const grid = h("section", { class: "launch-grid" });
  page.appendChild(grid);

  // ---------- Режим 1: Live-комната ----------
  // По умолчанию — автономный тест: ведущий запускает его один раз, вопросы
  // выдаются автоматически. Ручной режим (ведущий открывает каждый вопрос)
  // сохранён как отдельный вариант.
  const roomMessage = h("div", { class: "form-hint", role: "status" });
  const roomBtn = h("button", { type: "button", class: "btn primary btn-block" }, "Открыть Live-комнату");

  const modeAuto = h("input", { type: "radio", name: "live-mode", id: "live-mode-auto", value: LIVE_MODE_AUTO });
  const modeManual = h("input", { type: "radio", name: "live-mode", id: "live-mode-manual", value: LIVE_MODE_MANUAL });
  modeAuto.checked = true;
  const secInput = h("input", {
    type: "number", id: "live-q-sec", inputmode: "numeric",
    min: String(QUESTION_SEC_MIN), max: String(QUESTION_SEC_MAX),
    value: String(questionSecFor(test))
  });
  const shuffleInput = h("input", { type: "checkbox", id: "live-shuffle" });
  const speedInput = h("input", { type: "checkbox", id: "live-speed" });
  speedInput.checked = true;
  const boardInput = h("input", { type: "checkbox", id: "live-board" });
  boardInput.checked = test?.settings?.showLeaderboard === true;
  const autoFields = h("div", { class: "live-auto-fields" },
    h("div", { class: "field" },
      h("label", { for: "live-q-sec" }, "Время на вопрос, сек"),
      secInput),
    h("label", { class: "option", for: "live-shuffle" }, shuffleInput, "Случайный порядок вопросов"),
    h("label", { class: "option", for: "live-speed" }, speedInput, "Дополнительные баллы за скорость"),
    h("label", { class: "option", for: "live-board" }, boardInput, lt("launch.showBoard"))
  );
  const modeForm = h("fieldset", { class: "role-picker" },
    h("legend", { class: "muted" }, "Режим"),
    h("label", { class: "role-option", for: "live-mode-auto" }, modeAuto,
      h("span", { class: "role-option-body" },
        h("b", {}, lt("launch.autoTest")),
        h("span", { class: "muted" }, "Запускаете один раз — вопросы идут сами"))),
    h("label", { class: "role-option", for: "live-mode-manual" }, modeManual,
      h("span", { class: "role-option-body" },
        h("b", {}, "Ручной режим"),
        h("span", { class: "muted" }, "Вы открываете и закрываете каждый вопрос"))),
    autoFields
  );
  const syncMode = () => { autoFields.hidden = !modeAuto.checked; };
  modeAuto.addEventListener("change", syncMode);
  modeManual.addEventListener("change", syncMode);
  syncMode();

  let creatingRoom = false;

  grid.appendChild(modeCard({
    title: "Live-комната",
    lead: lt("launch.liveHint"),
    bullets: [
      "Код комнаты вместо ссылки — 6 символов",
      lt("launch.autoBullet"),
      "Общий рейтинг обновляется в реальном времени"
    ],
    form: modeForm,
    button: roomBtn,
    extra: roomMessage,
    onclick: async () => {
      if (creatingRoom) return;
      creatingRoom = true;
      roomMessage.textContent = "";
      roomMessage.className = "form-hint";
      roomBtn.disabled = true;
      roomBtn.textContent = "Создаём комнату…";

      try {
        const auto = modeAuto.checked;
        const roomData = {
          test,
          profile: State.profile,
          mode: auto ? LIVE_MODE_AUTO : LIVE_MODE_MANUAL,
          options: auto ? {
            questionSec: secInput.value,
            shuffleQuestions: shuffleInput.checked,
            speedBonus: speedInput.checked,
            showLeaderboard: boardInput.checked
          } : {}
        };

        const code = await createRoom(roomData);
        toast(`Комната открыта. Код: ${code}`, "success");
        window.location.hash = `#room/${code}`;
      } catch (err) {
        console.error("Live-комната:", err);
        roomMessage.textContent = errorBody(err, "Не удалось создать комнату.");
        roomMessage.className = "form-error";
        creatingRoom = false;
        roomBtn.disabled = false;
        roomBtn.textContent = "Открыть Live-комнату";
      }
    }
  }));

  // Режим 2 и 3 — форма задания (kind training/exam).
  function assignmentForm(kind) {
    const groupInput = h("input", { type: "text", placeholder: lt("launch.groupPlaceholder"), maxlength: "100" });
    const startAtInput = h("input", { type: "datetime-local" });
    const deadlineInput = h("input", { type: "datetime-local" });
    const limitInput = h("input", { type: "number", min: "1", max: "50", value: "1" });
    const noteInput = h("input", { type: "text", maxlength: "200", placeholder: "Короткая заметка (необязательно)" });
    const materialTextInput = h("textarea", { rows: "3", maxlength: "6000", placeholder: "Материал задания (необязательно)" });
    const materialUrlInput = h("input", { type: "url", placeholder: "https://…", maxlength: "500" });

    const fields = h("div", { class: "field-grid" },
      h("div", { class: "field" }, h("label", {}, lt("launch.groupLabel")), groupInput),
      h("div", { class: "field" }, h("label", {}, "Открыть с (необязательно)"), startAtInput),
      h("div", { class: "field" }, h("label", {}, "Срок сдачи"), deadlineInput)
    );
    if (kind === KIND_TRAINING) {
      fields.append(
        h("div", { class: "field" }, h("label", {}, "Заметка"), noteInput),
        h("div", { class: "field field-wide" }, h("label", {}, "Материал (текст)"), materialTextInput),
        h("div", { class: "field" }, h("label", {}, "Ссылка на материал"), materialUrlInput)
      );
    }
    fields.appendChild(h("div", { class: "field" }, h("label", {}, "Попыток"), limitInput));

    const message = h("div", { class: "form-hint", role: "status" });
    const submit = h("button", { type: "button", class: "btn primary" }, lt("launch.assignBtn"));

    submit.addEventListener("click", async () => {
      message.textContent = "";
      message.className = "form-hint";

      const groupId = groupInput.value.trim();
      if (!groupId) {
        message.textContent = tr("launch.groupMissing");
        message.className = "form-error";
        return;
      }

      // Чистая валидация: kind, материалы, срок training.
      const check = validateAssignmentDraft({
        kind,
        deadline: deadlineInput.value || null,
        note: noteInput.value,
        materialText: materialTextInput.value,
        materialUrl: materialUrlInput.value
      });
      if (!check.ok) {
        message.textContent = Object.values(check.errors)[0];
        message.className = "form-error";
        return;
      }
      if (deadlineInput.value && new Date(deadlineInput.value).getTime() <= Date.now()) {
        message.textContent = "Срок выполнения должен быть в будущем.";
        message.className = "form-error";
        return;
      }
      if (startAtInput.value && deadlineInput.value
        && new Date(startAtInput.value) >= new Date(deadlineInput.value)) {
        message.textContent = "Открытие должно быть раньше срока сдачи.";
        message.className = "form-error";
        return;
      }

      submit.disabled = true;
      submit.textContent = "Назначаем…";
      try {
        await assignTest({
          test,
          teacherId: State.user.uid,
          groupId,
          deadline: deadlineInput.value || null,
          attemptsLimit: limitInput.value || null,
          kind,
          note: noteInput.value,
          materialText: kind === KIND_TRAINING ? materialTextInput.value : "",
          materialUrl: kind === KIND_TRAINING ? materialUrlInput.value : "",
          startAt: startAtInput.value || null
        });
        message.textContent = tr("launch.assigned", { group: groupId });
        toast("Задание создано", "success");
      } catch (err) {
        console.error("Назначение теста:", err);
        message.textContent = errorBody(err, "Не удалось создать задание.");
        message.className = "form-error";
      } finally {
        submit.disabled = false;
        submit.textContent = tr("launch.assignBtn");
      }
    });

    return h("div", {}, fields, h("div", { class: "btn-row" }, submit), message);
  }

  grid.appendChild(modeCard({
    title: lt("launch.modeLearn"),
    lead: lt("launch.modeLearnHint"),
    bullets: ["Заметка и материал до 6000 символов", "Ссылка на материал только по https", "Можно отложить открытие"],
    form: assignmentForm(KIND_TRAINING)
  }));

  grid.appendChild(modeCard({
    title: lt("launch.modeCheck"),
    lead: lt("launch.modeCheckHint"),
    form: assignmentForm("exam")
  }));

  return page;
}

function hero(test, questions) {
  return h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, lt("launch.eyebrow")),
      h("h1", {}, lt("launch.title")),
      h("p", { class: "page-sub" }, `«${test.title || "Без названия"}» · ${questions} ${questions === 1 ? "вопрос" : "вопросов"}.`),
      h("p", { class: "page-sub" }, test.description || "")
    ),
    h("div", { class: "page-head-actions" },
      h("a", { class: "btn secondary", href: "#tests" }, lt("launch.backToList"))
    )
  );
}
