// Статические проверки форм: кнопка отправки обязана быть внутри <form>.
//
// Регрессия: кнопка «Зарегистрироваться» после revert b7e11b6 оказалась
// СНАРУЖИ form — клик не отправлял форму, submit-обработчик не запускался,
// регистрация «молчала» без единого сообщения об ошибке.
//
// Тест не требует DOM: разворачиваем h("form", ...) до парной скобки
// (пропуская строки) и проверяем, что кнопка type=submit внутри.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Возвращает [начало, конец] вызова h(...), начиная с маркера, с учётом
// строковых литералов (кавычки и обратные кавычки со вложенными скобками).
function callSpan(source, marker) {
  const at = source.indexOf(marker);
  assert.ok(at !== -1, `не найден вызов: ${marker}`);
  const open = source.indexOf("(", at);
  let depth = 0;
  let quote = null;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return [at, i];
    }
  }
  throw new Error("не найдена закрывающая скобка вызова");
}

test("кнопка отправки внутри формы регистрации", () => {
  const source = readFileSync(
    join(ROOT, "ui/pages/register.js"),
    "utf8"
  );
  const [start, end] = callSpan(source, 'h("form", { id: "register-form"');
  const span = source.slice(start, end);
  assert.ok(
    span.includes('type: "submit"'),
    "кнопка type=submit должна быть внутри формы регистрации: кнопка вне form не отправляет форму, клик молчит"
  );
});

test("форма регистрации отключает нативную валидацию (как в login/profile)", () => {
  const source = readFileSync(
    join(ROOT, "ui/pages/register.js"),
    "utf8"
  );
  assert.ok(
    source.includes('h("form", { id: "register-form", novalidate: "novalidate" }'),
    "форма регистрации должна отключать нативную валидацию: ошибки показывает собственная проверка полей"
  );
});
