#!/usr/bin/env node
// Проверка firestore.rules через Firebase Rules API (projects.test).
//
// Не требует Java и Firestore Emulator: правила компилируются и выполняются
// на стороне Firebase с подставными auth/данными. Нужен только вход в CLI:
//   firebase login
//   npm run test:rules
//
// Источник правил — локальный firestore.rules, поэтому проверяется именно то,
// что будет задеплоено. Ничего не публикуется и не меняет данные проекта.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB = "/databases/(default)/documents";
const ORG = "default-org";
const ISO = "2026-01-01T00:00:00Z";

// Публичные client id/secret firebase-tools (используются для refresh token).
const CLI_CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLI_CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";

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
  const t = cfg.tokens || {};
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

// ---------- Помощники для тестовых данных ----------

function userDoc(uid, role, orgId = ORG, extra = {}) {
  return {
    uid,
    email: `${uid}@example.com`,
    role,
    orgId,
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

function mockTest(id, data) {
  return [
    { function: "exists", args: [{ exactValue: `${DB}/tests/${id}` }], result: { value: true } },
    { function: "get", args: [{ exactValue: `${DB}/tests/${id}` }], result: { value: { data } } }
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
    status: "draft",
    mode: "classic",
    settings: {},
    version: 1,
    questions: [{ id: "q1" }],
    createdAt: ISO,
    updatedAt: ISO,
    publishedAt: null,
    ...overrides
  };
}

function attemptDoc(overrides = {}) {
  return {
    userId: "student1",
    userEmail: "student1@example.com",
    orgId: ORG,
    testId: "t1",
    testTitle: "Тест",
    assignmentId: "",
    answers: {},
    startedAt: ISO,
    status: "in_progress",
    attemptNo: 1,
    deadlineAt: null,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides
  };
}

const auth = uid => ({ auth: { uid, token: {} }, method: "get", path: "", time: ISO });

function readCase(name, { uid, path, resource, mocks = [], expectation }) {
  return {
    name,
    expectation,
    request: { auth: uid ? { uid, token: {} } : null, method: "get", path: `${DB}/${path}`, time: ISO },
    resource: { data: resource },
    functionMocks: mocks
  };
}

function writeCase(name, { uid, method, path, before, after, mocks = [], expectation }) {
  const request = {
    auth: uid ? { uid, token: {} } : null,
    method,
    path: `${DB}/${path}`,
    time: ISO
  };
  // Для create/update request.resource — новое состояние документа.
  if (after !== undefined) request.resource = { data: after };
  return {
    name,
    expectation,
    request,
    ...(before !== undefined ? { resource: { data: before } } : {}),
    functionMocks: mocks
  };
}

// ---------- Набор тестов ----------

const cases = [
  // tests: чтение
  readCase("аноним не читает тест", {
    expectation: "DENY",
    path: "tests/t1",
    resource: testDoc({ status: "published" })
  }),
  readCase("ученик читает опубликованный тест своей организации", {
    expectation: "ALLOW",
    uid: "student1",
    path: "tests/t1",
    resource: testDoc({ status: "published" }),
    mocks: mockUser("student1", "student")
  }),
  readCase("ученик не читает черновик другого автора", {
    expectation: "DENY",
    uid: "student1",
    path: "tests/t1",
    resource: testDoc({ status: "draft" }),
    mocks: mockUser("student1", "student")
  }),
  readCase("преподаватель другой организации не читает чужой тест", {
    expectation: "DENY",
    uid: "teacher2",
    path: "tests/t1",
    resource: testDoc({ status: "published" }),
    mocks: mockUser("teacher2", "teacher", "other-org")
  }),
  readCase("администратор читает черновик другого автора", {
    expectation: "ALLOW",
    uid: "admin1",
    path: "tests/t1",
    resource: testDoc({ status: "draft" }),
    mocks: mockUser("admin1", "admin")
  }),

  // testKeys
  readCase("ученик не читает правильные ответы", {
    expectation: "DENY",
    uid: "student1",
    path: "testKeys/t1",
    resource: { authorId: "teacher1", orgId: ORG, items: {}, version: 1 },
    mocks: mockUser("student1", "student")
  }),
  readCase("преподаватель читает ключи своей организации", {
    expectation: "ALLOW",
    uid: "teacher1",
    path: "testKeys/t1",
    resource: { authorId: "teacher1", orgId: ORG, items: {}, version: 1 },
    mocks: mockUser("teacher1", "teacher")
  }),
  readCase("преподаватель другой организации не читает ключи", {
    expectation: "DENY",
    uid: "teacher2",
    path: "testKeys/t1",
    resource: { authorId: "teacher1", orgId: ORG, items: {}, version: 1 },
    mocks: mockUser("teacher2", "teacher", "other-org")
  }),

  // tests: создание и изменение
  writeCase("преподаватель создаёт черновик", {
    expectation: "ALLOW",
    uid: "teacher1",
    method: "create",
    path: "tests/t1",
    after: testDoc(),
    mocks: mockUser("teacher1", "teacher")
  }),
  writeCase("создать тест сразу опубликованным нельзя", {
    expectation: "DENY",
    uid: "teacher1",
    method: "create",
    path: "tests/t1",
    after: testDoc({ status: "published", publishedAt: ISO }),
    mocks: mockUser("teacher1", "teacher")
  }),
  writeCase("нельзя создать тест без вопросов", {
    expectation: "DENY",
    uid: "teacher1",
    method: "create",
    path: "tests/t1",
    after: testDoc({ questions: [] }),
    mocks: mockUser("teacher1", "teacher")
  }),
  writeCase("нельзя создать тест от чужого имени", {
    expectation: "DENY",
    uid: "teacher1",
    method: "create",
    path: "tests/t1",
    after: testDoc({ authorId: "teacher2" }),
    mocks: mockUser("teacher1", "teacher")
  }),
  writeCase("ученик не создаёт тест", {
    expectation: "DENY",
    uid: "student1",
    method: "create",
    path: "tests/t1",
    after: testDoc(),
    mocks: mockUser("student1", "student")
  }),
  writeCase("автор публикует свой тест", {
    expectation: "ALLOW",
    uid: "teacher1",
    method: "update",
    path: "tests/t1",
    before: testDoc(),
    after: testDoc({ status: "published", publishedAt: ISO }),
    mocks: mockUser("teacher1", "teacher")
  }),
  writeCase("ученик не меняет тест", {
    expectation: "DENY",
    uid: "student1",
    method: "update",
    path: "tests/t1",
    before: testDoc(),
    after: testDoc({ title: "Взлом" }),
    mocks: mockUser("student1", "student")
  }),
  writeCase("нельзя сменить автора теста", {
    expectation: "DENY",
    uid: "teacher1",
    method: "update",
    path: "tests/t1",
    before: testDoc(),
    after: testDoc({ authorId: "teacher2" }),
    mocks: mockUser("teacher1", "teacher")
  }),

  // attempts: создание
  writeCase("ученик начинает попытку", {
    expectation: "ALLOW",
    uid: "student1",
    method: "create",
    path: "attempts/a1",
    after: attemptDoc(),
    mocks: [...mockUser("student1", "student"), ...mockTest("t1", testDoc({ status: "published" }))]
  }),
  writeCase("ученик не пишет себе оценку при старте", {
    expectation: "DENY",
    uid: "student1",
    method: "create",
    path: "attempts/a1",
    after: attemptDoc({ score: 5, total: 5, percent: 100 }),
    mocks: [...mockUser("student1", "student"), ...mockTest("t1", testDoc({ status: "published" }))]
  }),
  writeCase("нельзя начать попытку по черновику", {
    expectation: "DENY",
    uid: "student1",
    method: "create",
    path: "attempts/a1",
    after: attemptDoc(),
    mocks: [...mockUser("student1", "student"), ...mockTest("t1", testDoc({ status: "draft" }))]
  }),
  writeCase("нельзя начать попытку за другого ученика", {
    expectation: "DENY",
    uid: "student1",
    method: "create",
    path: "attempts/a1",
    after: attemptDoc({ userId: "student2" }),
    mocks: [...mockUser("student1", "student"), ...mockTest("t1", testDoc({ status: "published" }))]
  }),

  // attempts: изменение учеником
  writeCase("ученик сохраняет ответы", {
    expectation: "ALLOW",
    uid: "student1",
    method: "update",
    path: "attempts/a1",
    before: attemptDoc(),
    after: attemptDoc({ answers: { 0: "A" }, updatedAt: ISO }),
    mocks: mockUser("student1", "student")
  }),
  writeCase("ученик отправляет попытку", {
    expectation: "ALLOW",
    uid: "student1",
    method: "update",
    path: "attempts/a1",
    before: attemptDoc(),
    after: attemptDoc({
      answers: { 0: "A" },
      status: "submitted",
      submittedAt: ISO,
      finishedAt: ISO,
      updatedAt: ISO
    }),
    mocks: mockUser("student1", "student")
  }),
  writeCase("ученик не выставляет оценку", {
    expectation: "DENY",
    uid: "student1",
    method: "update",
    path: "attempts/a1",
    before: attemptDoc({ status: "submitted", submittedAt: ISO, finishedAt: ISO }),
    after: attemptDoc({
      status: "graded",
      submittedAt: ISO,
      finishedAt: ISO,
      score: 5,
      total: 5,
      percent: 100,
      review: {},
      gradedBy: "student1",
      gradedAt: ISO,
      updatedAt: ISO
    }),
    mocks: mockUser("student1", "student")
  }),
  writeCase("ученик не меняет чужую попытку", {
    expectation: "DENY",
    uid: "student1",
    method: "update",
    path: "attempts/a1",
    before: attemptDoc({ userId: "student2" }),
    after: attemptDoc({ userId: "student2", answers: { 0: "B" } }),
    mocks: mockUser("student1", "student")
  }),
  writeCase("нельзя изменить уже отправленную попытку", {
    expectation: "DENY",
    uid: "student1",
    method: "update",
    path: "attempts/a1",
    before: attemptDoc({ status: "submitted", submittedAt: ISO, finishedAt: ISO }),
    after: attemptDoc({ status: "submitted", submittedAt: ISO, finishedAt: ISO, answers: { 0: "B" } }),
    mocks: mockUser("student1", "student")
  }),

  // attempts: чтение и проверка
  readCase("ученик читает свою попытку", {
    expectation: "ALLOW",
    uid: "student1",
    path: "attempts/a1",
    resource: attemptDoc(),
    mocks: mockUser("student1", "student")
  }),
  readCase("ученик не читает чужую попытку", {
    expectation: "DENY",
    uid: "student1",
    path: "attempts/a1",
    resource: attemptDoc({ userId: "student2" }),
    mocks: mockUser("student1", "student")
  }),
  readCase("преподаватель читает попытку своей организации", {
    expectation: "ALLOW",
    uid: "teacher1",
    path: "attempts/a1",
    resource: attemptDoc({ status: "submitted" }),
    mocks: mockUser("teacher1", "teacher")
  }),
  writeCase("преподаватель проверяет попытку", {
    expectation: "ALLOW",
    uid: "teacher1",
    method: "update",
    path: "attempts/a1",
    before: attemptDoc({ status: "submitted", submittedAt: ISO, finishedAt: ISO }),
    after: attemptDoc({
      status: "graded",
      submittedAt: ISO,
      finishedAt: ISO,
      score: 3,
      total: 5,
      percent: 60,
      review: {},
      gradedBy: "teacher1",
      gradedAt: ISO,
      updatedAt: ISO
    }),
    mocks: mockUser("teacher1", "teacher")
  }),
  writeCase("преподаватель другой организации не проверяет", {
    expectation: "DENY",
    uid: "teacher2",
    method: "update",
    path: "attempts/a1",
    before: attemptDoc({ status: "submitted", submittedAt: ISO, finishedAt: ISO }),
    after: attemptDoc({
      status: "graded",
      submittedAt: ISO,
      finishedAt: ISO,
      score: 3,
      total: 5,
      percent: 60,
      review: {},
      gradedBy: "teacher2",
      gradedAt: ISO,
      updatedAt: ISO
    }),
    mocks: mockUser("teacher2", "teacher", "other-org")
  }),
  writeCase("нельзя выставить балл больше максимума", {
    expectation: "DENY",
    uid: "teacher1",
    method: "update",
    path: "attempts/a1",
    before: attemptDoc({ status: "submitted", submittedAt: ISO, finishedAt: ISO }),
    after: attemptDoc({
      status: "graded",
      submittedAt: ISO,
      finishedAt: ISO,
      score: 6,
      total: 5,
      percent: 100,
      review: {},
      gradedBy: "teacher1",
      gradedAt: ISO,
      updatedAt: ISO
    }),
    mocks: mockUser("teacher1", "teacher")
  }),

  // assignments
  writeCase("преподаватель назначает опубликованный тест", {
    expectation: "ALLOW",
    uid: "teacher1",
    method: "create",
    path: "assignments/as1",
    after: {
      testId: "t1",
      testTitle: "Тест",
      teacherId: "teacher1",
      groupId: "g1",
      orgId: ORG,
      deadline: null,
      attemptsLimit: 3,
      status: "active",
      createdAt: ISO,
      updatedAt: ISO
    },
    mocks: [...mockUser("teacher1", "teacher"), ...mockTest("t1", testDoc({ status: "published" }))]
  }),
  writeCase("ученик не создаёт назначение", {
    expectation: "DENY",
    uid: "student1",
    method: "create",
    path: "assignments/as1",
    after: {
      testId: "t1",
      testTitle: "Тест",
      teacherId: "student1",
      groupId: "g1",
      orgId: ORG,
      deadline: null,
      attemptsLimit: 3,
      status: "active",
      createdAt: ISO,
      updatedAt: ISO
    },
    mocks: [...mockUser("student1", "student"), ...mockTest("t1", testDoc({ status: "published" }))]
  }),
  readCase("ученик читает назначение своей группы", {
    expectation: "ALLOW",
    uid: "student1",
    path: "assignments/as1",
    resource: { testId: "t1", teacherId: "teacher1", groupId: "g1", orgId: ORG, status: "active" },
    mocks: mockUser("student1", "student", ORG, { groupId: "g1" })
  }),
  readCase("ученик не читает назначение другой группы", {
    expectation: "DENY",
    uid: "student1",
    path: "assignments/as1",
    resource: { testId: "t1", teacherId: "teacher1", groupId: "g2", orgId: ORG, status: "active" },
    mocks: mockUser("student1", "student", ORG, { groupId: "g1" })
  }),

  // users
  writeCase("пользователь меняет своё ФИО", {
    expectation: "ALLOW",
    uid: "student1",
    method: "update",
    path: "users/student1",
    before: userDoc("student1", "student"),
    after: userDoc("student1", "student", ORG, { fullName: "Иван Иванов" }),
    mocks: mockUser("student1", "student")
  }),
  writeCase("пользователь не меняет себе роль", {
    expectation: "DENY",
    uid: "student1",
    method: "update",
    path: "users/student1",
    before: userDoc("student1", "student"),
    after: userDoc("student1", "teacher"),
    mocks: mockUser("student1", "student")
  }),
  writeCase("администратор меняет роль в своей организации", {
    expectation: "ALLOW",
    uid: "admin1",
    method: "update",
    path: "users/student1",
    before: userDoc("student1", "student"),
    after: userDoc("student1", "teacher", ORG, { updatedAt: ISO }),
    mocks: mockUser("admin1", "admin")
  }),
  writeCase("администратор другой организации не меняет роль", {
    expectation: "DENY",
    uid: "admin2",
    method: "update",
    path: "users/student1",
    before: userDoc("student1", "student"),
    after: userDoc("student1", "teacher", ORG, { updatedAt: ISO }),
    mocks: mockUser("admin2", "admin", "other-org")
  }),
  writeCase("администратор не меняет свою роль", {
    expectation: "DENY",
    uid: "admin1",
    method: "update",
    path: "users/admin1",
    before: userDoc("admin1", "admin"),
    after: userDoc("admin1", "student"),
    mocks: mockUser("admin1", "admin")
  }),

  // publicProfiles
  writeCase("пользователь создаёт публичный профиль", {
    expectation: "ALLOW",
    uid: "student1",
    method: "create",
    path: "publicProfiles/student1",
    after: { displayName: "Иван Иванов", orgId: ORG, updatedAt: ISO },
    mocks: mockUser("student1", "student")
  }),
  writeCase("нельзя записать аватар не-картинкой", {
    expectation: "DENY",
    uid: "student1",
    method: "create",
    path: "publicProfiles/student1",
    after: { displayName: "Иван", avatar: "javascript:alert(1)", orgId: ORG, updatedAt: ISO },
    mocks: mockUser("student1", "student")
  }),
  readCase("коллега читает публичный профиль организации", {
    expectation: "ALLOW",
    uid: "student2",
    path: "publicProfiles/student1",
    resource: { displayName: "Иван", orgId: ORG, updatedAt: ISO },
    mocks: mockUser("student2", "student")
  }),
  readCase("чужая организация не читает публичный профиль", {
    expectation: "DENY",
    uid: "student3",
    path: "publicProfiles/student1",
    resource: { displayName: "Иван", orgId: ORG, updatedAt: ISO },
    mocks: mockUser("student3", "student", "other-org")
  })
];

// ---------- Запуск ----------

async function main() {
  const rules = readFileSync(join(ROOT, "firestore.rules"), "utf8");
  const token = await accessToken();
  const project = projectId();

  const body = {
    source: { files: [{ name: "firestore.rules", content: rules }] },
    testSuite: {
      testCases: cases.map(c => ({
        expectation: c.expectation,
        request: c.request,
        ...(c.resource ? { resource: c.resource } : {}),
        ...(c.functionMocks?.length ? { functionMocks: c.functionMocks } : {})
      }))
    }
  };

  const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${project}:test`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json();

  if (!res.ok) {
    console.error("Rules API:", res.status, json.error?.message || JSON.stringify(json).slice(0, 500));
    process.exit(1);
  }

  const errors = (json.issues || []).filter(i => i.severity === "ERROR");
  if (errors.length) {
    for (const e of errors) console.error(`Ошибка правил: ${e.description}`);
    process.exit(1);
  }

  let failed = 0;
  const noisy = [];
  (json.testResults || []).forEach((r, i) => {
    const c = cases[i];
    const dbg = (r.debugMessages || []).join("; ");
    // DENY из-за ошибки вычисления — не то же самое, что осознанный запрет.
    if (dbg) noisy.push(`${c.name} — ${dbg}`);
    if (r.state === "SUCCESS") return;
    failed++;
    console.log(`✖ ${c.name} — ожидалось ${c.expectation}${dbg ? ` (${dbg})` : ""}`);
  });

  for (const line of noisy) console.log(`⚠ ошибка вычисления: ${line}`);

  console.log(`\nПравила: ${cases.length} тестов, ${cases.length - failed} прошло, ${failed} упало`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
