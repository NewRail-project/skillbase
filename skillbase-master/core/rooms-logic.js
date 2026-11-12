// core/rooms-logic.js — чистая логика Live-комнат.
// Без DOM и Firebase, чтобы проверяться юнит-тестами в Node.

import { isCorrect, normalizeKeys } from "./scoring.js";

// Алфавит без похожих символов: нет 0, O, 1, I.
export const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

// Хранилище кода, чтобы generateRoomCode() не работал в Edge-случаях без
// Math.random? Оставляем Math.random: для комнаты collided кода почти нет.
export function generateRoomCode(random = Math.random) {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length)];
  }
  return code;
}

// Нормализация ввода кода: обрезаем пробелы, поднимаем регистр,
// заменяем похожие символы (кириллицу О/1/I на латиницу).
export function normalizeRoomCode(value) {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/О/g, "O")
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/І/g, "I");
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(raw)) return null;
  return raw;
}

export function isValidRoomCode(value) {
  return /^[A-HJ-NP-Z2-9]{6}$/.test(String(value || ""));
}

// Время вопроса: сервер даёт qStartedAt (мс). Серверная метка — опора.
// Смещение устройства в будущее (вопрос «ещё не начался») маскируем
// моментом получения; уход в прошлое НЕ маскируем: после перезагрузки
// ведущий и таймер должны видеть, что время вопроса уже вышло, чтобы
// восстановление комнты честно закрывало вопрос один раз.
export function questionTimeMs(qStartedMs, receivedMs = Date.now()) {
  const SKEW_MS = 120_000;
  if (typeof qStartedMs !== "number" || !Number.isFinite(qStartedMs)) {
    return receivedMs;
  }
  if (qStartedMs > receivedMs + SKEW_MS) return receivedMs;
  return qStartedMs;
}

// Сигнатура состояния для отложенной перерисовки: если string не изменилась,
// DOM не трогаем — поле ввода участника не теряет фокус на каждом снапшоте.
export function roomSignature({ room, players, myAnswer }) {
  const playerBits = (players || [])
    .map(p => `${p.uid}:${(p.name || "").slice(0, 24)}:${p.observer ? 1 : 0}`)
    .sort()
    .join(",");
  const answerBits = (players || [])
    .filter(p => !p.observer)
    .map(p => `${p.uid}:${p.answers?.[room?.currentQuestionId] != null ? 1 : 0}`)
    .sort()
    .join(",");
  return [
    room?.status ?? "",
    String(room?.currentQuestionId ?? ""),
    room?.phase ?? "",
    String(room?.qStartedMs ?? ""),
    String(room?.questionCount ?? 0),
    `players=${playerBits}`,
    `ans=${answerBits}`,
    `me=${myAnswer != null ? 1 : 0}`
  ].join("|");
}

// Сколько участников (не наблюдателей) уже ответили на текущий вопрос.
export function answeredCount(players, questionId, { includeObservers = false } = {}) {
  return (players || []).filter(p => (includeObservers || !p.observer)
    && p.answers?.[questionId] != null).length;
}

// ---------- Очки: база, серия, бонус за скорость ----------
// Очки пересчитываются с нуля по answers/times при каждом закрытии
// вопроса; функция чистая, потому остаётся идемпотентной.

// Серия: +10% за каждый верный ответ подряд, максимум +50%.
export const STREAK_STEP = 0.10;
export const STREAK_MAX = 0.50;

export function streakRatio(streak) {
  const n = Number.isFinite(streak) && streak > 0 ? streak : 0;
  return Math.min(STREAK_MAX, n * STREAK_STEP);
}

// Бонус за скорость: до +50% от базовых очков, линейно по оставшемуся
// времени. Действует только если у комнаты задан qDurationSec > 0.
// Время ответа — серверное: times.<q> (мс) минус qStartedAt (мс).
export const SPEED_MAX = 0.50;

export function speedRatio(qDurationSec, answeredMs) {
  const duration = Number(qDurationSec);
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (typeof answeredMs !== "number" || !Number.isFinite(answeredMs) || answeredMs < 0) return 0;
  const left = 1 - answeredMs / (duration * 1000);
  // Ответ позже длительности даёт 0: вопрос уже не открыт.
  if (left <= 0) return 0;
  return Math.min(1, left) * SPEED_MAX;
}

// ЕДИНАЯ ФОРМУЛА ОЧКОВ (решение: оставляем оба механизма — они награждают
// разное: серия — стабильность, скорость — уверенность). Всё считается
// только здесь, экран итогов берёт разбивку из scoreBreakdown().
//   итого = round(база × (1 + серия + скорость))
//   серия    = min(0.5, 0.1 × верных подряд)   → «Серия ×1.2»
//   скорость = до 0.5 по оставшемуся времени   → «Скорость +4»
// Пропуск и неверный ответ дают 0 очков и обнуляют серию.
export function scoreBreakdown(basePoints, { streak = 0, speed = 0 } = {}) {
  const base = basePoints || 1;
  const streakRate = streakRatio(streak);
  const speedRate = Math.min(SPEED_MAX, Math.max(0, Number(speed) || 0));
  const total = Math.round(base * (1 + streakRate + speedRate));
  const streakBonus = Math.round(base * streakRate);
  // Скорость = остаток, чтобы base + серия + скорость всегда равнялись total.
  const speedBonus = total - base - streakBonus;
  return {
    base,
    streakMult: Math.round((1 + streakRate) * 100) / 100,
    streakBonus,
    speedBonus,
    total
  };
}

// Итог очков одного ответа: базовые очки, домноженные на бонусы.
export function answerPoints(basePoints, opts = {}) {
  return scoreBreakdown(basePoints, opts).total;
}

// Строка для экрана итогов: «Верно: 10 · Серия ×1.2 · Скорость +4 = 16 б.».
// Нулевые бонусы не показываем; ответ без очков — «Неверно»/«Пропуск».
export function formatBreakdown(result) {
  if (!result) return "";
  if (!result.answered) return "Пропуск · 0 б.";
  if (!result.correct) return "Неверно · 0 б.";
  const b = result.breakdown;
  const parts = [`Верно: ${b.base}`];
  if (b.streakMult > 1) parts.push(`Серия ×${b.streakMult.toFixed(1)}`);
  if (b.speedBonus > 0) parts.push(`Скорость +${b.speedBonus}`);
  return `${parts.join(" · ")} = ${b.total} б.`;
}

// Уровень значка серии: огонь с 3 верных подряд, молния с 5.
export const STREAK_FIRE_AT = 3;
export const STREAK_BOLT_AT = 5;
export function streakTier(streak) {
  const n = Number.isFinite(streak) ? streak : 0;
  if (n >= STREAK_BOLT_AT) return "bolt";
  if (n >= STREAK_FIRE_AT) return "fire";
  return "none";
}

// Событие серии между двумя кадрами — для анимации значка:
//   "hit"   — серия выросла (вспышка и увеличение),
//   "tier"  — выросла и сменился уровень (огонь → молния),
//   "break" — серия была от 3 и оборвалась (значок гаснет),
//   "lost"  — малая серия (1–2) обнулилась, значок просто исчезает,
//   "same"  — без изменений.
export function streakEvent(prevStreak, nextStreak) {
  const a = Number.isFinite(prevStreak) ? prevStreak : 0;
  const b = Number.isFinite(nextStreak) ? nextStreak : 0;
  if (b > a) return streakTier(b) !== streakTier(a) && streakTier(b) !== "none" ? "tier" : "hit";
  if (b < a) return streakTier(a) !== "none" ? "break" : "lost";
  return "same";
}

// Места с учётом ничьей: равные очки и верные — одно место (1, 1, 3).
// Мутирует и возвращает те же объекты с полем place.
export function assignPlaces(rows) {
  let place = 0;
  (rows || []).forEach((row, index) => {
    const prev = rows[index - 1];
    if (!prev || prev.score !== row.score || (prev.correctCount ?? 0) !== (row.correctCount ?? 0)) {
      place = index + 1;
    }
    row.place = place;
  });
  return rows;
}

// «Дорожка» ответов — компактная строка в документе scores/{uid}: по символу
// на вопрос (позиция = номер вопроса): "1" верно, "0" неверно, "-" пропуск.
// Её пишет ведущий вместе с очками: так серию, дуэль и экспресс могут
// показать ВСЕ участники, хотя чужие ответы им недоступны.
export function trailFromResults(results) {
  const byQid = new Map((results || []).map(r => [Number(r.qid), r]));
  const last = Math.max(-1, ...byQid.keys());
  let out = "";
  for (let i = 0; i <= last; i++) {
    const r = byQid.get(i);
    out += !r ? "-" : !r.answered ? "-" : r.correct ? "1" : "0";
  }
  return out;
}

// Вердикты по дорожке: [{ qid: "0", verdict: true|false|null }, …].
export function verdictsFromTrail(trail) {
  return String(trail || "").split("").map((ch, i) => ({
    qid: String(i), verdict: ch === "1" ? true : ch === "0" ? false : null
  }));
}

// Текущая и лучшая серия по дорожке.
export function streakFromTrail(trail) {
  let streak = 0;
  let best = 0;
  for (const ch of String(trail || "")) {
    if (ch === "1") { streak += 1; best = Math.max(best, streak); } else streak = 0;
  }
  return { streak, bestStreak: best };
}

// Серия игрока на клиенте: по раскрытым вопросам (reveals) и ответам из
// документа игрока. Ничего не пишет в Firestore — правила не меняются.
// qids — порядок закрытых вопросов; возвращает { streak, bestStreak, verdicts }.
export function streakFromReveals(player, reveals, qids) {
  let streak = 0;
  let best = 0;
  const verdicts = [];
  for (const qid of qids || []) {
    const reveal = reveals?.[qid];
    if (!reveal) continue;
    const answer = player?.answers?.[qid];
    const verdict = answer == null ? null : myAnswerVerdict(reveal, answer);
    verdicts.push({ qid, verdict });
    if (verdict === true) { streak += 1; best = Math.max(best, streak); } else streak = 0;
  }
  return { streak, bestStreak: best, verdicts };
}

// Игрок из снапшота дальше идёт в чистые функции: times приведены к мс.
export function normalizePlayerTimes(player) {
  if (!player) return player;
  const times = player.times || {};
  const fixed = {};
  for (const qid of Object.keys(times)) fixed[qid] = toNumberMs(times[qid]);
  return { ...player, times: fixed };
}

function toNumberMs(value) {
  if (typeof value === "number") return value;
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value && typeof value.seconds === "number") return value.seconds * 1000;
  if (value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.getTime();
  }
  return null;
}

// Множитель зоны расчёта скорости: qStarts — карта qid → мс начала
// вопроса (серверные метки, пишет ведущий при openQuestion).
function speedRatioFor(player, qid, speedOpts) {
  const startedMs = speedOpts?.qStarts?.[qid];
  const answeredMs = player?.times?.[qid];
  if (!startedMs || typeof answeredMs !== "number") return 0;
  return speedRatio(speedOpts?.qDurationSec, answeredMs - startedMs);
}

// Вердикт по моему ответу после закрытия вопроса: true/false/null (reveal нет).
export function myAnswerVerdict(reveal, myAnswer) {
  if (!reveal || myAnswer == null) return null;
  const data = reveal.reveal || {};
  if (data.type === "short") {
    const mine = String(myAnswer ?? "").trim().toLowerCase();
    const answer = String(data.answer ?? "").trim().toLowerCase();
    if (!mine) return false;
    return mine === answer;
  }
  const correct = Array.isArray(data.correct) ? data.correct.map(Number) : [];
  const mine = Array.isArray(myAnswer) ? myAnswer.map(Number) : [Number(myAnswer)];
  return correct.length === mine.length && correct.every(value => mine.includes(value));
}

// Очки по ответам выбранного вопроса. keys — map индексов вопросов.
export function scoreForQuestion(key, answer) {
  if (!key) return { correct: false, points: 0 };
  const correct = isCorrect(key, answer);
  return { correct, points: correct ? (key.points || 1) : 0 };
}

// Одиночный подсчёт: агрегирует ответы по всем открытым вопросам.
// revealedUntil — сколько вопросов уже закрыто и за них начислить очки.
// speed (необязательно): { qDurationSec, qStarts: {qid: ms} } — включает
// бонус за скорость для вопросов, у которых есть начальные/ответные
// серверные метки. Пересчёт с нуля из ответов — идемпотентен.
export function computeScores(players, keys, openedIndexes = [], speed = null) {
  const normalized = normalizeKeys(keys);
  const perPlayer = (players || []).filter(p => !p.observer).map(raw => {
    const player = speed ? normalizePlayerTimes(raw) : raw;
    let score = 0;
    let max = 0;
    let correctCount = 0;
    let answered = 0;
    let finished = 0;
    let streak = 0;
    let bestStreak = 0;
    const results = [];
    openedIndexes.forEach(index => {
      const qid = String(index);
      const key = normalized[qid];
      if (!key) return;
      max += key.points || 1;
      finished += 1;
      const answer = player.answers?.[qid];
      if (answer == null) { // пропуск сбрасывает серию
        streak = 0;
        results.push({ qid, answered: false, correct: false, points: 0, breakdown: null });
        return;
      }
      answered += 1;
      const { correct, points } = scoreForQuestion(key, answer);
      if (correct) {
        correctCount += 1;
        streak += 1;
        bestStreak = Math.max(bestStreak, streak);
        const breakdown = scoreBreakdown(points, {
          streak,
          speed: speed ? speedRatioFor(player, qid, speed) : 0
        });
        score += breakdown.total;
        results.push({ qid, answered: true, correct: true, points: breakdown.total, breakdown });
      } else {
        streak = 0; // неверный ответ сбрасывает серию
        results.push({ qid, answered: true, correct: false, points: 0, breakdown: null });
      }
    });
    return {
      uid: player.uid,
      name: player.name || "Участник",
      score,
      max,
      correctCount,
      // Сколько ответов дано и сколько вопросов уже завершено — для
      // рейтинга (процент верных, число завершённых вопросов).
      answered,
      finished,
      // Серия и дорожка ответов пишутся в scores/{uid} (правила Firestore
      // не ограничивают набор полей); results — только для клиента и тестов.
      streak,
      bestStreak,
      results,
      trail: trailFromResults(results)
    };
  });
  return perPlayer.sort((a, b) => b.score - a.score
    || b.correctCount - a.correctCount
    || (a.name || "").localeCompare(b.name || "", "ru"));
}

// Что раскрывается после закрытия вопроса (reveals/{q}) — только из
// ключей testKeys: правильные ответы оттуда и доходят до участников.
export function buildReveal(key) {
  if (!key) return null;
  const base = {
    type: key.type || "single",
    points: key.points || 1
  };
  if (key.type === "short") {
    base.answer = String(key.answer ?? "");
  } else {
    base.correct = Array.isArray(key.correct) ? key.correct : [];
  }
  if (typeof key.explanation === "string" && key.explanation.trim()) {
    base.explanation = key.explanation.trim();
  }
  return base;
}

// ---------- Ссылка приглашения в комнату ----------

// Полная ссылка приглашения для QR и кнопки «Ссылка»: #join/<код>.
// roomId комнаты равен коду (документ комнаты rooms/{код}), поэтому
// ссылка индивидуальна для каждой комнаты. locationLike — подмена
// window.location для тестов; в браузере берётся настоящий адрес.
export function buildJoinUrl(code, locationLike = null) {
  const normalized = normalizeRoomCode(code);
  if (!normalized) return "";
  const loc = locationLike
    || (typeof window !== "undefined" && window.location ? window.location : null);
  if (!loc) return "";
  const origin = loc.origin || "";
  const pathname = loc.pathname || "/";
  return `${origin}${pathname}#join/${normalized}`;
}

// ---------- Вход в комнату со страницы комнаты ----------

// Гейт страницы комнаты: какому виду принадлежит открытый #room/CODE,
// если роль ещё не определена. Раньше все эти случаи сводились к одной
// надписи «Вы не в этой комнате» даже когда снапшот участников ещё
// не пришёл, и без какого-либо пути подключиться на месте.
// Свойства:
//   playersLoaded — пришёл ли первый снапшот коллекции players;
//   players      — загруженные участники ({ uid, observer });
//   uid          — uid текущего пользователя (или null);
//   room         — документ комнаты (или null);
//   guest        — анонимный гость (нужна форма имя+аватар).
// Возвращает "waiting" (подключаемся), "player"/"observer" (участник),
// "confirm-join" (войти одной кнопкой), "guest-join" (форма гостя),
// "closed" (комната закрыта) или "signIn" (нужна авторизация).
// Страница комнаты не ждёт этого гейта для НЕ-участника: факт членства
// определяется чтением своего players/{uid} (правило uid == playerId),
// после чего НЕ-участник подключается напрямую до подписок — «Вас нет
// в этой комнате» приглашённому не показывается никогда.
export function roomGateStatus({ playersLoaded = false, players = [], uid = null, room = null, guest = false } = {}) {
  if (!room || !playersLoaded) return "waiting";
  const me = (players || []).find(p => p.uid === uid);
  if (me) return me.observer ? "observer" : "player";
  if (uid == null) return "signIn";
  if (room.status === "active") return guest ? "guest-join" : "confirm-join";
  return "closed";
}

// Поля players/{uid} для входа в комнату (joinRoom / joinRoomAsGuest).
//
// existing — данные существующего документа (или null при первом входе).
// Правила Firestore разрешают update только имени, аватару и updatedAt:
// повторный вход не переписывает joinedAt и не меняет роль (observer).
// SERVER_TS — маркер серверной метки: вызывающий заменяет его на
// serverTimestamp() перед записью.
export const SERVER_TIMESTAMP = Symbol("serverTimestamp");

export function joinPlayerFields(existing, { uid = "", playerId = "", name, observer = false, avatar = null, role = null } = {}) {
  if (!existing) {
    const fields = {
      uid: uid || "",
      playerId: playerId || uid || "",
      name,
      observer: !!observer,
      joinedAt: SERVER_TIMESTAMP,
      updatedAt: SERVER_TIMESTAMP
    };
    // Явная роль («player» / «observer») хранится рядом с флагом observer
    // и после создания документа не меняется (правила Firestore).
    if (role) fields.role = observer ? "observer" : "player";
    if (avatar) fields.avatar = avatar;
    return fields;
  }

  // Повторный вход: роль и время первого входа не трогаем, поле пишем
  // только если значение реально изменилось (merge не трогает остальное).
  const fields = { uid: existing.uid || uid || "", playerId: existing.playerId || playerId || uid || "" };
  if (name && name !== existing.name) fields.name = name;
  if (avatar && avatar !== existing.avatar) fields.avatar = avatar;
  fields.updatedAt = SERVER_TIMESTAMP;
  return fields;
}
