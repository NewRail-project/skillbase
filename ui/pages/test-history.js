// ui/pages/test-history.js — «История и оценки» теста: #test-history/<testId>.
// Все, кто прошёл тест, статистика по вопросам и ученикам, оценки за занятие
// (та же честная формула, что и в Live), готовность по теме и вывод,
// нужно ли ещё одно занятие. Отчёт строится по реальным сохранённым ответам.
import { h } from "../../shared/dom.js";
import { State } from "../../core/auth.js";
import { getTestForReview } from "../../core/editor.js";
import { listOrgAttempts } from "../../core/attempts.js";
import { normalizeKeys } from "../../core/scoring.js";
import { buildLiveReport } from "../../core/live-report.js";
import { gradePlayer, journalRows } from "../../core/pair-grade.js";
import { pickAttemptPerStudent, attemptsToPlayers } from "../../core/test-history-logic.js";
import { journalPanel, reportPanel } from "../components/live-report.js";
import { loadCss } from "../../shared/load-css.js";

export default async function TestHistoryPage() {
  await loadCss("ui/css/live.css");
  const testId = decodeURIComponent((State.routeParam || "").split("/")[0] || "");
  const page = h("div", { class: "page" });
  const back = h("a", { class: "btn secondary", href: "#subjects" }, "К предметам");
  const body = h("div", {}, h("div", { class: "spinner" }));
  let mode = "last";

  page.append(h("div", { class: "page-head" },
    h("div", {}, h("div", { class: "eyebrow" }, "История теста"), h("h1", { id: "th-title" }, "Загрузка…")),
    h("div", { class: "page-head-actions" }, back)), body);

  let test; let attempts; let keysCache = new Map();
  try {
    const review = await getTestForReview(testId);
    test = review?.test || null;
    if (!test) throw new Error("Тест не найден.");
    keysCache.set(null, review.keys);
    attempts = (await listOrgAttempts(State.profile.orgId)).filter(a => a.testId === testId);
  } catch (err) {
    console.error("История теста:", err);
    body.replaceChildren(h("p", { class: "form-error" }, err?.message || "Не удалось загрузить историю теста."));
    return page;
  }
  page.querySelector("#th-title").textContent = test.title || "Тест";

  // Ключи берём той версии теста, по которой писалась попытка: так старые
  // попытки остаются корректными после правки теста.
  async function keysFor(version) {
    const key = version || null;
    if (keysCache.has(key)) return keysCache.get(key);
    let keys = null;
    try { keys = (await getTestForReview(testId, version))?.keys || null; } catch (_) { keys = null; }
    keysCache.set(key, keys || keysCache.get(null));
    return keysCache.get(key);
  }

  async function draw() {
    const picked = pickAttemptPerStudent(attempts, { testId, mode });
    const players = attemptsToPlayers(picked);
    const currentKeys = normalizeKeys(keysCache.get(null));
    const currentVersion = test.version || null;
    // Каждый ученик оценивается по ключам версии, по которой он писал тест.
    const grades = [];
    for (const p of players) {
      const keys = normalizeKeys(await keysFor(p.testVersion));
      grades.push(gradePlayer(p, keys));
    }
    // Подробный отчёт — по попыткам текущей версии: вопросы у версий разные.
    const sameVersion = players.filter(p => !p.testVersion || !currentVersion || p.testVersion === currentVersion);
    const older = players.length - sameVersion.length;
    const report = buildLiveReport({ players: sameVersion, keysByPos: currentKeys, questions: test.questions || [] });
    const toggle = h("div", { class: "btn-row" },
      ["last", "best"].map(m => h("button", {
        type: "button", class: `btn ${mode === m ? "primary" : "secondary"}`,
        onclick: () => { mode = m; draw(); }
      }, m === "last" ? "Последняя попытка" : "Лучшая попытка")));

    body.replaceChildren(
      h("p", { class: "muted" }, `Прошли тест: ${players.length}. Незавершённые и отменённые попытки не учитываются.`
        + (older ? ` Ещё ${older} писали прошлую версию теста: они есть в журнале оценок, но не в разборе вопросов.` : "")),
      toggle,
      reportPanel(report, { open: true }),
      journalPanel(journalRows(grades), { grades }));
  }
  await draw();
  return page;
}
