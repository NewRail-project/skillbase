// Гостевой вход перед прохождением теста по прямой ссылке.
//
// Сценарий: преподаватель отправляет ссылку #quiz/<testId>; роутер кладёт
// неавторизованного пользователя на #login и сохраняет ссылку. Кнопка
// «Продолжить как гость» ведёт сюда; после ввода ФИО и нажатия «Начать тест»
// создаётся анонимная сессия и попытка, и гость попадает сразу в тест.
//
// #guest/<testId> допускает прямой заход: testId берётся из параметра,
// иначе — из сохранённого returnTo (#quiz/<testId>).
import { h } from "../../shared/dom.js";
import { State, signInGuestForTest, logout } from "../../core/auth.js";
import { getGuestName, validateGuestForm } from "../../core/guest.js";
import { loadTest } from "../../core/editor.js";
import { startAttempt, listMyAttemptsForTest } from "../../core/attempts.js";
import { effectiveSettings } from "../../core/settings.js";
import { peekReturnTo, clearReturnTo } from "../../shared/return-to.js";
import { authErrorMessage } from "../../shared/errors.js";
import { railScene, brandLockup } from "../../ui/components/brand.js";

// Флаг «в этой ссылке гость только что начал попытку»: quiz откроет
// её сразу, минуя интро-экран. Одна попытка — без дублей при обновлении.
const AUTO_RESUME_KEY = "sb:quizAutoResume";

function setAutoResume(attemptId) {
  try { sessionStorage.setItem(AUTO_RESUME_KEY, attemptId); } catch { /* нет storage */ }
}

// Первый и второй сегмент хеша без решётки: "#quiz/x/y" -> ["quiz","x"].
function hashSegments(hash) {
  const raw = String(hash || "").slice(1).replace(/^\//, "");
  return raw.split("/").filter(Boolean);
}

// Активный лимит попыток теста (тот же расчёт, что на странице прохождения).
function attemptsLimitOf(test) {
  const raw = Number(effectiveSettings(test).attemptsLimit);
  return Number.isFinite(raw) && raw >= 1 ? Math.min(100, Math.floor(raw)) : 1;
}

export default async function GuestStartPage() {
  const page = h("div", { class: "page auth-page" });
  const errorBox = h("div", { class: "form-error", role: "alert" });

  // Целевой тест: параметр маршрута #guest/<testId> или сохранённый
  // returnTo, на который роутер вернул бы после обычного входа. Задания
  // (#quiz/<testId>/<assignmentId>) гостям недоступны по правилам — берем
  // только id теста; гостевой проход всегда идёт по прямой ссылке.
  const segments = hashSegments(State.routeParam);
  let testId = decodeURIComponent(segments[0] || "");
  if (!testId) {
    const returnTo = peekReturnTo() || "";
    const returnSegments = hashSegments(returnTo);
    if (returnSegments[0] === "quiz" && returnSegments[1]) {
      testId = decodeURIComponent(returnSegments[1]);
    }
  }

  // Пользователь с полноценным аккаунтом проходит тесты через свой профиль
  // (задания, каталог). Гостевой вход к аккаунту не привязывается —
  // предлагаем выйти и пройти тест гостем без регистрации.
  if (State.user && State.user.isAnonymous !== true) {
    const out = h("button", { type: "button", class: "btn primary btn-block" }, "Выйти и пройти гостем");
    out.addEventListener("click", async () => {
      out.disabled = true;
      out.textContent = "Выходим…";
      try {
        await logout();
        window.location.hash = testId ? `#guest/${encodeURIComponent(testId)}` : "#guest";
      } catch (err) {
        errorBox.textContent = authErrorMessage(err);
        out.disabled = false;
        out.textContent = "Выйти и пройти гостем";
      }
    });
    const target = testId
      ? ` ${h("a", { href: `#quiz/${encodeURIComponent(testId)}` }, "Ссылка на тест, который вы открывали")}`
      : null;
    const alertPanel = h("section", { class: "panel auth-form" },
      brandLockup({ size: 32 }),
      h("div", { class: "eyebrow" }, "Гостевой вход"),
      h("h1", { style: "margin:4px 0 8px" }, "Вы уже вошли в аккаунт"),
      h("p", { class: "muted", style: "margin:0 0 16px" },
        "Под аккаунтом тесты проходят через каталог и задания: результаты сразу привязаны к вашему профилю. ",
        "Проход гостем доступен после выхода."),
      errorBox,
      out,
      target ? h("p", { class: "muted", style: "margin:16px 0 0" }, target) : null
    );
    page.append(h("div", { class: "auth-split" }, alertPanel, railAside()));
    return page;
  }

  // Анонимный гость уже есть: разрешаем читать published тест.
  // Проверяем доступность заранее, чтобы не уводить гостя в тупик
  // после отправки формы.
  let testTitle = "";
  if (State.user?.isAnonymous === true && testId) {
    try {
      const test = await loadTest(testId);
      testTitle = test?.title || "";
      if (test?.status !== "published") {
        errorBox.textContent = "Тест снят с публикации. Преподаватель может дать ссылку повторно.";
      }
    } catch (err) {
      errorBox.textContent = err?.code === "permission-denied"
        ? "Ссылка недоступна: тест не опубликован."
        : "Не удалось открыть тест по ссылке. Проверьте интернет и попробуйте снова.";
    }
  }

  const surname = h("input", { type: "text", id: "guest-surname", autocomplete: "family-name", placeholder: "Иванов" });
  const given = h("input", { type: "text", id: "guest-name", autocomplete: "given-name", placeholder: "Иван" });
  const patronymic = h("input", { type: "text", id: "guest-patronymic", autocomplete: "additional-name", placeholder: "Иванович" });
  const submit = h("button", { type: "submit", class: "btn primary btn-block" }, "Начать тест");

  // Уже знакомое ФИО не запрашиваем заново: поля заполняются им,
  // гость может сразу нажать «Начать тест».
  const knownName = State.user?.isAnonymous === true ? getGuestName() : "";
  if (knownName) {
    const [one, two, ...rest] = knownName.split(" ");
    surname.value = one || "";
    given.value = two || "";
    patronymic.value = rest.join(" ") || "";
  }

  const form = h("form", { class: "panel auth-form", novalidate: "novalidate" },
    brandLockup({ size: 32 }),
    h("div", { class: "eyebrow" }, "Гостевой вход"),
    h("h1", { style: "margin:4px 0 8px" }, "Перед началом теста"),
    h("p", { class: "muted", style: "margin:0" },
      "Вы проходите тест как гость. Регистрация не требуется. ",
      "Укажите ФИО, чтобы преподаватель мог идентифицировать ваш результат."),
    testTitle ? h("p", { class: "muted", style: "margin:8px 0 0;font-size:.875rem" },
      "Тест: ", h("strong", {}, testTitle)) : null,
    errorBox,
    h("div", { class: "field" },
      h("label", { for: "guest-surname" }, "Фамилия"),
      surname
    ),
    h("div", { class: "field" },
      h("label", { for: "guest-name" }, "Имя"),
      given
    ),
    h("div", { class: "field" },
      h("label", { for: "guest-patronymic" }, "Отчество (необязательно)"),
      patronymic
    ),
    submit,
    h("p", { class: "muted", style: "margin:0;font-size:.875rem" },
      "Есть аккаунт? ", h("a", { href: "#login" }, "Войти"))
  );

  const scene = railAside();
  page.append(h("div", { class: "auth-split" }, form, scene));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.textContent = "";

    const check = validateGuestForm({
      surname: surname.value,
      name: given.value,
      patronymic: patronymic.value
    });
    if (!check.ok) {
      surname.focus();
      errorBox.textContent = check.error;
      return;
    }

    submit.disabled = true;
    submit.textContent = "Готовим тест…";
    try {
      const user = await signInGuestForTest(check.value);
      // Ссылка отработана: обычный вход после гостя не должен вернуть
      // сюда повторно.
      clearReturnTo();

      if (!testId) {
        window.location.hash = "#/";
        return;
      }

      const test = await loadTest(testId);
      if (test?.status !== "published") {
        throw new Error("Тест снят с публикации. Преподаватель может дать ссылку повторно.");
      }

      const attempts = await listMyAttemptsForTest(user.uid, testId);
      const active = attempts.find(item => item.status === "in_progress") || null;

      // Уже идёт попытка — продолжаем её же (обновление страницы и
      // повторное открытие ссылки не создают дубль).
      if (active) {
        setAutoResume(active.id);
        window.location.hash = `#quiz/${encodeURIComponent(testId)}`;
        return;
      }

      const finished = attempts.filter(item => item.status !== "in_progress").length;

      // Лимит попыток исчерпан: попытку не начинаем. Страница теста
      // покажет статус и историю, без лишнего экрана.
      if (finished >= attemptsLimitOf(test)) {
        window.location.hash = `#quiz/${encodeURIComponent(testId)}`;
        return;
      }

      // Задание по ссылке гостю недоступно по правилам — прямая ссылка.
      const attemptId = await startAttempt({
        test,
        user,
        guest: { fullName: check.value }
      });
      setAutoResume(attemptId);
      window.location.hash = `#quiz/${encodeURIComponent(testId)}`;
    } catch (err) {
      console.error("Guest start error:", err);
      errorBox.textContent = err?.code === "permission-denied"
        ? "Ссылка недоступна: тест не опубликован."
        : err?.code
          ? authErrorMessage(err)
          : (err?.message || authErrorMessage(err));
      submit.disabled = false;
      submit.textContent = "Начать тест";
    }
  });

  surname.focus();
  return page;
}

function railAside() {
  const scene = h("div", { class: "auth-aside" });
  scene.innerHTML = railScene();
  scene.appendChild(h("div", { class: "auth-aside-text" },
    h("div", { class: "eyebrow" }, "Skillbase"),
    h("h2", {}, "Быстрый вход в тест"),
    h("p", {}, "Ссылка от преподавателя — и тест открыт: без учётной записи и пароля, результат уходит в общую таблицу.")
  ));
  return scene;
}
