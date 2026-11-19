// Хуки загрузки модулей Node: подменяют ТОЛЬКО слой доступа к Firebase
// (auth/attempts/subjects/admins/assign) заглушками из tests/helpers/stubs.
// Логика страницы, analytics-logic, charts, dom, access — настоящие.
const STUBS = {
  "/core/auth.js": "auth.js",
  "/core/attempts.js": "attempts.js",
  "/core/subjects.js": "subjects.js",
  "/core/admins.js": "admins.js",
  "/core/assign.js": "assign.js",
  "/core/material-library.js": "material-library.js",
  "/core/materials.js": "materials.js",
  "/core/editor.js": "editor.js",
  "/core/rooms.js": "rooms.js",
  "/shared/firebase.js": "firebase.js"
};

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (resolved.url.includes("/tests/helpers/")) return resolved;
  for (const [suffix, stub] of Object.entries(STUBS)) {
    if (resolved.url.endsWith(suffix) && !resolved.url.includes("skillbase-master")) {
      return { ...resolved, url: new URL(`./stubs/${stub}`, import.meta.url).href };
    }
  }
  return resolved;
}
