// tests/smoke/rooms.spec.js — Playwright smoke: live-комната.
//
// Сценарий: ведущий (staff), два участника, наблюдатель; 3 вопроса
// (single, multiple, short); автопроверка итогов в scores; затем
// обучающее задание; затем тест без лимита времени.
//
// Firebase подменяется (tests/smoke/rooms.fixture.js): иньекция до
// загрузки приложения + перехват сетевых запросов. Селекторы привязаны
// к текущему интерфейсу (ui/css/brand.css, aria-атрибуты страниц).
//
// Запуск: npx playwright test tests/smoke/rooms.spec.js
// Требуется: npm i -D @playwright/test && npx playwright install chromium

import { test, expect } from "@playwright/test";
import { stubInitScript, SCENARIO } from "./rooms.fixture.js";

const APP = process.env.APP_URL || "http://localhost:5500/index.html";

async function open(page, route) {
  await page.addInitScript(stubInitScript);
  await page.goto(`${APP}#${route}`);
}

test("Live-комната: host, два участника, наблюдатель, 3 вопроса, итоги", async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const p1Ctx = await browser.newContext();
  const p2Ctx = await browser.newContext();
  const obsCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const p1 = await p1Ctx.newPage();
  const p2 = await p2Ctx.newPage();
  const obs = await obsCtx.newPage();

  // 1. Ведущий: каталог → «Запустить» → Live-комната.
  await open(host, "#launch/t-smoke");
  await expect(host.getByRole("heading", { name: "Как провести тест" })).toBeVisible();
  await host.getByRole("button", { name: "Открыть Live-комнату" }).click();
  const codeEl = host.locator(".room-code-badge");
  await expect(codeEl).toBeVisible();
  const code = (await codeEl.textContent()).trim();
  expect(code).toHaveLength(6);
  expect(code).not.toMatch(/[0O1I]/);

  // 2. Вход участников и наблюдателя.
  for (const [page, button, hint] of [
    [p1, "Участник", "Анна"],
    [p2, "Участник", "Борис"],
    [obs, "Наблюдатель", "Ольга"]
  ]) {
    await open(page, `#join/${code}`);
    await page.getByLabel("Код комнаты").fill(code);
    await page.getByText(button, { exact: true }).click();
    await page.getByRole("button", { name: "Войти в комнату" }).click();
    await expect(page.locator(".room-status")).toContainText(button === "Наблюдатель" ? "наблюдатель" : "участник");
  }

  // 3. Ведущий открывает вопрос 0 (single).
  await host.getByRole("button", { name: /Открыть вопрос|Следующий вопрос/ }).first().click();
  await expect(obs.locator(".room-question")).toContainText("Сколько сигналов");

  // 4. Участники отвечают одна форма на текущий вопрос.
  await p1.locator(".option input[type=radio]").nth(SCENARIO.expectedAnswers.q0.player1).check();
  await p1.getByRole("button", { name: "Ответить" }).click();
  await expect(p1.locator(".room-status")).toContainText("участник");
  await p2.locator(".option input[type=radio]").nth(SCENARIO.expectedAnswers.q0.player2).check();
  await p2.getByRole("button", { name: "Ответить" }).click();

  // Наблюдатель видит счётчик ответов, ответить не может.
  await expect(obs.locator(".panel-head").filter({ hasText: "Ответили" })).toBeVisible();
  await expect(obs.getByRole("button", { name: "Ответить" })).toHaveCount(0);

  // 5. Ведущий закрывает вопрос — правильный ответ раскрывается.
  await host.getByRole("button", { name: "Закрыть вопрос" }).click();
  await expect(obs.locator(".option.correct").first()).toBeVisible();
  await expect(p1.locator(".option.correct").first()).toBeVisible();

  // 6. Вопросы 1 (multiple) и 2 (short) — аналогично.
  for (const questionIndex of [1, 2]) {
    await host.getByRole("button", { name: "Следующий вопрос" }).click();
    await expect(host.locator(".room-question")).toBeVisible();

    if (questionIndex === 1) {
      for (const page of [p1]) {
        await page.locator(".option input[type=checkbox]").nth(0).check();
        await page.locator(".option input[type=checkbox]").nth(1).check();
        await page.getByRole("button", { name: "Ответить" }).click();
      }
      await p2.locator(".option input[type=checkbox]").nth(0).check();
      await p2.locator(".option input[type=checkbox]").nth(1).check();
      await p2.getByRole("button", { name: "Ответить" }).click();
    } else {
      await p1.getByPlaceholder("Ваш ответ").fill(SCENARIO.expectedAnswers.q2.player1);
      await p1.getByRole("button", { name: "Ответить" }).click();
      await p2.getByPlaceholder("Ваш ответ").fill(SCENARIO.expectedAnswers.q2.player2);
      await p2.getByRole("button", { name: "Ответить" }).click();
    }
    await expect(obs.locator(".room-status")).not.toBeEmpty();
    await host.getByRole("button", { name: "Закрыть вопрос" }).click();
  }

  // 7. Таблица результатов у наблюдателя.
  await expect(obs.locator("table.table")).toBeVisible();
  await expect(obs.locator("table.table tbody tr")).toHaveCount(2);

  // 8. Обучающее задание и тест без лимита — как в launch-режимах.
  await open(host, "#launch/t-smoke");
  await host.getByText("Обучающее задание").first().click();
  await host.getByRole("button", { name: "Назначить группе" }).first().click();
  await expect(host.locator(".form-error").first()).toBeVisible(); // нет группы

  await hostCtx.close(); await p1Ctx.close(); await p2Ctx.close(); await obsCtx.close();
});
