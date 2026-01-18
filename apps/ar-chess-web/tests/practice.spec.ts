import { expect, test } from "@playwright/test";

test("happy path practice", async ({ page }) => {
  await page.goto("/practice");
  await page.waitForSelector("canvas", { state: "attached" });
  await page.getByLabel("Chess board").focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "Moves" })).toBeVisible();
  await expect(page.locator("text=CPL")).toBeVisible({ timeout: 20_000 });
});
