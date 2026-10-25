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
            }
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
            }
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
        const result = {
            expectation: item.expectation,
            request: item.request
        };

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
            (debug ? ` — ${debug}` : "")
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
