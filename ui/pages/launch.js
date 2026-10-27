// ui/pages/launch.js — экран «Как провести тест»: #launch/<testId>, staff.
// Три режима: Live-комната, Обучающее задание, Проверка знаний.
// Заменяет прежнюю форму «Назначить группе» на странице теста.
import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { loadTest } from "../../core/editor.js";
import { assignTest } from "../../core/assign.js";
import { createRoom } from "../../core/rooms.js";
import { KIND_TRAINING, validateAssignmentDraft } from "../../core/assignment-logic.js";
import { icons } from "../../shared/icons.js";
import { toast } from "../components/toast.js";

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
          h("h2", {}, "Тест недоступен"),
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
          h("h2", {}, "Тест ещё не опубликован"),
          h("p", { class: "muted" }, "Запустить можно только опубликованный тест."),
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
  const roomMessage = h("div", { class: "form-hint", role: "status" });
  const roomBtn = h("button", { type: "button", class: "btn primary btn-block" }, "Открыть Live-комнату");
  grid.appendChild(modeCard({
    title: "Live-комната",
    lead: "Вы задаёте вопросы в прямом эфире, участники отвечают со своих телефонов, наблюдатель видит ход и результаты.",
    bullets: [
      "Код комнаты вместо ссылки — 6 символов",
      "Очки считаются при закрытии вопроса",
      "Правильные ответы раскрываются после закрытия"
    ],
    button: roomBtn,
    extra: roomMessage,
    onclick: async () => {
      roomMessage.textContent = "";
      roomMessage.className = "form-hint";
      roomBtn.disabled = true;
      roomBtn.textContent = "Создаём…";
      try {
        const code = await createRoom({ test, profile: State.profile });
        toast(`Комната открыта. Код: ${code}`, "success");
        window.location.hash = `#room/${code}`;
      } catch (err) {
        console.error("Live-комната:", err);
        roomMessage.textContent = errorBody(err, "Не удалось создать комнату.");
        roomMessage.className = "form-error";
      } finally {
        roomBtn.disabled = false;
        roomBtn.textContent = "Открыть Live-комнату";
      }
    }
  }));

  // Режим 2 и 3 — форма задания (kind training/exam).
  function assignmentForm(kind) {
    const groupInput = h("input", { type: "text", placeholder: "Например, ИТ-01", maxlength: "100" });
    const startAtInput = h("input", { type: "datetime-local" });
    const deadlineInput = h("input", { type: "datetime-local" });
    const limitInput = h("input", { type: "number", min: "1", max: "50", value: "1" });
    const noteInput = h("input", { type: "text", maxlength: "200", placeholder: "Короткая заметка (необязательно)" });
    const materialTextInput = h("textarea", { rows: "3", maxlength: "6000", placeholder: "Материал задания (необязательно)" });
    const materialUrlInput = h("input", { type: "url", placeholder: "https://…", maxlength: "500" });

    const fields = h("div", { class: "field-grid" },
      h("div", { class: "field" }, h("label", {}, "Группа"), groupInput),
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
    const submit = h("button", { type: "button", class: "btn primary" }, "Назначить группе");

    submit.addEventListener("click", async () => {
      message.textContent = "";
      message.className = "form-hint";

      const groupId = groupInput.value.trim();
      if (!groupId) {
        message.textContent = "Укажите группу.";
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
        message.textContent = `Задание создано для группы «${groupId}».`;
        toast("Задание создано", "success");
      } catch (err) {
        console.error("Назначение теста:", err);
        message.textContent = errorBody(err, "Не удалось создать задание.");
        message.className = "form-error";
      } finally {
        submit.disabled = false;
        submit.textContent = "Назначить группе";
      }
    });

    return h("div", {}, fields, h("div", { class: "btn-row" }, submit), message);
  }

  grid.appendChild(modeCard({
    title: "Обучающее задание",
    lead: "Тест с материалом и пояснениями: участники могут учиться по нему, срок обязателен.",
    bullets: ["Заметка и материал до 6000 символов", "Ссылка на материал только по https", "Можно отложить открытие"],
    form: assignmentForm(KIND_TRAINING)
  }));

  grid.appendChild(modeCard({
    title: "Проверка знаний",
    lead: "Контрольный тест: материал скрыт, попытки ограничены, результаты идут на проверку как обычно.",
    form: assignmentForm("exam")
  }));

  return page;
}

function hero(test, questions) {
  return h("div", { class: "page-head" },
    h("div", {},
      h("div", { class: "eyebrow" }, "Запуск теста"),
      h("h1", {}, "Как провести тест"),
      h("p", { class: "page-sub" }, `«${test.title || "Без названия"}» · ${questions} ${questions === 1 ? "вопрос" : "вопросов"}.`),
      h("p", { class: "page-sub" }, test.description || "")
    ),
    h("div", { class: "page-head-actions" },
      h("a", { class: "btn secondary", href: "#tests" }, "Мои тесты")
    )
  );
}
