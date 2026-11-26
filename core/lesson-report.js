// core/lesson-report.js — итоговый отчёт занятия, рекомендуемая оценка и
// показатель готовности по теме. Чистый модуль без DOM и Firebase.
//
// Принципы (прозрачность для преподавателя):
//  · Оценка — РЕКОМЕНДАЦИЯ. Окончательное решение принимает преподаватель
//    (decisions[uid]); пока он не решил, итоговой оценки нет.
//  · Компоненты: входной тест, Battle (личная часть), практика (командная),
//    итоговый тест. Используются только имеющиеся данные: пропущенный,
//    отключённый или не проведённый этап НЕ становится нулём — он просто не
//    участвует, а доли весов пересчитываются между имеющимися компонентами.
//  · Командный результат (практика) не делает всех в команде «одинаково
//    оценёнными»: он лишь один из компонентов, а при отсутствии личных
//    результатов оценка не выставляется вовсе.
//  · Личный вклад в практику не измеряется (таблицу вводит капитан) — это
//    прямо сказано в отчёте.
//  · «Готовность по теме» — учебный показатель по результатам этого занятия,
//    а не уровень профессиональной компетентности.
import { completion, stageStatuses, DEFAULT_GRADING } from "./lesson-plan.js";
import { READY_GOOD, READY_WEAK } from "./live-report.js";

export const REPORT_VERSION = 1;
export const DYNAMICS_STEP = 10; // п.п., с которых изменение считается заметным
export const READINESS_NOTE = "Учебная оценка по результатам этого занятия, а не объективный уровень профессиональной компетентности.";
export const PRACTICAL_CONTRIBUTION_NOTE = "Личный вклад в практике не оценивается: таблицу вводит капитан, и по сохранённым данным вклад участников не разделить.";

const round1 = (v) => Math.round(v * 10) / 10;
const avg = (list) => (list.length ? round1(list.reduce((s, v) => s + v, 0) / list.length) : null);
const pct = (num, den) => (den > 0 ? round1((num / den) * 100) : null);

// ---------- Тест (входной / итоговый) ----------

// Личный результат теста по записи studentsDetail снимка roomHistory.
//   absent → данных нет (available: false), а не 0 %;
//   zero   → присутствовал, но не ответил: 0 % (available: true).
export function testResult(detail) {
  if (!detail || detail.status === "absent") return { available: false, status: detail ? "absent" : "none" };
  const total = Number(detail.total) || 0;
  const correct = Number(detail.correctCount) || 0;
  return {
    available: true,
    status: detail.status === "zero" ? "zero" : "graded",
    correct, total, answered: Number(detail.answered) || 0,
    percent: total > 0 ? pct(correct, total) : 0,
    grade100: Number.isFinite(Number(detail.grade)) ? Number(detail.grade) : null
  };
}

export function dynamicsOf(entry, final) {
  if (!entry?.available || !final?.available) {
    return { available: false, label: "Нет данных для сравнения", delta: null };
  }
  const delta = round1(final.percent - entry.percent);
  const label = delta >= DYNAMICS_STEP ? "Рост" : delta <= -DYNAMICS_STEP ? "Снижение" : "Без существенных изменений";
  return { available: true, delta, label };
}

// ---------- Рекомендуемая оценка ----------

export function gradeFromPercent(percent, thresholds = DEFAULT_GRADING.thresholds) {
  if (!Number.isFinite(percent)) return null;
  if (percent >= thresholds.five) return 5;
  if (percent >= thresholds.four) return 4;
  if (percent >= thresholds.three) return 3;
  return 2;
}

// components: { entry, battle, practical, final } — значение 0..100 или null.
// team: компоненты командного происхождения (не личные).
export function recommendGrade(components, grading = DEFAULT_GRADING) {
  const LABEL = { entry: "Входной тест", battle: "Battle (личная часть)", practical: "Практика (результат команды)", final: "Итоговый тест" };
  const TEAM = { practical: true };
  const rows = Object.keys(LABEL).map(key => ({
    key, label: LABEL[key], team: Boolean(TEAM[key]),
    percent: Number.isFinite(components?.[key]) ? round1(components[key]) : null,
    weight: Number(grading?.weights?.[key]) || 0
  }));
  const used = rows.filter(r => r.percent !== null && r.weight > 0);
  const totalWeight = used.reduce((s, r) => s + r.weight, 0);
  const detailed = rows.map(r => ({
    ...r,
    used: used.includes(r),
    share: used.includes(r) && totalWeight > 0 ? round1((r.weight / totalWeight) * 100) : 0
  }));
  const personal = used.filter(r => !r.team).length;
  if (!used.length || personal === 0) {
    return {
      grade: null, percent: null, components: detailed, confidence: "none",
      note: "Недостаточно личных результатов: оценку лучше выставить вручную."
    };
  }
  const percent = round1(used.reduce((s, r) => s + r.percent * (r.weight / totalWeight), 0));
  return {
    grade: gradeFromPercent(percent, grading?.thresholds), percent, components: detailed,
    confidence: personal === 1 ? "low" : "ok",
    note: personal === 1 ? "Оценка опирается на один личный результат — используйте осторожно." : ""
  };
}

// ---------- Готовность по теме ----------

export function readinessOf(entry, final) {
  const basis = final?.available ? "final" : entry?.available ? "entry" : null;
  if (!basis) return { available: false, label: "Нет данных", note: READINESS_NOTE };
  const percent = (basis === "final" ? final : entry).percent;
  const label = percent >= READY_GOOD ? "Тема усвоена" : percent >= READY_WEAK ? "Требует закрепления" : "Нужно повторение";
  return {
    available: true, percent, label,
    basis: basis === "final" ? "по итоговому тесту" : "только по входному тесту (итогового нет)",
    note: READINESS_NOTE
  };
}

// ---------- Практика ----------

function practicalSummary(practical) {
  if (!practical) return null;
  const teams = {};
  for (const id of ["a", "b"]) {
    const ev = practical.evaluations?.[id];
    if (!ev) continue;
    const pub = practical.tasks?.[id] || {};
    teams[id] = {
      title: pub.title || "", description: pub.description || "",
      columns: pub.columns || [], rows: pub.rows || [],
      cells: Object.fromEntries(Object.entries(ev.cells || {}).map(([cid, c]) => [cid, {
        answer: c.answer, ok: c.ok, source: c.source,
        ...(practical.expected?.[id]?.[cid] ? { expected: practical.expected[id][cid] } : {})
      }])),
      score: ev.score, max: ev.max, percent: ev.percent,
      filledBy: practical.submissions?.[id]?.by || null,
      submittedAt: practical.submissions?.[id]?.submittedAt ?? null
    };
  }
  const cmp = practical.comparison || null;
  return {
    teams,
    winner: cmp?.ready ? cmp.winner : null,
    tie: Boolean(cmp?.ready && cmp.tie),
    confirmedAt: practical.confirmedAt ?? null
  };
}

// ---------- Отчёт ----------

// Игроки Battle: { uid, name, teamId, isCaptain, isReserve, substituted, eliminated,
//   availableQuestions, participatedQuestions, accuracyPercent, participationPercent, battleGrade }.
export function buildLessonReport({
  plan, run, hostName = "", dateMs = null, entry = null, final = null,
  battle = null, practical = null, decisions = {}
} = {}) {
  const entryDetail = new Map((entry?.studentsDetail || []).map(d => [d.uid, d]));
  const finalDetail = new Map((final?.studentsDetail || []).map(d => [d.uid, d]));
  const battlePlayers = new Map((battle?.players || []).map(p => [p.uid, p]));
  const practicalInfo = practicalSummary(practical);

  const uids = new Set([...entryDetail.keys(), ...finalDetail.keys(), ...battlePlayers.keys()]);
  const stagePlanned = (s) => plan?.stages?.[s] === true;
  const stageDone = (s) => Boolean(run?.done?.[s]);

  const people = [...uids].map(uid => {
    const e = testResult(entryDetail.get(uid));
    const f = testResult(finalDetail.get(uid));
    const bp = battlePlayers.get(uid) || null;
    const name = entryDetail.get(uid)?.name || finalDetail.get(uid)?.name || bp?.name || "Участник";

    const battlePart = bp && bp.battleGrade !== null && bp.battleGrade !== undefined
      ? {
        available: true, teamId: bp.teamId, isCaptain: Boolean(bp.isCaptain), isReserve: Boolean(bp.isReserve),
        substituted: Boolean(bp.substituted), eliminated: Boolean(bp.eliminated),
        participated: bp.participatedQuestions ?? 0, availableQuestions: bp.availableQuestions ?? 0,
        accuracyPercent: bp.accuracyPercent ?? null, participationPercent: bp.participationPercent ?? null,
        grade: bp.battleGrade
      }
      : { available: false, teamId: bp?.teamId ?? null, isReserve: Boolean(bp?.isReserve), reason: bp ? "Не было доступных вопросов (резерв без замены)" : "Не участвовал" };

    // Командный результат практики относится только к тем, кто реально был в команде.
    const teamId = battlePart.available ? battlePart.teamId : null;
    const teamResult = practicalInfo && teamId ? practicalInfo.teams[teamId] : null;
    const practicalPart = teamResult
      ? {
        available: true, teamId, teamPercent: teamResult.percent,
        filledTable: practicalInfo.teams[teamId].filledBy === uid,
        contribution: null, contributionNote: PRACTICAL_CONTRIBUTION_NOTE
      }
      : { available: false, teamId: teamId || null, contribution: null, contributionNote: PRACTICAL_CONTRIBUTION_NOTE };

    const rec = recommendGrade({
      entry: e.available ? e.percent : null,
      battle: battlePart.available ? battlePart.grade : null,
      practical: practicalPart.available ? practicalPart.teamPercent : null,
      final: f.available ? f.percent : null
    }, plan?.grading);

    // Три показателя для таблицы отчёта. Нет данных — null («—»), не ноль.
    //   участие  — доля вопросов Battle, в голосовании по которым игрок участвовал;
    //   вклад    — личная точность его ответов в голосованиях Battle;
    //   командная работа — средний результат его команды в Battle (очки к лучшей
    //   команде) и в практике (процент); учитываются только имеющиеся части.
    const mineBattle = Number(battle?.scores?.[teamId]);
    const bestBattle = Math.max(Number(battle?.scores?.a) || 0, Number(battle?.scores?.b) || 0);
    const teamBattlePercent = battlePart.available && Number.isFinite(mineBattle) && bestBattle > 0
      ? Math.round((mineBattle / bestBattle) * 1000) / 10 : null;
    const teamParts = [teamBattlePercent, practicalPart.available ? practicalPart.teamPercent : null]
      .filter(v => Number.isFinite(v));
    const metrics = {
      participation: battlePart.available ? (battlePart.participationPercent ?? null) : null,
      contribution: battlePart.available ? (battlePart.accuracyPercent ?? null) : null,
      teamwork: teamParts.length ? Math.round((teamParts.reduce((s, v) => s + v, 0) / teamParts.length) * 10) / 10 : null,
      teamworkParts: { battle: teamBattlePercent, practical: practicalPart.available ? practicalPart.teamPercent : null }
    };

    const status = (planned, done, has) => !planned ? "off" : !done ? "not_held" : has ? "done" : "missed";
    const decision = decisions?.[uid];
    const decided = decision && Number.isInteger(decision.grade) && decision.grade >= 2 && decision.grade <= 5
      ? { grade: decision.grade, reason: String(decision.reason || "").slice(0, 300) } : null;

    return {
      uid, name,
      entry: e, final: f,
      dynamics: dynamicsOf(e, f),
      battle: battlePart, practical: practicalPart,
      metrics,
      stages: {
        entry_test: status(stagePlanned("entry_test"), stageDone("entry_test"), e.available),
        battle: status(stagePlanned("battle"), stageDone("battle"), battlePart.available),
        practical: status(stagePlanned("practical"), stageDone("practical"), practicalPart.available),
        final_test: status(stagePlanned("final_test"), stageDone("final_test"), f.available)
      },
      recommended: rec,
      readiness: readinessOf(e, f),
      decision: decided
    };
  }).sort((x, y) => String(x.name).localeCompare(String(y.name), "ru"));

  const entryPercents = people.filter(p => p.entry.available).map(p => p.entry.percent);
  const finalPercents = people.filter(p => p.final.available).map(p => p.final.percent);
  const deltas = people.filter(p => p.dynamics.available).map(p => p.dynamics.delta);

  const notes = [];
  if (!battle) notes.push("Battle не проводилась или её итоги не сохранены: этот компонент не учитывается.");
  if (!practicalInfo) notes.push("Практика не проводилась или результат не подтверждён: этот компонент не учитывается.");
  if (stagePlanned("final_test") && !final) notes.push("Итоговый тест не проведён или его история не сохранена: динамика недоступна.");
  notes.push("Время прохождения тестов в снимке Live не сохраняется, поэтому в отчёте его нет.");
  notes.push(PRACTICAL_CONTRIBUTION_NOTE);
  notes.push("Участие, вклад и командная работа считаются по Battle и практике: участие — доля вопросов Battle с голосом игрока; вклад — точность его голосов; командная работа — среднее из результата команды в Battle (очки к лучшей команде) и в практике. Нет данных — «—».");

  return {
    version: REPORT_VERSION,
    lesson: {
      id: run?.id || "", topic: plan?.topic || "", subjectName: plan?.subjectName || "",
      dateMs, hostName,
      materialTitle: plan?.materialTitle || "", entryTestTitle: plan?.entryTestTitle || "", finalTestTitle: plan?.finalTestTitle || ""
    },
    completion: completion(run, plan),
    stages: stageStatuses(run, plan),
    participants: people.length,
    summary: {
      entry: { available: entryPercents.length > 0, participants: entryPercents.length, averagePercent: avg(entryPercents) },
      final: { available: finalPercents.length > 0, participants: finalPercents.length, averagePercent: avg(finalPercents) },
      dynamics: {
        available: deltas.length > 0, averageDelta: avg(deltas),
        improved: deltas.filter(d => d >= DYNAMICS_STEP).length,
        declined: deltas.filter(d => d <= -DYNAMICS_STEP).length
      },
      battle: battle ? {
        available: true, winner: battle.winner ?? null, tie: Boolean(battle.tie),
        scores: battle.scores || {}, finishedEarly: Boolean(battle.finishedEarly)
      } : { available: false },
      practical: practicalInfo
        ? { available: true, winner: practicalInfo.winner, tie: practicalInfo.tie, a: practicalInfo.teams.a ? { percent: practicalInfo.teams.a.percent, score: practicalInfo.teams.a.score, max: practicalInfo.teams.a.max } : null, b: practicalInfo.teams.b ? { percent: practicalInfo.teams.b.percent, score: practicalInfo.teams.b.score, max: practicalInfo.teams.b.max } : null }
        : { available: false }
    },
    practical: practicalInfo,
    people,
    notes
  };
}

// ---------- Сборка данных практики для отчёта ----------

const toMs = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : null);

// snapshot: { tasks, submissions, keys } (practical-store.loadPracticalSnapshot),
// confirmed: документ подтверждённого результата (battleRounds/practical_result).
// Берётся ЗАФИКСИРОВАННЫЙ при подтверждении расчёт, а не пересчёт: правка
// плана или ключей позже не меняет итог. Без подтверждения практики в отчёте нет.
export function practicalForReport({ snapshot, confirmed } = {}) {
  if (!confirmed?.evaluations || !confirmed?.comparison?.ready) return null;
  const expected = {};
  for (const team of ["a", "b"]) {
    expected[team] = {};
    for (const [id, key] of Object.entries(snapshot?.keys?.[team] || {})) {
      expected[team][id] = key.mode === "manual" ? "проверяет преподаватель" : (key.accept || []).join(" / ");
    }
  }
  const submissions = {};
  for (const team of ["a", "b"]) {
    const s = snapshot?.submissions?.[team];
    if (s) submissions[team] = { by: s.by || null, submittedAt: toMs(s.submittedAt) };
  }
  return {
    tasks: { a: snapshot?.tasks?.a, b: snapshot?.tasks?.b },
    evaluations: confirmed.evaluations,
    comparison: confirmed.comparison,
    submissions, expected,
    confirmedAt: toMs(confirmed.confirmedAt)
  };
}

// Решения преподавателя из интерфейса → только допустимые (оценка 2–5).
export function cleanDecisions(decisions) {
  const out = {};
  for (const [uid, d] of Object.entries(decisions || {})) {
    if (d && Number.isInteger(d.grade) && d.grade >= 2 && d.grade <= 5) out[uid] = { grade: d.grade, reason: String(d.reason || "").slice(0, 300) };
  }
  return out;
}
