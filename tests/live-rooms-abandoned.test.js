// tests/live-rooms-abandoned.test.js — Live-комнаты закрываются, когда ведущий
// ушёл: признак присутствия, «брошенные» комнаты, поведение у участников,
// подчистка и закрытие при уходе со страницы.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOST_ABSENT_MS, HOST_HEARTBEAT_MS, roomLastActiveMs, isHostAbandoned,
  roomLifecycle, isRegistrationOpen
} from "../core/live-auto.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
const NOW = 1_800_000_000_000;
const min = n => n * 60 * 1000;
const ts = ms => ({ toMillis: () => ms });
const room = (extra = {}) => ({ status: "active", createdAt: ts(NOW - min(120)), updatedAt: ts(NOW - min(120)), ...extra });

test("параметры: пульс чаще границы отсутствия", () => {
  assert.ok(HOST_HEARTBEAT_MS * 4 < HOST_ABSENT_MS);
});

test("комната с живым ведущим (hostSeenAt недавно) не брошена, даже если создана давно", () => {
  const r = room({ hostSeenAt: ts(NOW - min(1)) });
  assert.equal(isHostAbandoned(r, NOW), false);
  assert.equal(roomLifecycle(r, NOW) === "closed", false);
});

test("ведущего нет дольше лимита — комната считается закрытой у всех ролей", () => {
  const r = room({ hostSeenAt: ts(NOW - HOST_ABSENT_MS - 1000) });
  assert.equal(isHostAbandoned(r, NOW), true);
  assert.equal(roomLifecycle(r, NOW), "closed");
  assert.equal(isRegistrationOpen(r, NOW), false, "новых участников не принимаем");
  assert.equal(isHostAbandoned(room({ hostSeenAt: ts(NOW - HOST_ABSENT_MS + 1000) }), NOW), false, "ровно на границе — ещё жива");
});

test("старая комната без hostSeenAt (до этого обновления) закрывается по давности обновления", () => {
  assert.equal(isHostAbandoned(room(), NOW), true);
  assert.equal(roomLastActiveMs(room({ updatedAt: ts(NOW - min(2)) })), NOW - min(2));
  // Любое действие ведущего (updatedAt) тоже признак жизни.
  assert.equal(isHostAbandoned(room({ updatedAt: ts(NOW - min(3)) }), NOW), false);
});

test("совместимость: комнаты без дат и закрытые не трогаются; числа и секунды Timestamp читаются", () => {
  assert.equal(isHostAbandoned({ status: "active" }, NOW), false, "без дат не гадаем");
  assert.equal(isHostAbandoned({ status: "closed", updatedAt: ts(0) }, NOW), false);
  assert.equal(isHostAbandoned(null, NOW), false);
  assert.equal(isHostAbandoned(room(), undefined), false, "без текущего времени проверка не срабатывает");
  assert.equal(roomLastActiveMs({ hostSeenAt: { seconds: 100 } }), 100000);
  assert.equal(roomLastActiveMs({ createdAt: 5000 }), 5000);
});

test("комнаты по расписанию без ведущего закрываются как брошенные только после завершения", () => {
  const auto = room({ mode: "auto", autoStartedAt: ts(NOW - min(120)) });
  const selfRun = isHostAbandoned({ ...auto, liveState: "in_progress" }, NOW);
  assert.equal(selfRun, false, "автокомната идёт сама, пока не завершена");
  assert.equal(isHostAbandoned({ ...auto, autoEndedAt: ts(NOW - min(60)) }, NOW), true);
});

test("страница комнаты: пульс ведущего и закрытие при уходе, но не при переходе на проектор", () => {
  const src = read("ui/pages/room.js");
  assert.match(src, /hostBeat = setInterval\(\(\) => touchHostPresence\(code\), HOST_HEARTBEAT_MS\)/);
  const cleanup = src.slice(src.indexOf("export function cleanup()"), src.indexOf("export function cleanup()") + 900);
  assert.match(cleanup, /current\.isHost/);
  assert.match(cleanup, /startsWith\(`room\/\$\{current\.code\.toLowerCase\(\)\}`\)/);
  assert.match(cleanup, /closeRoom\(current\.code\)/);
  assert.match(cleanup, /stopInterval\(hostBeat\)/);
});

test("слой Firestore: пульс не требует изменения правил, подчистка закрывает только брошенные", () => {
  const rooms = read("core/rooms.js");
  assert.match(rooms, /updateDoc\(roomRef\(roomCode\), \{ hostSeenAt: serverTimestamp\(\) \}\)/);
  const sweep = rooms.slice(rooms.indexOf("export async function closeAbandonedRooms"));
  assert.match(sweep, /where\("hostId", "==", hostId\), where\("status", "==", "active"\)/);
  assert.match(sweep, /if \(!isHostAbandoned\(/);
  // Правила: ведущий вправе менять свою комнату (кроме hostId) — отдельный деплой не нужен.
  assert.match(read("firestore.rules"), /allow update, delete: if isRoomHost\(\)/);
  // Подчистка вызывается на главной и перед построением плана удаления теста.
  for (const f of ["ui/pages/home.js", "ui/pages/tests.js", "ui/pages/create-test.js", "ui/components/delete-flows.js"]) {
    assert.match(read(f), /closeAbandonedRooms\(\)/, f);
  }
});
