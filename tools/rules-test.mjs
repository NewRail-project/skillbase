#!/usr/bin/env node
// Проверка firestore.rules через Firebase Rules API (projects.test).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB = "/databases/(default)/documents";
const ORG = "default-org";
const ISO = "2026-01-01T00:00:00Z";

// Публичные OAuth-реквизиты Firebase CLI.
const CLI_CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLI_CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";

function configPath() {
    if (process.env.FIREBASE_CONFIGSTORE) {
        return process.env.FIREBASE_CONFIGSTORE;
    }

    if (process.platform === "win32" && process.env.APPDATA) {
        return join(
            process.env.APPDATA,
            "configstore",
            "firebase-tools.json"
        );
    }

    return join(
        homedir(),
        ".config",
        "configstore",
        "firebase-tools.json"
    );
}

async function accessToken() {
    if (process.env.FIREBASE_ACCESS_TOKEN) {
        return process.env.FIREBASE_ACCESS_TOKEN;
    }

    let cfg;

    try {
        cfg = JSON.parse(readFileSync(configPath(), "utf8"));
    } catch {
        throw new Error(
            "Не найден вход Firebase CLI. Выполните: firebase login"
        );
    }

    const tokens = cfg.tokens || {};

    if (
        tokens.access_token &&
        tokens.expires_at > Date.now() + 60_000
    ) {
        return tokens.access_token;
    }

    if (!tokens.refresh_token) {
        throw new Error(
            "Нет refresh token. Выполните: firebase login"
        );
    }

    const response = await fetch(
        "https://oauth2.googleapis.com/token",
        {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                client_id: CLI_CLIENT_ID,
                client_secret: CLI_CLIENT_SECRET,
                refresh_token: tokens.refresh_token,
                grant_type: "refresh_token"
            })
        }
    );

    const json = await response.json();

    if (!response.ok || !json.access_token) {
        throw new Error(
            `Не удалось обновить токен Firebase CLI: ${
                json.error_description || json.error || response.status
            }`
        );
    }

    return json.access_token;
}

function projectId() {
    const config = JSON.parse(
        readFileSync(join(ROOT, ".firebaserc"), "utf8")
    );

    const project =
        config.projects?.default ||
        config.projects?.production;

    if (!project) {
        throw new Error(
            "Не найден project ID в .firebaserc"
        );
    }

    return project;
}

// Снимок попытки для кейсов с гейтингом материалов.
function attemptDoc() {
    return {
        userId: "student1",
        userEmail: "student1@example.com",
        orgId: ORG,
        testId: "t1",
        testTitle: "Тест",
        assignmentId: "a1",
        answers: {},
        status: "in_progress",
        attemptNo: 1,
        deadlineAt: null,
        userName: "Test User",
        groupId: "default-group"
    };
}

// Моки задания a1 нужного типа (training/exam).
function assignmentMocks(kind = "training") {
    return [
        {
            function: "exists",
            args: [{ exactValue: `${DB}/assignments/a1` }],
            result: { value: true }
        },
        {
            function: "get",
            args: [{ exactValue: `${DB}/assignments/a1` }],
            result: {
                value: {
                    data: { status: "active", groupId: "default-group", orgId: ORG, kind, deadline: null }
                }
            }
        }
    ];
}

function userDoc(uid, role, orgId = ORG, extra = {}) {
    return {
        uid,
        email: `${uid}@example.com`,
        role,
        orgId,
        groupId:
            extra.groupId ||
            (orgId === "default-org" ? "default-group" : ""),
        fullName: extra.fullName || "Test User",
        ui: "education",
        createdAt: ISO,
        ...extra
    };
}

function profileMocks(uid, role, orgId = ORG, extra = {}) {
    const path = `${DB}/users/${uid}`;
    const data = userDoc(uid, role, orgId, extra);

    return [
        {
            function: "exists",
            args: [{ exactValue: path }],
            result: { value: true }
        },
        {
            function: "get",
            args: [{ exactValue: path }],
            result: { value: { data } }
        }
    ];
}

// Моки комнаты r1: ведущий teacher1, вопрос открыт на номер questionId.
function roomMocks(questionId = "3", phase = "opened", overrides = {}) {
    return [
        {
            function: "get",
            args: [{ exactValue: `${DB}/rooms/r1` }],
            result: {
                value: {
                    data: {
                        hostId: "teacher1",
                        orgId: ORG,
                        status: "active",
                        phase,
                        currentQuestionId: questionId,
                        ...overrides
                    }
                }
            }
        },
        {
            function: "exists",
            args: [{ exactValue: `${DB}/rooms/r1/players/student1` }],
            result: { value: true }
        }
    ];
}

// Моки документа players/{uid} для playerDoc() внутри /answers/.
function playerMock(uid, observer) {
    const path = `${DB}/rooms/r1/players/${uid}`;
    const data = { uid, playerId: uid, observer, name: "Test User" };
    return [
        {
            function: "exists",
            args: [{ exactValue: path }],
            result: { value: true }
        },
        {
            function: "get",
            args: [{ exactValue: path }],
            result: { value: { data } }
        }
    ];
}

function testDoc(overrides = {}) {
    return {
        id: "t1",
        title: "Тест",
        authorId: "teacher1",
        orgId: ORG,
        status: "published",
        version: 1,
        questions: [{ id: "q1" }],
        createdAt: ISO,
        ...overrides
    };
}

// Моки автономной комнаты r1: старт 00:00:00, вопрос 20 с + пауза 3 с
// (слот 23 с), 2 вопроса. overrides меняют поля комнаты.
const AUTO_START = "2026-01-01T00:00:00Z";
function autoRoomMocks(overrides = {}) {
    return roomMocks("", "idle", {
        mode: "auto",
        liveState: "in_progress",
        questionSec: 20,
        gapSec: 3,
        questionCount: 2,
        autoStartedAt: AUTO_START,
        autoEndedAt: null,
        ...overrides
    });
}

// Ответ в автономной комнате в момент at (секунды от старта).
function autoAnswerCase(name, expectation, { uid = "student1", qid = "0", atSec, observer = false, role, roomOverrides = {} }) {
    const time = new Date(Date.parse(AUTO_START) + atSec * 1000).toISOString();
    const playerData = { uid, playerId: uid, observer, name: "Test User" };
    if (role) playerData.role = role;
    const path = `${DB}/rooms/r1/players/${uid}`;
    return {
        name,
        expectation,
        request: {
            auth: { uid },
            path: `${DB}/rooms/r1/players/${uid}/answers/${qid}`,
            method: "create",
            resource: { data: { answer: "A", at: time } },
            time
        },
        functionMocks: [
            ...profileMocks(uid, "student"),
            ...autoRoomMocks(roomOverrides),
            { function: "exists", args: [{ exactValue: path }], result: { value: true } },
            { function: "get", args: [{ exactValue: path }], result: { value: { data: playerData } } }
        ]
    };
}

function joinCase(name, expectation, data, roomOverrides = {}) {
    return {
        name,
        expectation,
        request: {
            auth: { uid: "student3" },
            path: `${DB}/rooms/r1/players/student3`,
            method: "create",
            resource: {
                data: {
                    uid: "student3", playerId: "student3", name: "Иванов Иван",
                    joinedAt: ISO, updatedAt: ISO, ...data
                }
            }
        },
        functionMocks: [
            ...profileMocks("student3", "student"),
            ...roomMocks("", "idle", { mode: "auto", liveState: "waiting", ...roomOverrides })
        ]
    };
}

function liveAutoCases() {
    return [
        autoAnswerCase("Авто: ответ на текущий вопрос 0 внутри окна", "ALLOW", { qid: "0", atSec: 10 }),
        autoAnswerCase("Авто: допуск 1 с на сеть после окончания окна", "ALLOW", { qid: "0", atSec: 20.8 }),
        autoAnswerCase("Авто: ответ после окна и допуска (пауза) — отказ", "DENY", { qid: "0", atSec: 21.5 }),
        autoAnswerCase("Авто: вопрос 1 до его начала — отказ", "DENY", { qid: "1", atSec: 10 }),
        autoAnswerCase("Авто: вопрос 1 в своём слоте — разрешён", "ALLOW", { qid: "1", atSec: 28 }),
        autoAnswerCase("Авто: вопрос 0 в слоте вопроса 1 — отказ", "DENY", { qid: "0", atSec: 28 }),
        autoAnswerCase("Авто: несуществующий вопрос 2 — отказ", "DENY", { qid: "2", atSec: 47 }),
        autoAnswerCase("Авто: тест не запущен (waiting) — отказ", "DENY", {
            qid: "0", atSec: 5, roomOverrides: { liveState: "waiting", autoStartedAt: null }
        }),
        autoAnswerCase("Авто: после досрочного завершения — отказ", "DENY", {
            qid: "0", atSec: 10, roomOverrides: { autoEndedAt: "2026-01-01T00:00:05Z" }
        }),
        autoAnswerCase("Авто: комната закрыта — отказ", "DENY", {
            qid: "0", atSec: 10, roomOverrides: { status: "closed" }
        }),
        autoAnswerCase("Авто: наблюдатель (флаг observer) не отвечает", "DENY", {
            uid: "student2", qid: "0", atSec: 10, observer: true
        }),
        autoAnswerCase("Авто: наблюдатель (role=observer) не отвечает", "DENY", {
            uid: "student2", qid: "0", atSec: 10, observer: false, role: "observer"
        }),
        autoAnswerCase("Авто: участник (role=player) отвечает", "ALLOW", {
            qid: "0", atSec: 10, role: "player"
        }),
        {
            name: "Авто: чужой ответ от имени другого участника — отказ",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1/players/student2/answers/0`,
                method: "create",
                resource: { data: { answer: "A", at: "2026-01-01T00:00:10Z" } },
                time: "2026-01-01T00:00:10Z"
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                ...autoRoomMocks(),
                ...playerMock("student2", false)
            ]
        },
        joinCase("Роли: вход участником с role=player", "ALLOW", { observer: false, role: "player" }),
        joinCase("Роли: role=observer при observer=false (рассогласование) — отказ", "DENY", { observer: false, role: "observer" }),
        joinCase("Роли: студент входит наблюдателем (role=observer, observer=true)", "ALLOW", { observer: true, role: "observer" }),
        joinCase("Роли: произвольное значение role — отказ", "DENY", { observer: false, role: "admin" }),
        joinCase("Регистрация закрыта — новый участник не входит", "DENY",
            { observer: false, role: "player" }, { registrationOpen: false }),
        joinCase("Регистрация открыта — новый участник входит", "ALLOW",
            { observer: false, role: "player" }, { registrationOpen: true }),
        joinCase("Комната закрыта — вход запрещён", "DENY",
            { observer: false, role: "player" }, { status: "closed" }),
        {
            name: "Роли: участник не меняет роль после входа",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1/players/student1`,
                method: "update",
                requestResource: true
            },
            resource: {
                data: { uid: "student1", playerId: "student1", name: "Иван", observer: true, role: "observer", joinedAt: ISO }
            },
            newDoc: {
                uid: "student1", playerId: "student1", name: "Иван", observer: false, role: "player",
                joinedAt: ISO, updatedAt: ISO
            },
            functionMocks: []
        },
        {
            name: "Роли: повторный вход обновляет только updatedAt (проба часов)",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1/players/student1`,
                method: "update",
                requestResource: true
            },
            resource: {
                data: { uid: "student1", playerId: "student1", name: "Иван", observer: false, role: "player", joinedAt: ISO }
            },
            newDoc: {
                uid: "student1", playerId: "student1", name: "Иван", observer: false, role: "player",
                joinedAt: ISO, updatedAt: "2026-01-01T00:05:00Z"
            },
            functionMocks: []
        },
        {
            name: "Авто: участник не пишет очки (scores)",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1/scores/student1`,
                method: "create",
                resource: { data: { uid: "student1", score: 9999 } }
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                ...autoRoomMocks()
            ]
        },
        {
            name: "Авто: участник не запускает тест (update комнаты)",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1`,
                method: "update",
                requestResource: true
            },
            resource: { data: { hostId: "teacher1", orgId: ORG, status: "active", mode: "auto", liveState: "waiting" } },
            newDoc: { hostId: "teacher1", orgId: ORG, status: "active", mode: "auto", liveState: "in_progress" },
            functionMocks: [
                ...profileMocks("student1", "student"),
                ...autoRoomMocks()
            ]
        },
        {
            name: "Авто: ведущий запускает тест один раз (update комнаты)",
            expectation: "ALLOW",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/rooms/r1`,
                method: "update",
                requestResource: true
            },
            resource: { data: { hostId: "teacher1", orgId: ORG, status: "active", mode: "auto", liveState: "waiting" } },
            newDoc: { hostId: "teacher1", orgId: ORG, status: "active", mode: "auto", liveState: "in_progress", autoStartedAt: AUTO_START },
            functionMocks: [
                ...profileMocks("teacher1", "teacher"),
                ...autoRoomMocks()
            ]
        },
        {
            name: "Авто: ведущий пишет рейтинг (scores)",
            expectation: "ALLOW",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/rooms/r1/scores/student1`,
                method: "create",
                resource: { data: { uid: "student1", score: 3, max: 4, correctCount: 2 } }
            },
            functionMocks: [
                ...profileMocks("teacher1", "teacher"),
                ...autoRoomMocks()
            ]
        },
        {
            name: "Авто: участник не читает чужие ответы",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1/players/student2/answers/0`,
                method: "get"
            },
            resource: { data: { answer: "A" } },
            functionMocks: [
                ...profileMocks("student1", "student"),
                ...autoRoomMocks()
            ]
        }
    ];
}

// ---------- Предметы и темы ----------

const SUBJECT_KEYS = {
    orgId: ORG,
    title: "Электрические машины",
    description: "",
    order: 0,
    status: "active",
    createdBy: "teacher1",
    createdAt: ISO,
    updatedAt: ISO
};

function subjectDoc(overrides = {}) {
    return { ...SUBJECT_KEYS, ...overrides };
}

function topicDoc(overrides = {}) {
    return {
        orgId: ORG,
        subjectId: "s1",
        title: "Тяговые двигатели",
        description: "",
        order: 0,
        status: "active",
        createdBy: "teacher1",
        createdAt: ISO,
        updatedAt: ISO,
        ...overrides
    };
}

// Моки предмета s1 для правила create у тем.
function subjectMock(subjectId = "s1", orgId = ORG) {
    const path = `${DB}/subjects/${subjectId}`;
    return [
        {
            function: "exists",
            args: [{ exactValue: path }],
            result: { value: true }
        },
        {
            function: "get",
            args: [{ exactValue: path }],
            result: { value: { data: { orgId, title: "Предмет" } } }
        }
    ];
}

function subjectCases() {
    return [
        // ---------- чтение ----------
        {
            name: "Предметы: студент читает предмет своей организации",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/subjects/s1`,
                method: "get"
            },
            resource: { data: subjectDoc() },
            functionMocks: profileMocks("student1", "student")
        },
        {
            name: "Предметы: студент не читает предмет чужой организации",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/subjects/s-other`,
                method: "get"
            },
            resource: { data: subjectDoc({ orgId: "other-org" }) },
            functionMocks: profileMocks("student1", "student")
        },
        {
            name: "Предметы: анонимный гость не читает предметы",
            expectation: "DENY",
            request: {
                auth: { uid: "guest1", token: { firebase: { sign_in_provider: "anonymous" } } },
                path: `${DB}/subjects/s1`,
                method: "get"
            },
            resource: { data: subjectDoc() },
            functionMocks: [
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/users/guest1` }],
                    result: { value: false }
                }
            ]
        },
        {
            name: "Предметы: сотрудник читает отсутствующий предмет",
            expectation: "ALLOW",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/subjects/s-none`,
                method: "get"
            },
            resource: null,
            functionMocks: profileMocks("teacher1", "teacher")
        },
        // ---------- создание ----------
        {
            name: "Предметы: преподаватель создаёт предмет своей организации",
            expectation: "ALLOW",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/subjects/s-new`,
                method: "create",
                resource: { data: subjectDoc() }
            },
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Предметы: администратор создаёт предмет",
            expectation: "ALLOW",
            request: {
                auth: { uid: "admin1" },
                path: `${DB}/subjects/s-admin`,
                method: "create",
                resource: { data: subjectDoc({ createdBy: "admin1" }) }
            },
            functionMocks: profileMocks("admin1", "admin")
        },
        {
            name: "Предметы: преподаватель с ограничением групп управляет предметами",
            expectation: "ALLOW",
            request: {
                auth: { uid: "teacher3" },
                path: `${DB}/subjects/s-grouped`,
                method: "create",
                resource: { data: subjectDoc({ createdBy: "teacher3" }) }
            },
            functionMocks: profileMocks("teacher3", "teacher", ORG, {
                teacherGroups: ["group-a"]
            })
        },
        {
            name: "Предметы: студент не создаёт предмет",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/subjects/s-student`,
                method: "create",
                resource: { data: subjectDoc({ createdBy: "student1" }) }
            },
            functionMocks: profileMocks("student1", "student")
        },
        {
            name: "Предметы: нельзя создать предмет в чужой организации",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/subjects/s-foreign`,
                method: "create",
                resource: { data: subjectDoc({ orgId: "other-org" }) }
            },
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Предметы: нельзя подменить автора при создании",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/subjects/s-spoof`,
                method: "create",
                resource: { data: subjectDoc({ createdBy: "student1" }) }
            },
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Предметы: пустое название — отказ",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/subjects/s-empty`,
                method: "create",
                resource: { data: subjectDoc({ title: "   " }) }
            },
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Предметы: название длиннее 120 символов — отказ",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/subjects/s-long`,
                method: "create",
                resource: { data: subjectDoc({ title: "Б".repeat(121) }) }
            },
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Предметы: некорректный тип названия (число) — отказ",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/subjects/s-type`,
                method: "create",
                resource: { data: subjectDoc({ title: 5 }) }
            },
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Предметы: дробный order — отказ",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/subjects/s-frac`,
                method: "create",
                resource: { data: subjectDoc({ order: 1.5 }) }
            },
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Предметы: отрицательный order — отказ",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/subjects/s-neg`,
                method: "create",
                resource: { data: subjectDoc({ order: -1 }) }
            },
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Предметы: строка вместо числа order — отказ",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/subjects/s-str`,
                method: "create",
                resource: { data: subjectDoc({ order: "1" }) }
            },
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Предметы: создание сразу в архиве — отказ (только active)",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/subjects/s-arch`,
                method: "create",
                resource: { data: subjectDoc({ status: "archived" }) }
            },
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Предметы: неизвестное поле — отказ",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/subjects/s-hack`,
                method: "create",
                resource: { data: { ...subjectDoc(), hack: 1 } }
            },
            functionMocks: profileMocks("teacher1", "teacher")
        },
        // ---------- изменение ----------
        {
            name: "Предметы: преподаватель архивирует предмет",
            expectation: "ALLOW",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/subjects/s1`,
                method: "update",
                requestResource: true
            },
            existingDoc: subjectDoc(),
            newDoc: subjectDoc({ status: "archived", updatedAt: "2026-01-02T00:00:00Z" }),
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Предметы: студент не изменяет предмет",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/subjects/s1`,
                method: "update",
                requestResource: true
            },
            existingDoc: subjectDoc(),
            newDoc: subjectDoc({ title: "Взлом" }),
            functionMocks: profileMocks("student1", "student")
        },
        {
            name: "Предметы: преподаватель другой организации не изменяет предмет",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher2" },
                path: `${DB}/subjects/s1`,
                method: "update",
                requestResource: true
            },
            existingDoc: subjectDoc({ orgId: "other-org" }),
            newDoc: subjectDoc({ orgId: "other-org", title: "Чужое" }),
            functionMocks: profileMocks("teacher2", "teacher")
        },
        {
            name: "Предметы: нельзя перенести предмет в другую организацию",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/subjects/s1`,
                method: "update",
                requestResource: true
            },
            existingDoc: subjectDoc(),
            newDoc: subjectDoc({ orgId: "other-org" }),
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Предметы: нельзя подменить автора при изменении",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/subjects/s1`,
                method: "update",
                requestResource: true
            },
            existingDoc: subjectDoc(),
            newDoc: subjectDoc({ createdBy: "student1" }),
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Предметы: изменение с пустым названием — отказ",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/subjects/s1`,
                method: "update",
                requestResource: true
            },
            existingDoc: subjectDoc(),
            newDoc: subjectDoc({ title: "" }),
            functionMocks: profileMocks("teacher1", "teacher")
        },
        // ---------- темы ----------
        {
            name: "Темы: студент читает тему своей организации",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/topics/t1`,
                method: "get"
            },
            resource: { data: topicDoc() },
            functionMocks: profileMocks("student1", "student")
        },
        {
            name: "Темы: студент не читает тему чужой организации",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/topics/t-other`,
                method: "get"
            },
            resource: { data: topicDoc({ orgId: "other-org" }) },
            functionMocks: profileMocks("student1", "student")
        },
        {
            name: "Темы: преподаватель создаёт тему своего предмета",
            expectation: "ALLOW",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/topics/t-new`,
                method: "create",
                resource: { data: topicDoc() }
            },
            functionMocks: [
                ...profileMocks("teacher1", "teacher"),
                ...subjectMock("s1")
            ]
        },
        {
            name: "Темы: нельзя создать тему на предмет чужой организации",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/topics/t-foreign`,
                method: "create",
                resource: { data: topicDoc() }
            },
            functionMocks: [
                ...profileMocks("teacher1", "teacher"),
                ...subjectMock("s1", "other-org")
            ]
        },
        {
            name: "Темы: нельзя создать тему на несуществующий предмет",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/topics/t-none`,
                method: "create",
                resource: { data: topicDoc({ subjectId: "s-none" }) }
            },
            functionMocks: [
                ...profileMocks("teacher1", "teacher"),
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/subjects/s-none` }],
                    result: { value: false }
                }
            ]
        },
        {
            name: "Темы: студент не создаёт тему",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/topics/t-student`,
                method: "create",
                resource: { data: topicDoc({ createdBy: "student1" }) }
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                ...subjectMock("s1")
            ]
        },
        {
            name: "Темы: пустое название темы — отказ",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/topics/t-empty`,
                method: "create",
                resource: { data: topicDoc({ title: "" }) }
            },
            functionMocks: [
                ...profileMocks("teacher1", "teacher"),
                ...subjectMock("s1")
            ]
        },
        {
            name: "Темы: отрицательный order — отказ",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/topics/t-neg`,
                method: "create",
                resource: { data: topicDoc({ order: -2 }) }
            },
            functionMocks: [
                ...profileMocks("teacher1", "teacher"),
                ...subjectMock("s1")
            ]
        },
        {
            name: "Темы: нельзя подменить автора темы",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/topics/t-spoof`,
                method: "create",
                resource: { data: topicDoc({ createdBy: "student1" }) }
            },
            functionMocks: [
                ...profileMocks("teacher1", "teacher"),
                ...subjectMock("s1")
            ]
        },
        {
            name: "Темы: преподаватель архивирует тему",
            expectation: "ALLOW",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/topics/t1`,
                method: "update",
                requestResource: true
            },
            existingDoc: topicDoc(),
            newDoc: topicDoc({ status: "archived", updatedAt: "2026-01-02T00:00:00Z" }),
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Темы: нельзя сменить предмет темы",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/topics/t1`,
                method: "update",
                requestResource: true
            },
            existingDoc: topicDoc(),
            newDoc: topicDoc({ subjectId: "s2" }),
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Темы: нельзя перенести тему в другую организацию",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/topics/t1`,
                method: "update",
                requestResource: true
            },
            existingDoc: topicDoc(),
            newDoc: topicDoc({ orgId: "other-org" }),
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Темы: студент не изменяет тему",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/topics/t1`,
                method: "update",
                requestResource: true
            },
            existingDoc: topicDoc(),
            newDoc: topicDoc({ title: "Взлом" }),
            functionMocks: profileMocks("student1", "student")
        },
        {
            name: "Темы: недопустимый статус published — отказ",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/topics/t1`,
                method: "update",
                requestResource: true
            },
            existingDoc: topicDoc(),
            newDoc: topicDoc({ status: "published" }),
            functionMocks: profileMocks("teacher1", "teacher")
        }
    ];
}

function testCases() {
    return [
        {
            name: "Студент читает свой профиль",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/users/student1`,
                method: "get"
            },
            resource: {
                data: userDoc("student1", "student")
            }
        },
        {
            name: "Пользователь читает публичный профиль своей организации",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/publicProfiles/student2`,
                method: "get"
            },
            resource: {
                data: {
                    displayName: "Student Two",
                    orgId: ORG
                }
            },
            functionMocks: profileMocks("student1", "student")
        },
        {
            name: "Студент читает опубликованный тест",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/tests/t1`,
                method: "get"
            },
            resource: {
                data: testDoc()
            },
            functionMocks: profileMocks("student1", "student")
        },
        {
            name: "Студент не читает тест чужой организации",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/tests/t2`,
                method: "get"
            },
            resource: {
                data: testDoc({ orgId: "other-org" })
            },
            functionMocks: profileMocks("student1", "student")
        },
        {
            name: "Тесты: анонимный гость читает опубликованный тест",
            expectation: "ALLOW",
            request: {
                auth: { uid: "guest1", token: { firebase: { sign_in_provider: "anonymous" } } },
                path: `${DB}/tests/t1`,
                method: "get"
            },
            resource: {
                data: testDoc({ status: "published" })
            },
            functionMocks: []
        },
        {
            name: "Тесты: анонимный гость не читает черновик",
            expectation: "DENY",
            request: {
                auth: { uid: "guest1", token: { firebase: { sign_in_provider: "anonymous" } } },
                path: `${DB}/tests/t1`,
                method: "get"
            },
            resource: {
                data: testDoc({ status: "draft" })
            },
            functionMocks: []
        },
        {
            name: "Тесты: сотрудник читает отсутствующий тест",
            expectation: "ALLOW",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/tests/t-none`,
                method: "get"
            },
            resource: null,
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Тесты: преподаватель не читает тест чужой организации",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/tests/t-other`,
                method: "get"
            },
            resource: {
                data: testDoc({ orgId: "other-org" })
            },
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Преподаватель читает свой ключ теста",
            expectation: "ALLOW",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/testKeys/t1`,
                method: "get"
            },
            resource: {
                data: {
                    authorId: "teacher1",
                    orgId: ORG,
                    answers: { q1: "A" }
                }
            },
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Публикация теста создаёт снимок версии",
            expectation: "ALLOW",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/tests/t1/versions/2`,
                method: "create",
                resource: {
                    data: {
                        id: "t1",
                        authorId: "teacher1",
                        orgId: ORG,
                        status: "published",
                        version: 2,
                        questions: [{ id: "q1" }]
                    }
                }
            },
            functionMocks: [
                ...profileMocks("teacher1", "teacher"),
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: {
                        value: {
                            data: { authorId: "teacher1", orgId: ORG }
                        }
                    }
                }
            ]
        },
        {
            name: "Регистрация с чужим orgId запрещена",
            expectation: "DENY",
            request: {
                auth: { uid: "student-out" },
                path: `${DB}/users/student-out`,
                method: "create",
                resource: {
                    data: userDoc("student-out", "student", "other-org")
                }
            }
        },
        {
            name: "Преподаватель читает пользователя своей организации",
            expectation: "ALLOW",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/users/student2`,
                method: "get"
            },
            resource: {
                data: userDoc("student2", "student")
            },
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Преподаватель не читает пользователя чужой организации",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/users/outsider`,
                method: "get"
            },
            resource: {
                data: userDoc("outsider", "student", "other-org")
            },
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Админ меняет роль пользователю своей организации",
            expectation: "ALLOW",
            request: {
                auth: { uid: "admin1" },
                path: `${DB}/users/student2`,
                method: "update",
                requestResource: true
            },
            existingDoc: userDoc("student2", "student"),
            newDoc: userDoc("student2", "teacher"),
            functionMocks: profileMocks("admin1", "admin")
        },
        {
            name: "Админ не меняет роль себе",
            expectation: "DENY",
            request: {
                auth: { uid: "admin1" },
                path: `${DB}/users/admin1`,
                method: "update",
                requestResource: true
            },
            existingDoc: userDoc("admin1", "admin"),
            newDoc: userDoc("admin1", "student"),
            functionMocks: profileMocks("admin1", "admin")
        },
        {
            name: "Студент не читает ключи теста",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/testKeys/t1`,
                method: "get"
            },
            resource: {
                data: {
                    authorId: "teacher1",
                    orgId: ORG,
                    answers: { q1: "A" }
                }
            },
            functionMocks: profileMocks("student1", "student")
        },
        {
            name: "testKeys: студент с активной попыткой и showCorrectAfterQuestion == true — ALLOW",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/testKeys/t1`,
                method: "get"
            },
            resource: {
                data: { orgId: ORG, authorId: "teacher1", items: { q1: "A" } }
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: { value: { data: { settings: { showCorrectAfterQuestion: true }, orgId: ORG, status: "published" } } }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/activeAttempts/student1` }],
                    result: { value: { data: { testId: "t1" } } }
                }
            ]
        },
        {
            name: "testKeys: студент с попыткой другого теста — DENY",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/testKeys/t1`,
                method: "get"
            },
            resource: {
                data: { orgId: ORG, authorId: "teacher1" }
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: { value: { data: { settings: { showCorrectAfterQuestion: true }, orgId: ORG, status: "published" } } }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/activeAttempts/student1` }],
                    result: { value: { data: { testId: "t2" } } }
                }
            ]
        },
        {
            name: "testKeys: студент при выключенном showCorrectAfterQuestion — DENY",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/testKeys/t1`,
                method: "get"
            },
            resource: {
                data: { orgId: ORG, authorId: "teacher1" }
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: { value: { data: { settings: { showCorrectAfterQuestion: false }, orgId: ORG, status: "published" } } }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/activeAttempts/student1` }],
                    result: { value: { data: { testId: "t1" } } }
                }
            ]
        },
        {
            name: "testKeys: анонимный гость — DENY",
            expectation: "DENY",
            request: {
                auth: { uid: "guest1", token: { firebase: { sign_in_provider: "anonymous" } } },
                path: `${DB}/testKeys/t1`,
                method: "get"
            },
            resource: {
                data: { orgId: ORG, authorId: "teacher1" }
            },
            functionMocks: []
        },
        {
            name: "testKeys: преподаватель другой организации — DENY",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher2" },
                path: `${DB}/testKeys/t1`,
                method: "get"
            },
            resource: {
                data: { orgId: "other-org", authorId: "other-teacher" }
            },
            functionMocks: profileMocks("teacher2", "teacher")
        },
        {
            name: "Студент не читает версии теста",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/tests/t1/versions/2`,
                method: "get"
            },
            resource: {
                data: { authorId: "teacher1", orgId: ORG, status: "published" }
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: {
                        value: {
                            data: { authorId: "teacher1", orgId: ORG }
                        }
                    }
                }
            ]
        },
        {
            name: "Студент создаёт попытку на опубликованный тест",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/attempts/a-ok`,
                method: "create",
                resource: {
                    data: {
                        userId: "student1",
                        userEmail: "student1@example.com",
                        orgId: ORG,
                        testId: "t1",
                        testTitle: "Тест",
                        assignmentId: "",
                        answers: {},
                        status: "in_progress",
                        attemptNo: 1,
                        deadlineAt: null,
                        userName: "Test User",
                        groupId: "default-group"
                    }
                }
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: { value: true }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: {
                        value: {
                            data: { status: "published", orgId: ORG }
                        }
                    }
                }
            ]
        },
        {
            name: "Студент не создаёт попытку на неопубликованный тест",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/attempts/a-draft`,
                method: "create",
                resource: {
                    data: {
                        userId: "student1",
                        orgId: ORG,
                        testId: "t1",
                        assignmentId: "",
                        answers: {},
                        status: "in_progress",
                        userName: "Test User",
                        groupId: "default-group"
                    }
                }
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: { value: true }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: {
                        value: {
                            data: { status: "draft", orgId: ORG }
                        }
                    }
                }
            ]
        },
        {
            name: "Студент не создаёт попытку на просроченное задание",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/attempts/a-past`,
                method: "create",
                time: "2026-01-01T00:00:00Z",
                resource: {
                    data: {
                        userId: "student1",
                        orgId: ORG,
                        testId: "t1",
                        assignmentId: "past-assign",
                        answers: {},
                        status: "in_progress",
                        deadlineAt: null,
                        userName: "Test User",
                        groupId: "default-group"
                    }
                }
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: { value: true }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: {
                        value: {
                            data: { status: "published", orgId: ORG }
                        }
                    }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/assignments/past-assign` }],
                    result: { value: true }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/assignments/past-assign` }],
                    result: {
                        value: {
                            data: {
                                status: "active",
                                groupId: "default-group",
                                orgId: ORG,
                                deadline: "2025-01-01T00:00:00.000000001Z"
                            }
                        }
                    }
                }
            ]
        },
        {
            name: "Гость создаёт свою попытку на опубликованный тест",
            expectation: "ALLOW",
            request: {
                auth: { uid: "guest1", token: { firebase: { sign_in_provider: "anonymous" } } },
                path: `${DB}/attempts/a-guest`,
                method: "create",
                resource: {
                    data: {
                        userId: "guest1",
                        userEmail: "",
                        orgId: ORG,
                        testId: "t1",
                        testTitle: "Тест",
                        assignmentId: "",
                        answers: {},
                        startedAt: ISO,
                        status: "in_progress",
                        attemptNo: 1,
                        deadlineAt: null,
                        testVersion: 1,
                        userName: "Гость Петров",
                        guest: true,
                        testAuthorId: "teacher1",
                        createdAt: ISO,
                        updatedAt: ISO
                    }
                }
            },
            functionMocks: [
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/users/guest1` }],
                    result: { value: false }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: { value: true }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: {
                        value: { data: { status: "published", orgId: ORG } }
                    }
                }
            ]
        },
        {
            name: "Гость не создаёт попытку под чужим uid",
            expectation: "DENY",
            request: {
                auth: { uid: "guest1", token: { firebase: { sign_in_provider: "anonymous" } } },
                path: `${DB}/attempts/a-guest2`,
                method: "create",
                resource: {
                    data: {
                        userId: "student2",
                        userEmail: "",
                        orgId: ORG,
                        testId: "t1",
                        testTitle: "Тест",
                        assignmentId: "",
                        answers: {},
                        status: "in_progress",
                        attemptNo: 1,
                        deadlineAt: null,
                        testVersion: 1,
                        userName: "Гость Петров",
                        guest: true,
                        createdAt: ISO,
                        updatedAt: ISO
                    }
                }
            },
            functionMocks: [
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/users/guest1` }],
                    result: { value: false }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: { value: true }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: {
                        value: { data: { status: "published", orgId: ORG } }
                    }
                }
            ]
        },
        {
            name: "Гость не создаёт попытку на неопубликованный тест",
            expectation: "DENY",
            request: {
                auth: { uid: "guest1", token: { firebase: { sign_in_provider: "anonymous" } } },
                path: `${DB}/attempts/a-guest3`,
                method: "create",
                resource: {
                    data: {
                        userId: "guest1",
                        userEmail: "",
                        orgId: ORG,
                        testId: "t1",
                        testTitle: "Тест",
                        assignmentId: "",
                        answers: {},
                        status: "in_progress",
                        attemptNo: 1,
                        deadlineAt: null,
                        testVersion: 1,
                        userName: "Гость Петров",
                        guest: true,
                        createdAt: ISO,
                        updatedAt: ISO
                    }
                }
            },
            functionMocks: [
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/users/guest1` }],
                    result: { value: false }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: { value: true }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: {
                        value: { data: { status: "draft", orgId: ORG } }
                    }
                }
            ]
        },
        {
            name: "Гость не пишет оценку в свою попытку",
            expectation: "DENY",
            request: {
                auth: { uid: "guest1", token: { firebase: { sign_in_provider: "anonymous" } } },
                path: `${DB}/attempts/a-guest4`,
                method: "create",
                resource: {
                    data: {
                        userId: "guest1",
                        userEmail: "",
                        orgId: ORG,
                        testId: "t1",
                        testTitle: "Тест",
                        assignmentId: "",
                        answers: {},
                        status: "in_progress",
                        attemptNo: 1,
                        deadlineAt: null,
                        testVersion: 1,
                        userName: "Гость Петров",
                        guest: true,
                        score: 5,
                        total: 10,
                        percent: 50,
                        createdAt: ISO,
                        updatedAt: ISO
                    }
                }
            },
            functionMocks: [
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/users/guest1` }],
                    result: { value: false }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: { value: true }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: {
                        value: { data: { status: "published", orgId: ORG } }
                    }
                }
            ]
        },
        {
            name: "Гость не проходит тест через задание",
            expectation: "DENY",
            request: {
                auth: { uid: "guest1", token: { firebase: { sign_in_provider: "anonymous" } } },
                path: `${DB}/attempts/a-guest5`,
                method: "create",
                resource: {
                    data: {
                        userId: "guest1",
                        userEmail: "",
                        orgId: ORG,
                        testId: "t1",
                        testTitle: "Тест",
                        assignmentId: "a1",
                        answers: {},
                        status: "in_progress",
                        attemptNo: 1,
                        deadlineAt: null,
                        testVersion: 1,
                        userName: "Гость Петров",
                        guest: true,
                        createdAt: ISO,
                        updatedAt: ISO
                    }
                }
            },
            functionMocks: [
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/users/guest1` }],
                    result: { value: false }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: { value: true }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: {
                        value: { data: { status: "published", orgId: ORG } }
                    }
                }
            ]
        },
        {
            name: "Гость без ФИО не создаёт попытку",
            expectation: "DENY",
            request: {
                auth: { uid: "guest1", token: { firebase: { sign_in_provider: "anonymous" } } },
                path: `${DB}/attempts/a-guest6`,
                method: "create",
                resource: {
                    data: {
                        userId: "guest1",
                        userEmail: "",
                        orgId: ORG,
                        testId: "t1",
                        testTitle: "Тест",
                        assignmentId: "",
                        answers: {},
                        status: "in_progress",
                        attemptNo: 1,
                        deadlineAt: null,
                        testVersion: 1,
                        userName: "",
                        guest: true,
                        createdAt: ISO,
                        updatedAt: ISO
                    }
                }
            },
            functionMocks: [
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/users/guest1` }],
                    result: { value: false }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: { value: true }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: {
                        value: { data: { status: "published", orgId: ORG } }
                    }
                }
            ]
        },
        {
            name: "Гость не подменяет организацию попытки",
            expectation: "DENY",
            request: {
                auth: { uid: "guest1", token: { firebase: { sign_in_provider: "anonymous" } } },
                path: `${DB}/attempts/a-guest7`,
                method: "create",
                resource: {
                    data: {
                        userId: "guest1",
                        userEmail: "",
                        orgId: "other-org",
                        testId: "t1",
                        testTitle: "Тест",
                        assignmentId: "",
                        answers: {},
                        status: "in_progress",
                        attemptNo: 1,
                        deadlineAt: null,
                        testVersion: 1,
                        userName: "Гость Петров",
                        guest: true,
                        createdAt: ISO,
                        updatedAt: ISO
                    }
                }
            },
            functionMocks: [
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/users/guest1` }],
                    result: { value: false }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: { value: true }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: {
                        value: { data: { status: "published", orgId: ORG } }
                    }
                }
            ]
        },
        {
            name: "Гость создаёт маркер активной попытки",
            expectation: "ALLOW",
            request: {
                auth: { uid: "guest1", token: { firebase: { sign_in_provider: "anonymous" } } },
                path: `${DB}/activeAttempts/guest1`,
                method: "create",
                resource: {
                    data: { uid: "guest1", attemptId: "att-g1", testId: "t1", deadlineAt: null, startedAt: ISO }
                }
            },
            functionMocks: [
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/users/guest1` }],
                    result: { value: false }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: { value: true }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: {
                        value: { data: { status: "published", orgId: ORG } }
                    }
                },
                {
                    function: "existsAfter",
                    args: [{ exactValue: `${DB}/attempts/att-g1` }],
                    result: { value: true }
                },
                {
                    function: "getAfter",
                    args: [{ exactValue: `${DB}/attempts/att-g1` }],
                    result: {
                        value: { data: { userId: "guest1", status: "in_progress", guest: true } }
                    }
                }
            ]
        },
        {
            name: "Маркер гостя требует гостевую попытку из того же batch",
            expectation: "DENY",
            request: {
                auth: { uid: "guest1", token: { firebase: { sign_in_provider: "anonymous" } } },
                path: `${DB}/activeAttempts/guest1`,
                method: "create",
                resource: {
                    data: { uid: "guest1", attemptId: "att-g2", testId: "t1", deadlineAt: null, startedAt: ISO }
                }
            },
            functionMocks: [
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/users/guest1` }],
                    result: { value: false }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: { value: true }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: {
                        value: { data: { status: "published", orgId: ORG } }
                    }
                },
                {
                    function: "existsAfter",
                    args: [{ exactValue: `${DB}/attempts/att-g2` }],
                    result: { value: true }
                },
                {
                    function: "getAfter",
                    args: [{ exactValue: `${DB}/attempts/att-g2` }],
                    result: {
                        value: { data: { userId: "guest1", status: "in_progress" } }
                    }
                }
            ]
        },
        {
            name: "Гость не пишет маркер под чужим uid",
            expectation: "DENY",
            request: {
                auth: { uid: "guest1", token: { firebase: { sign_in_provider: "anonymous" } } },
                path: `${DB}/activeAttempts/student2`,
                method: "create",
                resource: {
                    data: { uid: "student2", attemptId: "att-g3", testId: "t1", deadlineAt: null, startedAt: ISO }
                }
            },
            functionMocks: [
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/users/guest1` }],
                    result: { value: false }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: { value: true }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: {
                        value: { data: { status: "published", orgId: ORG } }
                    }
                }
            ]
        },
        {
            name: "Комнаты: участник пишет ответ на текущий вопрос",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1/players/student1/answers/3`,
                method: "create",
                resource: {
                    data: { answer: "A", at: "2026-01-01T00:00:01Z" }
                },
                time: "2026-01-01T00:00:01Z"
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                ...roomMocks("3"),
                ...playerMock("student1", false)
            ]
        },
        {
            name: "Комнаты: ответ на не текущий вопрос — отказ",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1/players/student1/answers/2`,
                method: "create",
                resource: {
                    data: { answer: "A", at: "2026-01-01T00:00:01Z" }
                },
                time: "2026-01-01T00:00:01Z"
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                ...roomMocks("3"),
                ...playerMock("student1", false)
            ]
        },
        {
            name: "Комнаты: перезапись собственного ответа (update) — отказ",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1/players/student1/answers/3`,
                method: "update",
                requestResource: true
            },
            existingDoc: { answer: "A", at: "2026-01-01T00:00:01Z" },
            newDoc: { answer: "B", at: "2026-01-01T00:00:02Z" },
            functionMocks: [
                ...profileMocks("student1", "student"),
                ...roomMocks("3"),
                ...playerMock("student1", false)
            ]
        },
        {
            name: "Комнаты: наблюдатель не пишет ответ",
            expectation: "DENY",
            request: {
                auth: { uid: "student2" },
                path: `${DB}/rooms/r1/players/student2/answers/3`,
                method: "create",
                resource: {
                    data: { answer: "A", at: "2026-01-01T00:00:01Z" }
                },
                time: "2026-01-01T00:00:01Z"
            },
            functionMocks: [
                ...profileMocks("student2", "student"),
                ...roomMocks("3"),
                ...playerMock("student2", true)
            ]
        },
        {
            name: "Комнаты: at не равен request.time — отказ",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1/players/student1/answers/3`,
                method: "create",
                resource: {
                    data: { answer: "A", at: "2025-12-31T00:00:00Z" }
                },
                time: "2026-01-01T00:00:01Z"
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                ...roomMocks("3"),
                ...playerMock("student1", false)
            ]
        },
        {
            name: "Комнаты: студент читает комнату до входа (вход по коду)",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1`,
                method: "get"
            },
            resource: { data: { hostId: "teacher1", orgId: ORG, status: "active", code: "R1XK2M" } },
            functionMocks: [
                ...profileMocks("student1", "student"),
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/rooms/r1` }],
                    result: { value: { data: { hostId: "teacher1", orgId: ORG, status: "active" } } }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/rooms/r1/players/student1` }],
                    result: { value: false }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/rooms/r1/observers/student1` }],
                    result: { value: false }
                }
            ]
        },
        {
            name: "Комнаты: вошедший без профиля не читает комнату",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1`,
                method: "get"
            },
            resource: { data: { hostId: "teacher1", orgId: ORG, status: "active" } },
            functionMocks: [
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/users/student1` }],
                    result: { value: false }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/rooms/r1/players/student1` }],
                    result: { value: false }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/rooms/r1/observers/student1` }],
                    result: { value: false }
                }
            ]
        },
        {
            name: "Комнаты: анонимный гость читает комнату",
            expectation: "ALLOW",
            request: {
                auth: { uid: "guest1", token: { firebase: { sign_in_provider: "anonymous" } } },
                path: `${DB}/rooms/r1`,
                method: "get"
            },
            resource: { data: { hostId: "teacher1", orgId: ORG, status: "active", code: "R1XK2M" } },
            functionMocks: [
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/users/guest1` }],
                    result: { value: false }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/rooms/r1/players/guest1` }],
                    result: { value: false }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/rooms/r1/observers/guest1` }],
                    result: { value: false }
                }
            ]
        },
        {
            name: "players: участник комнаты читает список players (чужой документ)",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student2" },
                path: `${DB}/rooms/r1/players/student1`,
                method: "get"
            },
            resource: { data: { uid: "student1", playerId: "student1", name: "Player One", observer: false } },
            functionMocks: [
                ...profileMocks("student2", "student"),
                ...roomMocks("3"),
                ...playerMock("student2", false)
            ]
        },
        {
            name: "players: посторонний с профилем не читает чужой players",
            expectation: "DENY",
            request: {
                auth: { uid: "student3" },
                path: `${DB}/rooms/r1/players/student1`,
                method: "get"
            },
            resource: { data: { uid: "student1", playerId: "student1", name: "Player One", observer: false } },
            functionMocks: [
                ...profileMocks("student3", "student"),
                ...roomMocks("3"),
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/rooms/r1/players/student3` }],
                    result: { value: false }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/rooms/r1/observers/student3` }],
                    result: { value: false }
                }
            ]
        },
        {
            name: "players: повторный вход — участник обновляет свой документ",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1/players/student1`,
                method: "update",
                requestResource: true
            },
            resource: {
                data: { uid: "student1", playerId: "student1", name: "Иван", observer: false, joinedAt: "2026-01-01T00:00:00Z" }
            },
            newDoc: {
                uid: "student1", playerId: "student1", name: "Иван", observer: false,
                joinedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:05:00Z"
            },
            functionMocks: []
        },
        {
            name: "players: повторный вход гостя — меняет имя и аватар",
            expectation: "ALLOW",
            request: {
                auth: { uid: "guest1", token: { firebase: { sign_in_provider: "anonymous" } } },
                path: `${DB}/rooms/r1/players/guest1`,
                method: "update",
                requestResource: true
            },
            resource: {
                data: { uid: "guest1", playerId: "guest1", name: "Гость", avatar: "preset:cat", observer: false, joinedAt: "2026-01-01T00:00:00Z" }
            },
            newDoc: {
                uid: "guest1", playerId: "guest1", name: "Гость Петров", avatar: "preset:fox", observer: false,
                joinedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:05:00Z"
            },
            functionMocks: []
        },
        {
            name: "players: повторный вход не меняет роль (observer)",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1/players/student1`,
                method: "update",
                requestResource: true
            },
            resource: {
                data: { uid: "student1", playerId: "student1", name: "Иван", observer: false, joinedAt: "2026-01-01T00:00:00Z" }
            },
            newDoc: {
                uid: "student1", playerId: "student1", name: "Иван", observer: true,
                joinedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:05:00Z"
            },
            functionMocks: []
        },
        {
            name: "players: повторный вход не переписывает joinedAt",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1/players/student1`,
                method: "update",
                requestResource: true
            },
            resource: {
                data: { uid: "student1", playerId: "student1", name: "Иван", observer: false, joinedAt: "2026-01-01T00:00:00Z" }
            },
            newDoc: {
                uid: "student1", playerId: "student1", name: "Иван", observer: false,
                joinedAt: "2026-01-01T00:05:00Z", updatedAt: "2026-01-01T00:05:00Z"
            },
            functionMocks: []
        },
        {
            name: "players: чужой players-документ не обновляется",
            expectation: "DENY",
            request: {
                auth: { uid: "student2" },
                path: `${DB}/rooms/r1/players/student1`,
                method: "update",
                requestResource: true
            },
            resource: {
                data: { uid: "student1", playerId: "student1", name: "Иван", observer: false, joinedAt: "2026-01-01T00:00:00Z" }
            },
            newDoc: {
                uid: "student1", playerId: "student1", name: "Взлом", observer: false,
                joinedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:05:00Z"
            },
            functionMocks: []
        },
        {
            name: "players: повторный вход с пустым именем — отказ",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1/players/student1`,
                method: "update",
                requestResource: true
            },
            resource: {
                data: { uid: "student1", playerId: "student1", name: "Иван", observer: false, joinedAt: "2026-01-01T00:00:00Z" }
            },
            newDoc: {
                uid: "student1", playerId: "student1", name: "", observer: false,
                joinedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:05:00Z"
            },
            functionMocks: []
        },
        {
            name: "Реакции: участник пишет свой документ с пресетом",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1/reactions/student1`,
                method: "create",
                resource: {
                    data: { emoji: "🔥", at: "2026-01-01T00:00:01Z" }
                },
                time: "2026-01-01T00:00:01Z"
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                ...roomMocks("3")
            ]
        },
        {
            name: "Реакции: чужой документ не пишется",
            expectation: "DENY",
            request: {
                auth: { uid: "student2" },
                path: `${DB}/rooms/r1/reactions/student1`,
                method: "create",
                resource: {
                    data: { emoji: "🔥", at: "2026-01-01T00:00:01Z" }
                },
                time: "2026-01-01T00:00:01Z"
            },
            functionMocks: [
                ...profileMocks("student2", "student"),
                ...roomMocks("3")
            ]
        },
        {
            name: "Реакции: не из списка пресетов — отказ",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1/reactions/student1`,
                method: "create",
                resource: {
                    data: { emoji: "🐍", at: "2026-01-01T00:00:01Z" }
                },
                time: "2026-01-01T00:00:01Z"
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                ...roomMocks("3")
            ]
        },
        {
            name: "Реакции: чаще раза в секунду — отказ",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1/reactions/student1`,
                method: "update",
                requestResource: true,
                time: "2026-01-01T00:00:02Z"
            },
            existingDoc: { emoji: "👍", at: "2026-01-01T00:00:01.5Z" },
            newDoc: { emoji: "🔥", at: "2026-01-01T00:00:02Z" },
            functionMocks: [
                ...profileMocks("student1", "student"),
                ...roomMocks("3")
            ]
        },
        {
            name: "Реакции: через секунду — можно",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1/reactions/student1`,
                method: "update",
                requestResource: true,
                time: "2026-01-01T00:00:03Z"
            },
            existingDoc: { emoji: "👍", at: "2026-01-01T00:00:01Z" },
            newDoc: { emoji: "🔥", at: "2026-01-01T00:00:03Z" },
            functionMocks: [
                ...profileMocks("student1", "student"),
                ...roomMocks("3")
            ]
        },
        {
            name: "Аватары: пресет разрешён",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/publicProfiles/student1`,
                method: "update",
                requestResource: true
            },
            resource: { data: { displayName: "Student One", orgId: ORG } },
            newDoc: {
                displayName: "Student One",
                orgId: ORG,
                avatar: "preset:fox",
                updatedAt: ISO
            },
            functionMocks: profileMocks("student1", "student")
        },
        {
            name: "Аватары: загружаемый файл (base64) — отказ",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/publicProfiles/student1`,
                method: "update",
                requestResource: true
            },
            resource: { data: { displayName: "Student One", orgId: ORG } },
            newDoc: {
                displayName: "Student One",
                orgId: ORG,
                avatar: "data:image/png;base64,AAAA",
                updatedAt: ISO
            },
            functionMocks: profileMocks("student1", "student")
        },
        {
            name: "Комнаты: третий участник входит при свободной ёмкости",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student3" },
                path: `${DB}/rooms/r1/players/student3`,
                method: "create",
                resource: {
                    data: {
                        uid: "student3", playerId: "student3",
                        name: "Test User", observer: false,
                        joinedAt: ISO, updatedAt: ISO
                    }
                }
            },
            functionMocks: [
                ...profileMocks("student3", "student"),
                ...roomMocks("3", "opened", { playersCount: 2, maxPlayers: 97 })
            ]
        },
        {
            name: "Комнаты: вход в заполненную комнату — отказ",
            expectation: "DENY",
            request: {
                auth: { uid: "student3" },
                path: `${DB}/rooms/r1/players/student3`,
                method: "create",
                resource: {
                    data: {
                        uid: "student3", playerId: "student3",
                        name: "Test User", observer: false,
                        joinedAt: ISO, updatedAt: ISO
                    }
                }
            },
            functionMocks: [
                ...profileMocks("student3", "student"),
                ...roomMocks("3", "opened", { playersCount: 100, maxPlayers: 100 })
            ]
        },
        {
            name: "Комнаты: преподаватель-не-ведущий входит наблюдателем",
            expectation: "ALLOW",
            request: {
                auth: { uid: "teacher2" },
                path: `${DB}/rooms/r1/players/teacher2`,
                method: "create",
                resource: {
                    data: {
                        uid: "teacher2", playerId: "teacher2",
                        name: "Test User", observer: true,
                        joinedAt: ISO, updatedAt: ISO
                    }
                }
            },
            functionMocks: [
                ...profileMocks("teacher2", "teacher"),
                ...roomMocks("3")
            ]
        },
        {
            name: "Комнаты: преподаватель-не-ведущий не входит участником",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher2" },
                path: `${DB}/rooms/r1/players/teacher2`,
                method: "create",
                resource: {
                    data: {
                        uid: "teacher2", playerId: "teacher2",
                        name: "Test User", observer: false,
                        joinedAt: ISO, updatedAt: ISO
                    }
                }
            },
            functionMocks: [
                ...profileMocks("teacher2", "teacher"),
                ...roomMocks("3")
            ]
        },
        {
            name: "Комнаты: ведущий не меняет hostId (playersCount обновляется)",
            expectation: "ALLOW",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/rooms/r1`,
                method: "update",
                requestResource: true
            },
            resource: { data: { hostId: "teacher1", orgId: ORG, playersCount: 3 } },
            newDoc: { hostId: "teacher1", orgId: ORG, playersCount: 4 },
            functionMocks: [
                ...profileMocks("teacher1", "teacher"),
                ...roomMocks("3")
            ]
        },
        {
            name: "Комнаты: ведущий не может переписать hostId",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/rooms/r1`,
                method: "update",
                requestResource: true
            },
            resource: { data: { hostId: "teacher1", orgId: ORG } },
            newDoc: { hostId: "teacher2", orgId: ORG },
            functionMocks: [
                ...profileMocks("teacher1", "teacher"),
                ...roomMocks("3")
            ]
        },
        // Кейс «чужие players не читаются» (DENY) заменён на два кейса
        // нового контракта: участник комнаты читает список players,
        // посторонний с профилем — нет.
        {
            name: "Студент читает активное задание своей группы",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/assignments/a1`,
                method: "get"
            },
            resource: {
                data: {
                    teacherId: "teacher1",
                    groupId: "default-group",
                    orgId: ORG,
                    testId: "t1",
                    status: "active"
                }
            },
            functionMocks: profileMocks("student1", "student")
        },
        {
            name: "Материалы: сотрудник читает отсутствующий материал (книги нет)",
            expectation: "ALLOW",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/materials/t1`,
                method: "get"
            },
            resource: null,
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Материалы: преподаватель читает существующий материал своей организации",
            expectation: "ALLOW",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/materials/t1`,
                method: "get"
            },
            resource: { data: { orgId: ORG, authorId: "teacher1", pageCount: 3 } },
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Материалы: материал чужой организации по-прежнему закрыт",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/materials/t1`,
                method: "get"
            },
            resource: { data: { orgId: "other-org", authorId: "other-teacher", pageCount: 3 } },
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Материалы: существующий пустой документ без orgId — отказ",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/materials/t-empty`,
                method: "get"
            },
            resource: { data: {} },
            functionMocks: profileMocks("student1", "student")
        },
        {
            name: "Материалы: студент читает отсутствующий прогресс",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/materialProgress/student1_t1`,
                method: "get"
            },
            resource: null,
            functionMocks: profileMocks("student1", "student")
        },
        {
            name: "Материалы: студент читает материал до попытки",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/materials/t1`,
                method: "get"
            },
            resource: { data: { orgId: ORG, authorId: "teacher1", pageCount: 3 } },
            functionMocks: [
                ...profileMocks("student1", "student"),
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/activeAttempts/student1` }],
                    result: { value: false }
                }
            ]
        },
        {
            name: "Материалы: студент другой организации не читает материал",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/materials/t-other`,
                method: "get"
            },
            resource: { data: { orgId: "other-org", authorId: "other-teacher", pageCount: 3 } },
            functionMocks: [
                ...profileMocks("student1", "student"),
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/activeAttempts/student1` }],
                    result: { value: false }
                }
            ]
        },
        {
            name: "Материалы: студент с активной попыткой не читает материал",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/materials/t1`,
                method: "get"
            },
            resource: { data: { orgId: ORG, authorId: "teacher1", pageCount: 3 } },
            functionMocks: [
                ...profileMocks("student1", "student"),
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/activeAttempts/student1` }],
                    result: { value: true }
                }
            ]
        },
        {
            name: "Материалы: сотрудники читают даже с маркером студента",
            expectation: "ALLOW",
            request: {
                auth: { uid: "teacher2" },
                path: `${DB}/materials/t1/pages/0`,
                method: "get"
            },
            resource: { data: { blocks: [] } },
            functionMocks: [
                ...profileMocks("teacher2", "teacher"),
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/materials/t1` }],
                    result: { value: { data: { orgId: ORG, authorId: "teacher2", pageCount: 3 } } }
                }
            ]
        },
        {
            name: "Материалы: студент читает страницу без маркера",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/materials/t1/pages/0`,
                method: "get"
            },
            resource: { data: { blocks: [] } },
            functionMocks: [
                ...profileMocks("student1", "student"),
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/materials/t1` }],
                    result: { value: { data: { orgId: ORG, authorId: "teacher1", pageCount: 3 } } }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/activeAttempts/student1` }],
                    result: { value: false }
                }
            ]
        },
        {
            name: "Материалы: студент другой организации не читает страницу",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/materials/t1/pages/0`,
                method: "get"
            },
            resource: { data: { blocks: [] } },
            functionMocks: [
                ...profileMocks("student1", "student"),
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/materials/t1` }],
                    result: { value: { data: { orgId: "other-org", authorId: "other-teacher", pageCount: 3 } } }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/activeAttempts/student1` }],
                    result: { value: false }
                }
            ]
        },
        {
            name: "Материалы: студент пишет свой прогресс чтения",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/materialProgress/student1_t1`,
                method: "create",
                resource: {
                    data: {
                        uid: "student1", testId: "t1",
                        lastPage: 2, completed: true, updatedAt: ISO
                    }
                }
            },
            functionMocks: profileMocks("student1", "student")
        },
        {
            name: "Материалы: чужой прогресс не пишется",
            expectation: "DENY",
            request: {
                auth: { uid: "student2" },
                path: `${DB}/materialProgress/student1_t1`,
                method: "create",
                resource: {
                    data: {
                        uid: "student1", testId: "t1",
                        lastPage: 2, completed: true, updatedAt: ISO
                    }
                }
            },
            functionMocks: profileMocks("student2", "student")
        },
        {
            name: "Материалы: попытка по training без прочтения запрещена",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/attempts/att-t1`,
                method: "create",
                resource: {
                    data: attemptDoc()
                }
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/assignments/a1` }],
                    result: { value: true }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: { value: true }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: { value: { data: { status: "published", orgId: ORG } } }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/materialProgress/student1_t1` }],
                    result: { value: { data: { completed: false } } }
                }
            ]
        },
        {
            name: "Материалы: попытка по training после прочтения разрешена",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/attempts/att-t1`,
                method: "create",
                resource: {
                    data: attemptDoc()
                }
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/assignments/a1` }],
                    result: { value: true }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/assignments/a1` }],
                    result: {
                        value: {
                            data: { status: "active", groupId: "default-group", orgId: ORG, kind: "training", deadline: null }
                        }
                    }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: { value: true }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/tests/t1` }],
                    result: { value: { data: { status: "published", orgId: ORG } } }
                },
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/materialProgress/student1_t1` }],
                    result: { value: { data: { completed: true } } }
                }
            ]
        },
        {
            name: "Материалы: маркер снимается после отправки попытки",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/activeAttempts/student1`,
                method: "delete"
            },
            resource: {
                data: { uid: "student1", attemptId: "att-t2", testId: "t1", deadlineAt: null }
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                {
                    function: "getAfter",
                    args: [{ exactValue: `${DB}/attempts/att-t2` }],
                    result: { value: { data: { status: "submitted", userId: "student1" } } }
                }
            ]
        },
        {
            name: "Материалы: маркер не снимается, пока попытка в работе и срок не прошёл",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/activeAttempts/student1`,
                method: "delete"
            },
            resource: {
                data: { uid: "student1", attemptId: "att-t3", testId: "t1", deadlineAt: null }
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                {
                    function: "getAfter",
                    args: [{ exactValue: `${DB}/attempts/att-t3` }],
                    result: { value: { data: { status: "in_progress", userId: "student1" } } }
                }
            ]
        },
        {
            name: "Пользователь создаёт собственный студенческий профиль",
            expectation: "ALLOW",
            request: {
                auth: { uid: "student-new" },
                path: `${DB}/users/student-new`,
                method: "create",
                resource: {
                    data: userDoc("student-new", "student", ORG)
                }
            }
        },
        {
            name: "Регистрация с пустым именем запрещена",
            expectation: "DENY",
            request: {
                auth: { uid: "student-empty" },
                path: `${DB}/users/student-empty`,
                method: "create",
                resource: {
                    data: userDoc("student-empty", "student", ORG, {
                        fullName: "   "
                    })
                }
            }
        },
        // ---------- Live-комнаты: регрессия входа (Этап 4) ----------
        {
            name: "Комнаты: преподаватель своей организации создаёт комнату",
            expectation: "ALLOW",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/rooms/live-1`,
                method: "create",
                resource: {
                    data: {
                        orgId: ORG,
                        hostId: "teacher1",
                        testId: "t1",
                        testTitle: "Тест",
                        status: "active",
                        phase: "opened",
                        maxPlayers: 100,
                        playersCount: 0,
                        createdAt: ISO
                    }
                }
            },
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Комнаты: преподаватель не создаёт комнату с чужим orgId",
            expectation: "DENY",
            request: {
                auth: { uid: "teacher1" },
                path: `${DB}/rooms/live-2`,
                method: "create",
                resource: {
                    data: {
                        orgId: "other-org",
                        hostId: "teacher1",
                        testId: "t1",
                        status: "active",
                        maxPlayers: 100
                    }
                }
            },
            functionMocks: profileMocks("teacher1", "teacher")
        },
        {
            name: "Комнаты: студент другой организации не входит в комнату",
            expectation: "DENY",
            request: {
                auth: { uid: "student-out" },
                path: `${DB}/rooms/r1/players/student-out`,
                method: "create",
                resource: {
                    data: {
                        uid: "student-out", playerId: "student-out",
                        name: "Test User", observer: false,
                        joinedAt: ISO, updatedAt: ISO
                    }
                }
            },
            functionMocks: [
                ...profileMocks("student-out", "student", "other-org"),
                ...roomMocks("3")
            ]
        },
        {
            name: "Комнаты: студент не меняет настройки комнаты",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1`,
                method: "update",
                requestResource: true
            },
            resource: { data: { hostId: "teacher1", orgId: ORG, maxPlayers: 100 } },
            newDoc: { hostId: "teacher1", orgId: ORG, maxPlayers: 1 },
            functionMocks: [
                ...profileMocks("student1", "student"),
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/rooms/r1` }],
                    result: { value: { data: { hostId: "teacher1", orgId: ORG, maxPlayers: 100 } } }
                }
            ]
        },
        {
            name: "Комнаты: студент не пишет reveal (не управляет тестированием)",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1/reveals/3`,
                method: "create",
                resource: {
                    data: { qid: "3", reveal: { type: "single", correct: [1] }, points: 1 }
                }
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                ...roomMocks("3")
            ]
        },
        {
            name: "Комнаты: студент не пишет таблицу очков",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1/scores/student1`,
                method: "create",
                resource: {
                    data: { uid: "student1", name: "Test User", score: 999, max: 0, correctCount: 0 }
                }
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                ...roomMocks("3")
            ]
        },
        {
            name: "Комнаты: нельзя подменить UID другого участника",
            expectation: "DENY",
            request: {
                auth: { uid: "stranger" },
                path: `${DB}/rooms/r1/players/student1`,
                method: "create",
                resource: {
                    data: {
                        uid: "student1", playerId: "student1",
                        name: "Test User", observer: false,
                        joinedAt: ISO, updatedAt: ISO
                    }
                }
            },
            functionMocks: profileMocks("stranger", "student")
        },
        {
            name: "Комнаты: нельзя подменить playerId при входе",
            expectation: "DENY",
            request: {
                auth: { uid: "stranger" },
                path: `${DB}/rooms/r1/players/stranger`,
                method: "create",
                resource: {
                    data: {
                        uid: "student1", playerId: "stranger",
                        name: "Test User", observer: false,
                        joinedAt: ISO, updatedAt: ISO
                    }
                }
            },
            functionMocks: [
                ...profileMocks("stranger", "student"),
                ...roomMocks("3")
            ]
        },
        {
            name: "Комнаты: нельзя отправить ответ от имени другого пользователя",
            expectation: "DENY",
            request: {
                auth: { uid: "stranger" },
                path: `${DB}/rooms/r1/players/student1/answers/3`,
                method: "create",
                resource: { data: { answer: "A", at: "2026-01-01T00:00:01Z" } },
                time: "2026-01-01T00:00:01Z"
            },
            functionMocks: [
                ...profileMocks("stranger", "student"),
                ...roomMocks("3"),
                ...playerMock("student1", false)
            ]
        },
        {
            name: "Комнаты: закрытая комната не принимает новые подключения",
            expectation: "DENY",
            request: {
                auth: { uid: "student3" },
                path: `${DB}/rooms/r1/players/student3`,
                method: "create",
                resource: {
                    data: {
                        uid: "student3", playerId: "student3",
                        name: "Test User", observer: false,
                        joinedAt: ISO, updatedAt: ISO
                    }
                }
            },
            functionMocks: [
                ...profileMocks("student3", "student"),
                ...roomMocks("3", "opened", { status: "closed" })
            ]
        },
        {
            name: "Комнаты: завершённая комната не принимает подключения",
            expectation: "DENY",
            request: {
                auth: { uid: "student3" },
                path: `${DB}/rooms/r1/players/student3`,
                method: "create",
                resource: {
                    data: {
                        uid: "student3", playerId: "student3",
                        name: "Test User", observer: false,
                        joinedAt: ISO, updatedAt: ISO
                    }
                }
            },
            functionMocks: [
                ...profileMocks("student3", "student"),
                ...roomMocks("3", "opened", { status: "ended" })
            ]
        },
        {
            name: "Комнаты: гость не обновляет комнату (не ведущий, нет профиля)",
            expectation: "DENY",
            request: {
                auth: { uid: "guest1", token: { firebase: { sign_in_provider: "anonymous" } } },
                path: `${DB}/rooms/r1`,
                method: "update",
                requestResource: true
            },
            resource: { data: { hostId: "teacher1", orgId: ORG } },
            newDoc: { hostId: "guest1", orgId: ORG },
            functionMocks: [
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/users/guest1` }],
                    result: { value: false }
                }
            ]
        },
        {
            name: "Комнаты: гость не читает пользователей организации",
            expectation: "DENY",
            request: {
                auth: { uid: "guest1", token: { firebase: { sign_in_provider: "anonymous" } } },
                path: `${DB}/users/student1`,
                method: "get"
            },
            resource: { data: userDoc("student1", "student") },
            functionMocks: [
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/users/guest1` }],
                    result: { value: false }
                }
            ]
        }
        ,
        ...subjectCases(),
        ...liveAutoCases()
    ];
}

async function main() {
    const rules = readFileSync(
        join(ROOT, "firestore.rules"),
        "utf8"
    );

    const project = projectId();
    const token = await accessToken();
    const cases = testCases();

    const testSuite = cases.map((item) => {
        const request = { ...item.request };
        delete request.requestResource;
        const result = {
            expectation: item.expectation,
            request
        };

        if (item.request.requestResource && item.newDoc) {
            result.request.resource = { data: item.newDoc };
        }

        if (item.existingDoc) {
            result.resource = { data: item.existingDoc };
        }

        if (item.hasOwnProperty("resource")) {
            result.resource = item.resource;
        }

        if (item.functionMocks) {
            result.functionMocks = item.functionMocks;
        }

        return result;
    });

    const body = {
        source: {
            files: [
                {
                    name: "firestore.rules",
                    content: rules
                }
            ]
        },
        testSuite: {
            testCases: testSuite
        }
    };

    const response = await fetch(
        `https://firebaserules.googleapis.com/v1/projects/${project}:test`,
        {
            method: "POST",
            headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json"
            },
            body: JSON.stringify(body)
        }
    );

    const json = await response.json();

    if (!response.ok) {
        console.error(
            "Rules API:",
            response.status,
            JSON.stringify(json, null, 2)
        );
        process.exitCode = 1;
        return;
    }

    if (json.issues?.length) {
        for (const issue of json.issues) {
            console.error(
                `Проблема правил [${issue.severity || "UNKNOWN"}]:`,
                issue.description || JSON.stringify(issue)
            );
        }

        if (json.issues.some((issue) => issue.severity === "ERROR")) {
            process.exitCode = 1;
            return;
        }
    }

    const results = json.testResults || [];
    let failed = 0;

    console.log(`Проект: ${project}`);
    console.log(
        `Получено результатов API: ${results.length} из ${cases.length}\n`
    );

    results.forEach((result, index) => {
        const item = cases[index];

        if (!item) {
            console.log(
                `✖ Лишний результат API #${index + 1}:`,
                JSON.stringify(result)
            );
            failed++;
            return;
        }

        const debug = (result.debugMessages || []).join("; ");
        const passed = result.state === "SUCCESS";

        console.log(
            `${passed ? "✓" : "✖"} ${item.name}: ` +
            `ожидалось ${item.expectation}, ` +
            `состояние API: ${result.state ?? "не указано"}` +
            (debug ? ` — ${debug}` : "") +
            (result.error ? ` — error: ${result.error}` : "")
        );

        if (!passed) failed++;
    });

    if (results.length !== cases.length) {
        console.error(
            "\nКоличество результатов не совпадает с количеством тестов."
        );

        failed += Math.abs(cases.length - results.length);
    }

    console.log(
        `\nИтог: ${cases.length - failed}/${cases.length} тестов пройдено.`
    );

    if (failed) process.exitCode = 1;
}

main().catch((error) => {
    console.error("Ошибка запуска тестов:", error);
    process.exitCode = 1;
});
