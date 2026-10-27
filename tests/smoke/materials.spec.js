// tests/smoke/materials.spec.js — Playwright-смоук читалки материала.
// Сценарий: открытие #material/<id>, листание кнопками и клавишами,
// кнопка «К тесту» появляется только на последней странице, страж хеша
// возвращает на читалку при попытке уйти сторонним переходом.
//
// Запуск: npx playwright test tests/smoke/materials.spec.js
// Требуется: npm i -D @playwright/test && npx playwright install chromium

import { test, expect } from "@playwright/test";

const APP = process.env.APP_URL || "http://localhost:5500/index.html";

test("Читалка: листание, страж хеша, выход с последней страницы", async ({ page }) => {
  await page.goto(`${APP}#material/t-smoke`);

  await expect(page.locator(".reader-title")).toContainText("Smoke-тест");

  // Номер страницы внизу, стрелка «назад» неактивна на первой.
  await expect(page.locator(".reader-page-num")).toContainText("1 / 3");
  await expect(page.locator(".reader-arrow.left")).toBeDisabled();

  // Кнопки листания.
  await page.locator(".reader-arrow.right").click();
  await expect(page.locator(".reader-page-num")).toContainText("2 / 3");

  // Клавиатура: ← →.
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".reader-page-num")).toContainText("1 / 3");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".reader-page-num")).toContainText("2 / 3");

  // На средней странице кнопки «К тесту» ещё нет: подсказка есть.
  await expect(page.locator(".reader-exit")).not.toContainText("К тесту");

  // Страж хеша: сторонняя навигация откатывается на читалку.
  await page.evaluate(() => { window.location.hash = "#tests"; });
  await expect(page.locator(".reader-page-num")).toBeVisible();

  // На последней странице появляется «К тесту» и выход работает.
  await page.locator(".reader-arrow.right").click();
  await expect(page.locator(".reader-page-num")).toContainText("3 / 3");
  await page.getByRole("button", { name: "К тесту" }).click();
  await expect(page).toHaveURL(/#quiz\/t-smoke/);
});
