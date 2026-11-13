// tests/room-launch.test.js — надёжность запуска Live-комнаты (этап
// «надёжный запуск обычного теста в режиме Live»).
//
// ui/pages/launch.js и ui/pages/room.js — браузерный код: в Node не
// импортируются. Логика проверяется анализом исходника (паттерн
// room-leaderboard-defect.test.js), чистые функции уже покрыты
// tests/rooms.test.js и tests/live-auto.test.js, права — Rules API
// (tools/rules-test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const launch = readFileSync(path.join(ROOT, "ui/pages/launch.js"), "utf8");
const rooms = readFileSync(path.join(ROOT, "core/rooms.js"), "utf8");
const roomPage = readFileSync(path.join(ROOT, "ui/pages/room.js"), "utf8");

test("launch: двойное нажатие «Открыть Live-комнату» не создаёт две комнаты", () => {
  // Флаг живёт в замыкании страницы и проверяется ДО записи в Firestore.
  assert.match(launch, /let creatingRoom = false;/);
  assert.match(launch, /if \(creatingRoom\) return;/);
  // Порядок: флаг → блокировка кнопки → создание.
  const handler = launch.slice(launch.indexOf("onclick: async () => {"),
    launch.indexOf("}));", launch.indexOf("onclick: async () => {")));
  const flagIdx = handler.indexOf("creatingRoom = true;");
  const disableIdx = handler.indexOf("roomBtn.disabled = true;");
  const createIdx = handler.indexOf("await createRoom(");
  assert.ok(flagIdx !== -1 && disableIdx !== -1 && createIdx !== -1,
    "обработчик должен блокировать кнопку и создавать комнату");
  assert.ok(flagIdx < disableIdx && disableIdx < createIdx,
    "флаг и блокировка должны срабатывать раньше записи в Firestore");
  // После ошибки флаг и кнопка возвращаются в рабочее состояние.
  const catchPart = handler.slice(handler.indexOf("} catch"));
  assert.match(catchPart, /creatingRoom = false;/);
  assert.match(catchPart, /roomBtn\.disabled = false;/);
});

test("createRoom: мёртвой защиты от двойного создания больше нет", () => {
  // Раньше: let creating = false; if (creating) return; — локальная
  // переменная всегда false, проверка ничего не защищала.
  assert.equal(/if \(creating\) return;/.test(rooms), false,
    "мёртвый гейт должен быть удалён");
});

test("createRoom: параметр allowObservers не теряется", () => {
  // Правила читают roomDoc().get("allowObservers", false); параметр
  // должен попадать в документ комнаты, а не молча отбрасываться.
  assert.match(rooms, /allowObservers: allowObservers === true,/);
});

test("room: QR и ссылка приглашения ведут на #join/<код>, не на проектор", () => {
  // joinUrl — единственный источник адреса для QR (карточка, проектор,
  // мини-QR), и он делегирует buildJoinUrl (#join/<код>).
  const joinFn = roomPage.slice(
    roomPage.indexOf("function joinUrl(code) {"),
    roomPage.indexOf("}", roomPage.indexOf("function joinUrl(code) {")) + 1);
  assert.match(joinFn, /return buildJoinUrl\(code\);/);
  const paintBody = roomPage.slice(
    roomPage.indexOf("function paintQR(box, code"),
    roomPage.indexOf("}", roomPage.indexOf("box.innerHTML = generateQRSvg")) + 1);
  assert.match(paintBody, /joinUrl\(code\)/);
  assert.equal(paintBody.includes("screen"), false,
    "QR не должен кодировать адрес проектора");
});

test("room: повторная отправка ответа заблокирована и на клиенте", () => {
  // submitAnswer: кнопка блокируется до записи; после успешной отправки
  // кнопка обратно не разблокируется (вид заменяется на «Ответ принят»).
  const fn = roomPage.slice(
    roomPage.indexOf("async function submitAnswer("),
    roomPage.indexOf("// ---------- Вид наблюдателя ----------"));
  const disableIdx = fn.indexOf("submitBtn.disabled = true;");
  const saveIdx = fn.indexOf("await saveAnswer(");
  assert.ok(disableIdx !== -1 && saveIdx !== -1 && disableIdx < saveIdx,
    "кнопка блокируется до отправки ответа");
  const successPart = fn.slice(saveIdx, fn.indexOf("} catch"));
  assert.equal(successPart.includes("submitBtn.disabled = false"), false,
    "после успешной отправки кнопка не разблокируется");
});
