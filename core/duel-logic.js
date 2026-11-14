// core/duel-logic.js — разрешение ничьих итогового рейтинга Live-комнаты
// дуэлями. Чистая логика: без DOM и Firebase, проверяется в Node
// (tests/duel-logic.test.js).
//
// Модель. Итоговый рейтинг строится по ratingRows (score, correctCount);
// равные (score, correctCount) образуют группу ничьей — победителя в ней
// ratingRows не назначает (места 1, 1, 3). Каждую группу разрешает
// дуэльная серия: раунд = один вопрос из банка вопросов теста, участники
// отвечают заново; раунд приносит очко только тому, кто ответил верно,
// когда остальные участники группы — нет (несколько верных одновременно —
// ничья раунда). Вопросы дуэли не повторяются. Серия завершена, когда
// порядок группы определяется безусловно: отрыв на каждой границе таблицы
// больше оставшихся раундов (догнать невозможно) или банк исчерпан и
// очки серий различаются. Если банк исчерпан или ведущий остановил серию
// (участник не может продолжить), а порядок ещё не определён — группа
// переходит в состояние «pending»: победителя не назначают автоматически
// (ни по скорости, ни случайно, ни скрытым бонусом), порядок принимает
// преподаватель явно — с причиной и автором; запись сохраняется в
// документе дуэлей. Баллы основного теста и учебные оценки дуэли не
// меняют: ответы раундов хранятся отдельно от players/answers.
//
// Данные: rooms/{code}/duels/final — один документ
// { key: "final", status, groups: [...], order: [uid...], computedBy,
//   computedAt, version }. Ответы раундов — подколлекция answers:
// {groupId}__{номер раунда}__{uid} → { answer, at }, пишет только сам
// участник и только один раз (правила Firestore).

// ---------- Раунды по уже данным ответам (сравнение вердиктов) ----------

// Чистая логика: сравнение двух рядов вердиктов по общим вопросам.
// verdict: true / false / null (пропуск). Возвращает раунды и счёт.
// Перенесено из ui/components/duel.js — единый источник для анимации
// «Дуэль» и тестов.
export function duelRounds(a, b) {
  const qids = [];
  const seen = new Set();
  for (const item of [...(a?.verdicts || []), ...(b?.verdicts || [])]) {
    if (!seen.has(item.qid)) { seen.add(item.qid); qids.push(item.qid); }
  }
  qids.sort((x, y) => Number(x) - Number(y));
  const pick = (row, qid) => (row?.verdicts || []).find(v => v.qid === qid)?.verdict ?? null;
  let winsA = 0;
  let winsB = 0;
  const rounds = qids.map(qid => {
    const va = pick(a, qid);
    const vb = pick(b, qid);
    let winner = "draw";
    if (va === true && vb !== true) { winner = "a"; winsA += 1; }
    else if (vb === true && va !== true) { winner = "b"; winsB += 1; }
    return { qid, a: va, b: vb, winner };
  });
  return { rounds, winsA, winsB };
}

// Победитель раунда дуэли по вердиктам участников группы
// ({ uid: true|false|null }): единственный верный — победитель; два и
// больше верных (или ни одного) — ничья раунда, очко никому.
export function roundWinner(verdicts) {
  const winners = Object.entries(verdicts || {})
    .filter(([, v]) => v === true)
    .map(([uid]) => uid);
  return winners.length === 1 ? winners[0] : null;
}

// ---------- Группы ничьей ----------

// Подряд идущие строки итогового рейтинга с равными (score, correctCount):
// именно их ratingRows отметил одним местом. Возвращает [{ key, members }].
export function tieGroups(rows) {
  const out = [];
  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    while (j < rows.length
      && rows[j].score === rows[i].score
      && (rows[j].correctCount ?? 0) === (rows[i].correctCount ?? 0)) j++;
    if (j - i >= 2) {
      out.push({
        key: `${rows[i].score}:${rows[i].correctCount ?? 0}`,
        members: rows.slice(i, j)
      });
    }
    i = j;
  }
  return out;
}

// ---------- Банк вопросов дуэли ----------

// Банк: индексы вопросов теста ("0".."N-1") в фиксированном порядке —
// без случайности. Каждый вопрос используется максимум один раз за дуэль.
export function duelBank(questionCount) {
  const n = Math.max(0, Math.trunc(Number(questionCount) || 0));
  return Array.from({ length: n }, (_, i) => String(i));
}

// Следующий неиспользованный вопрос банка (null — банк исчерпан).
export function nextDuelQid(bank, usedQids) {
  const used = new Set(usedQids || []);
  return (bank || []).find(qid => !used.has(qid)) ?? null;
}

// ---------- Состояние группы дуэли ----------

// Новая группа: все начинают с нуля очков, раундов нет.
export function createDuelGroup(members, index) {
  const uids = members.map(m => m.uid);
  const tally = {};
  uids.forEach(uid => { tally[uid] = 0; });
  return {
    id: `g${index}`,
    uids,
    names: Object.fromEntries(members.map(m => [m.uid, m.name || "Участник"])),
    status: "running",
    tally,
    usedQids: [],
    rounds: [],
    currentRound: null,
    currentQid: null,
    stopped: false,
    stoppedReason: null,
    decision: null,
    order: null
  };
}

// Ведущий открывает следующий раунд: вопрос берётся из банка, номер
// раунда — по количеству сыгранных. Банк исчерпан → null (раунд открыть
// нельзя — дальше только решение преподавателя).
export function openDuelRound(group, bankSize) {
  const qid = nextDuelQid(duelBank(bankSize), group?.usedQids);
  if (qid == null) return null;
  return {
    ...group,
    currentRound: ((group?.rounds?.length || 0) + 1),
    currentQid: qid,
    stopped: false,
    stoppedReason: null
  };
}

// Закрытый раунд: вердикты участников пересчитывает ведущий по ключам
// теста и сохраняет в состоянии группы. Чистая функция — новое состояние.
export function applyRound(group, qid, verdicts) {
  const winner = roundWinner(verdicts);
  const round = {
    n: ((group?.rounds?.length || 0) + 1),
    qid: String(qid),
    verdicts: { ...(verdicts || {}) },
    winner: winner || null
  };
  const tally = { ...(group?.tally || {}) };
  for (const uid of group?.uids || []) if (tally[uid] == null) tally[uid] = 0;
  if (winner && winner in tally) tally[winner] += 1;
  return {
    ...group,
    tally,
    usedQids: [...(group?.usedQids || []), String(qid)],
    rounds: [...(group?.rounds || []), round],
    currentRound: null,
    currentQid: null
  };
}

// Ведущий останавливает серию: участник не может продолжить (отключился,
// вышел из комнаты). Причину фиксируем — победителя не назначаем.
export function stopGroup(group, reason) {
  return {
    ...group,
    stopped: true,
    stoppedReason: String(reason || "Дуэль остановлена ведущим").slice(0, 200)
  };
}

function sortedEntries(group) {
  const index = new Map((group?.uids || []).map((uid, i) => [uid, i]));
  return Object.entries(group?.tally || {})
    .filter(([uid]) => index.has(uid))
    .map(([uid, t]) => ({ uid, tally: Number(t) || 0, at: index.get(uid) }))
    .sort((a, b) => b.tally - a.tally || a.at - b.at);
}

// Очки серий, разбитые на уровни: [[равные по очкам]...] по убыванию.
function tallyLevels(group) {
  const levels = [];
  for (const e of sortedEntries(group)) {
    const last = levels[levels.length - 1];
    if (last && last[0].tally === e.tally) last.push(e);
    else levels.push([e]);
  }
  return levels;
}

// Прогресс группы: определён ли порядок участников после раунда.
// Серия закончена, когда (а) каждый уровень — один участник и каждый
// уровень отделён от следующего отрывом, большим оставшихся раундов —
// догнать невозможно, или (б) банк исчерпан (или ведущий остановил
// серию) и все уровни по одному участнику. Участники с равными очками
// серий — «pending»: их порядок автоматически не назначается (ни по
// индексу, ни по имени), его принимает преподаватель явно.
export function groupProgress(group, bankSize, { stopped = false } = {}) {
  const remaining = stopped || group?.stopped === true
    ? 0
    : Math.max(0, Math.trunc(Number(bankSize) || 0) - (group?.usedQids?.length || 0));
  const levels = tallyLevels(group);
  const separated = levels.every((level, i) =>
    level.length === 1
    && (i === levels.length - 1 || level[0].tally > levels[i + 1][0].tally + remaining));
  if (separated) {
    return {
      status: "resolved",
      order: levels.flatMap(level => level.map(e => e.uid)),
      pendingUids: []
    };
  }
  if (remaining <= 0) {
    const pendingUids = levels.filter(level => level.length > 1)
      .flatMap(level => level.map(e => e.uid));
    if (!pendingUids.length) {
      return {
        status: "resolved",
        order: levels.flatMap(level => level.map(e => e.uid)),
        pendingUids: []
      };
    }
    return { status: "pending", order: null, pendingUids };
  }
  return { status: "running", order: null, pendingUids: [] };
}

// Итог группы после закрытия раунда / остановки: running, resolved или
// pending (порядок ждёт решения преподавателя).
export function settleGroup(group, bankSize) {
  const prog = groupProgress(group, bankSize);
  if (prog.status === "resolved") {
    return {
      ...group,
      status: "resolved",
      order: prog.order,
      currentRound: null,
      currentQid: null
    };
  }
  return {
    ...group,
    status: prog.status,
    order: null,
    currentRound: null,
    currentQid: null
  };
}

// ---------- Решение преподавателя (запасной сценарий) ----------

// Кто ждёт явного решения: при исчерпанном банке (или остановленной
// серии) — все уровни с равными очками серий; в играющей серии
// преподаватель может определить порядок раньше — неразрешёнными
// считаются те же уровни с равными очками.
export function pendingUidsFor(group, bankSize) {
  const prog = groupProgress(group, bankSize);
  if (prog.pendingUids.length) return prog.pendingUids;
  return tallyLevels(group)
    .filter(level => level.length > 1)
    .flatMap(level => level.map(e => e.uid));
}

// Валидация: решение должно расставить ВСЕХ неразрешённых участников
// группы без повторов, с непустой причиной и известным автором.
export function validateDecision({ pendingUids, order, reason, authorUid } = {}) {
  if (!Array.isArray(order) || !order.length) {
    return { error: "Укажите порядок участников." };
  }
  const want = [...(pendingUids || [])].sort().join("\n");
  const got = [...order].sort().join("\n");
  if (want !== got || new Set(order).size !== order.length) {
    return { error: "Решение должно расставить всех неразрешённых участников, без повторов." };
  }
  if (!String(reason || "").trim()) {
    return { error: "Укажите причину решения." };
  }
  if (!authorUid) {
    return { error: "Не указан автор решения." };
  }
  return { ok: true };
}

// Применение решения: фиксированные по очкам серий участники сохраняют
// порядок, каждый уровень с равными очками выстраивается по решению
// (решение может быть принято и до исчерпания банка); группа становится
// resolved. Причина и автор сохраняются — история решения остаётся в
// документе дуэлей.
export function applyDecision(group, decision, bankSize) {
  const pendingSet = new Set(pendingUidsFor(group, bankSize));
  const pos = new Map((decision?.order || []).map((uid, i) => [uid, i]));
  const order = [];
  for (const level of tallyLevels(group)) {
    const fixed = level.map(e => e.uid).filter(uid => !pendingSet.has(uid));
    const pending = level.map(e => e.uid).filter(uid => pendingSet.has(uid));
    pending.sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0));
    order.push(...fixed, ...pending);
  }
  return {
    ...group,
    status: "resolved",
    order,
    currentRound: null,
    currentQid: null,
    decision: {
      order: [...(decision?.order || [])],
      reason: String(decision?.reason || "").trim().slice(0, 300),
      authorUid: decision?.authorUid || "",
      authorName: decision?.authorName || "",
      at: decision?.at || null
    }
  };
}

// ---------- Документ дуэлей целиком ----------

function sameUidSet(a, b) {
  return [...(a || [])].sort().join("\n") === [...(b || [])].sort().join("\n");
}

// Копия группы с защитой изменяемых коллекций (мутировать нельзя).
function cloneGroup(group) {
  return {
    ...group,
    uids: [...(group?.uids || [])],
    names: { ...(group?.names || {}) },
    tally: { ...(group?.tally || {}) },
    usedQids: [...(group?.usedQids || [])],
    rounds: [...(group?.rounds || [])]
  };
}

// Статус документа по статусам групп: есть running → running; иначе есть
// pending → pending; иначе всё разрешено.
export function duelDocStatus(groups) {
  const list = groups || [];
  if (list.some(g => g?.status === "running")) return "running";
  if (list.some(g => g?.status === "pending")) return "pending";
  return "resolved";
}

function finishDoc({ groups, rows }) {
  const applied = applyDuelPlaces(rows, { groups });
  return {
    key: "final",
    status: duelDocStatus(groups),
    groups,
    order: applied.map(r => r.uid),
    version: 1
  };
}

// Документ дуэлей по текущим строкам рейтинга. existing (если есть) —
// прежний документ: группы совпадающего состава сохраняют раунды, очки
// серий и решения; недостающие группы добавляются, исчезнувшие уходят.
export function buildDuelsDoc({ rows, existing = null, questionCount = 0 } = {}) {
  const groups = tieGroups(rows).map((g, index) => {
    const uids = g.members.map(r => r.uid);
    const prev = (existing?.groups || [])
      .find(e => sameUidSet(e?.uids, uids));
    return prev ? cloneGroup(prev) : createDuelGroup(
      g.members.map(r => ({ uid: r.uid, name: r.name })), index
    );
  });
  return finishDoc({ groups, rows });
}

// Сверка состава групп документа с текущими группами ничьей (пересчёт
// очков после завершения теста мог сдвинуть состав).
export function duelGroupsChanged(doc, groups) {
  const have = new Set((doc?.groups || [])
    .map(g => [...(g?.uids || [])].sort().join("\n")));
  const want = groups.map(g => g.members.map(r => r.uid).sort().join("\n"));
  return have.size !== want.length || want.some(key => !have.has(key));
}

// Замена одной группы в документе с пересчётом статуса и порядка.
// rows — текущие строки рейтинга (без мест дуэлей).
export function withGroup(doc, groupId, nextGroup, rows) {
  const groups = (doc?.groups || []).map(g => (g?.id === groupId ? nextGroup : g));
  return finishDoc({ groups, rows });
}

// ---------- Применение дуэлей к строкам рейтинга ----------

// Итоговые места. Пока есть неразрешённая группа — строки возвращаются
// с общими местами ratingRows (места ещё делятся) и пометкой duelPending.
// Когда все группы resolved: члены групп переставляются по порядку дуэлей,
// места перенумеровываются подряд без повторов; участники дуэлей получают
// пометку duelResolved (значок «решено дуэлью» в интерфейсе).
export function applyDuelPlaces(rows, duelsDoc) {
  const safe = rows.map(row => ({ ...row }));
  const groups = duelsDoc?.groups;
  if (!Array.isArray(groups) || !groups.length) return safe;
  const unresolved = groups.filter(g => g && g.status !== "resolved");
  if (unresolved.length) {
    const pending = new Set(unresolved.flatMap(g => g.uids || []));
    for (const row of safe) {
      if (pending.has(row.uid)) row.duelPending = true;
    }
    return safe;
  }
  for (const g of groups) {
    const pos = new Map((g.order || []).map((uid, i) => [uid, i]));
    // Позиции членов группы в массиве (по возрастанию) и сами строки в
    // порядке дуэли: k-я по порядку дуэли строка встаёт на k-ю позицию.
    const positions = [];
    safe.forEach((row, i) => { if (pos.has(row.uid)) positions.push(i); });
    if (positions.length < 2) continue;
    const ordered = positions
      .map(i => safe[i])
      .sort((a, b) => pos.get(a.uid) - pos.get(b.uid));
    positions.forEach((p, k) => { safe[p] = { ...ordered[k], duelResolved: true }; });
  }
  safe.forEach((row, i) => { row.place = i + 1; });
  return safe;
}

// Контроль уникальности мест (используется в тестах; на завершённой
// комнате с решёнными группами повторов быть не должно).
export function placesAreUnique(rows) {
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.place)) return false;
    seen.add(row.place);
  }
  return true;
}
