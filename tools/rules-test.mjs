#!/usr/bin/env node
// Проверка firestore.rules через Firebase Rules API (projects.test).

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const DB = "/databases/(default)/documents"
const ORG = "default-org"
const ISO = "2026-01-01T00:00:00Z"

// Публичные client id/secret firebase-tools
const CLI_CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com"
const CLI_CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi"

function configPath() {
    if (process.env.FIREBASE_CONFIGSTORE) return process.env.FIREBASE_CONFIGSTORE;
    if (process.platform === "win32" && process.env.APPDATA) {
        return join(process.env.APPDATA, "configstore", "firebase-tools.json");
    }
    return join(homedir(), ".config", "configstore", "firebase-tools.json");
}

async function accessToken() {
    if (process.env.FIREBASE_ACCESS_TOKEN) return process.env.FIREBASE_ACCESS_TOKEN;

    let cfg;
    try {
        cfg = JSON.parse(readFileSync(configPath(), "utf8"));
    } catch {
        throw new Error("Не найден вход Firebase CLI. Выполните: firebase login");
    }
    const t = cfg.tokens || {}
    if (t.access_token && t.expires_at > Date.now() + 60_000) return t.access_token;
    if (!t.refresh_token) throw new Error("Нет refresh token. Выполните: firebase login");

    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: CLI_CLIENT_ID,
            client_secret: CLI_CLIENT_SECRET,
            refresh_token: t.refresh_token,
            grant_type: "refresh_token"
        })
    });
    const json = await res.json();
    if (!json.access_token) throw new Error("Не удалось обновить токен. Выполните: firebase login");
    return json.access_token;
}

function projectId() {
    if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
    try {
        const rc = JSON.parse(readFileSync(join(ROOT, ".firebaserc"), "utf8"));
        if (rc.projects?.default) return rc.projects.default;
    } catch {} 
    throw new Error("Не найден project id: укажите GCLOUD_PROJECT или .firebaserc");
}

function userDoc(uid, role, orgId = ORG, extra = {}) {
    return {
        uid,
        email: `${uid}@example.com`,
        role,
        orgId: orgId || ORG,
        groupId: extra.groupId || (orgId === "default-org" ? "default-group" : ""),
        fullName: extra.fullName || "",
        ui: "education",
        createdAt: ISO,
        ...extra
    };
}

function mockUser(uid, role, orgId = ORG, extra = {}) {
    const data = userDoc(uid, role, orgId, extra);
    return [
        { function: "exists", args: [{ exactValue: `${DB}/users/${uid}` }], result: { value: true } },
        { function: "get", args: [{ exactValue: `${DB}/users/${uid}` }], result: { value: { data } } }
    ];
}

function testDoc(overrides = {}) {
    return {
        id: "t1",
        title: "Тест",
        description: "",
        instructions: "",
        category: "",
        color: "",
        authorId: "teacher1",
        orgId: ORG,
        status: "published",
        mode: "classic",
        settings: { timePerQuestion: null, totalTime: null, passScore: null, shuffleQuestions: true, shuffleOptions: true, attemptsLimit: 3 },
        version: 1,
        questions: [{ id: "q1" }],
        createdAt: ISO,
        updatedAt: ISO,
        publishedAt: ISO,
        ...overrides
    };
}

function mockTest(id, data) {
    return [
        { function: "exists", args: [{ exactValue: `${DB}/tests/${id}` }], result: { value: true } },
        { function: "get", args: [{ exactValue: `${DB}/tests/${id}` }], result: { value: { data } } }
    ];
}

const cases = [
    // users: чтение
    {
        name: "ученик читает свой профиль",
        expectation: "ALLOW",
        request: {
            auth: { uid: "student1", token: { orgId: ORG } },
            method: "get",
            path: `${DB}/users/student1`,
            time: ISO
        },
        resource: { data: userDoc("student1", "student", ORG) }
    },
    
    // publicProfiles: чтение
    {
        name: "коллега читает публичный профиль организации",
        expectation: "ALLOW",
        request: {
            auth: { uid: "student2", token: { orgId: ORG } },
            method: "get",
            path: `${DB}/publicProfiles/student1`,
            time: ISO
        },
        resource: { data: { displayName: "Иван Иванов", orgId: ORG, updatedAt: ISO } }
    },
    
    // tests: чтение
    {
        name: "ученик читает опубликованный тест своей организации",
        expectation: "ALLOW",
        request: {
            auth: { uid: "student1", token: { orgId: ORG } },
            method: "get",
            path: `${DB}/tests/t1`,
            time: ISO
        },
        resource: { data: testDoc({ status: "published" }) }
    },
    
    // testKeys: чтение
    {
        name: "преподаватель читает ключи своей организации",
        expectation: "ALLOW",
        request: {
            auth: { uid: "teacher1", token: { orgId: ORG } },
            method: "get",
            path: `${DB}/testKeys/t1`,
            time: ISO
        },
        resource: { data: { authorId: "teacher1", orgId: ORG, items: {}, version: 1 } }
    },
    
    // assignments: чтение
    {
        name: "ученик читает активное назначение своей группы",
        expectation: "ALLOW",
        request: {
            auth: { uid: "student1", token: { orgId: ORG, groupId: "default-group" } },
            method: "get",
            path: `${DB}/assignments/as1`,
            time: ISO
        },
        resource: { data: {
            testId: "t1",
            teacherId: "teacher1",
            groupId: "default-group",
            orgId: ORG,
            status: "active"
        } }
    },
    
    // users: создание
    {
        name: "ученик регистрируется с организацией",
        expectation: "ALLOW",
        request: {
            auth: { uid: "newbie", token: { orgId: ORG } },
            method: "create",
            path: `${DB}/users/newbie`,
            time: ISO
        },
        resource: {
            data: {
                email: "newbie@example.com",
                role: "student",
                orgId: ORG,
                groupId: "default-group",
                fullName: "Новый Пользователь",
                ui: "education",
                createdAt: ISO
            }
        }
    },
    
    // users: создание (отрицательный тест)
    {
        name: "регистрация без ФИО отклоняется",
        expectation: "DENY",
        request: {
            auth: { uid: "newbie", token: { orgId: ORG } },
            method: "create",
            path: `${DB}/users/newbie`,
            time: ISO
        },
        resource: {
            data: {
                email: "newbie@example.com",
                role: "student",
                orgId: ORG,
                groupId: "default-group",
                fullName: "   ",
                ui: "education",
                createdAt: ISO
            }
        }
    }
];

// Формирование тестового тела
const testSuite = cases.map(caseObj => {
    const request = caseObj.request;
    const resource = caseObj.resource ? { resource: { data: caseObj.resource.data } } : null;
    return {
        expectation: caseObj.expectation,
        request,
        ...(resource && { resource })
    };
});

export async function main() {
    const rules = readFileSync(join(ROOT, "firestore.rules"), "utf8");
    const token = await accessToken();
    const project = projectId();

    const body = {
        source: { files: [{ name: "firestore.rules", content: rules }] },
        testSuite: {
            testCases: testSuite
        }
    };

    const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${project}:test`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        console.error("Rules API:", res.status, await res.text());
        process.exit(1);
    }

    const json = await res.json();

    if (json.issues && json.issues.length > 0) {
        const errors = json.issues.filter(i => i.severity === "ERROR");
        if (errors.length) {
            for (const e of errors) console.error(`Ошибка правил: ${e.description}`);
            process.exit(1);
        }
    }

    let failed = 0;
    const noisy = [];
    (json.testResults || []).forEach((r, i) => {
        const c = cases[i];
        const dbg = (r.debugMessages || []).join(";");
        if (dbg) noisy.push(`${c.name} — ${dbg}`);
        if (r.state === "SUCCESS") return;
        failed++;
        console.log(`✖ ${c.name} — ожидалось ${c.expectation}${dbg ? ` (${dbg})` : ''}`);
    });

    for (const line of noisy) console.log(`⚠ ошибка вычисления: ${line}`);

    console.log(`\nПравила: ${cases.length} тестов, ${cases.length - failed} прошло, ${failed} упало`);
    process.exit(failed ? 1 : 0);
}