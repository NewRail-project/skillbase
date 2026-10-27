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
        {
            name: "Комнаты: чужие players не читаются",
            expectation: "DENY",
            request: {
                auth: { uid: "student1" },
                path: `${DB}/rooms/r1/players/student2`,
                method: "get"
            },
            resource: {
                data: { playerId: "student2", observer: false }
            },
            functionMocks: [
                ...profileMocks("student1", "student"),
                {
                    function: "get",
                    args: [{ exactValue: `${DB}/rooms/r1` }],
                    result: {
                        value: {
                            data: {
                                hostId: "teacher1",
                                orgId: ORG,
                                status: "active",
                                phase: "opened",
                                currentQuestionId: "3"
                            }
                        }
                    }
                },
                {
                    function: "exists",
                    args: [{ exactValue: `${DB}/rooms/r1/players/student1` }],
                    result: { value: true }
                }
            ]
        },
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
        }
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

        if (item.resource) {
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
