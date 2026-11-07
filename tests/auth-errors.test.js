import test from "node:test";
import assert from "node:assert/strict";
import { authErrorMessage } from "../shared/errors.js";

test("invalid-credential подсказывает про Google и сброс пароля", () => {
  const m = authErrorMessage({ code: "auth/invalid-credential" });
  assert.match(m, /Google/);
  assert.match(m, /Забыли пароль/);
});

test("новые коды ошибок входа понятны", () => {
  assert.match(authErrorMessage({ code: "auth/missing-email" }), /почт/i);
  assert.match(authErrorMessage({ code: "auth/user-disabled" }), /отключ/i);
});
