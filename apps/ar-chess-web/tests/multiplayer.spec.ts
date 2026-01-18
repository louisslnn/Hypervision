import { expect, test } from "@playwright/test";

test("happy path multiplayer", async ({ browser }) => {
  const context = await browser.newContext();
  const page1 = await context.newPage();
  page1.on("pageerror", (error) => {
    console.error("[pageerror]", error.message);
  });
  page1.on("console", (message) => {
    if (message.type() === "error") {
      console.error("[console]", message.text());
    }
    if (message.type() === "log" && message.text().includes("[input]")) {
      console.log("[console]", message.text());
    }
  });
  page1.on("request", (request) => {
    if (request.url().includes("submitMove")) {
      console.log("[request]", request.method(), request.url());
    }
  });
  page1.on("requestfailed", (request) => {
    if (request.url().includes("submitMove")) {
      console.error("[requestfailed]", request.url(), request.failure()?.errorText);
    }
  });
  await page1.goto("/");

  await page1.waitForSelector("text=+ Create Game");
  await page1.getByRole("button", { name: "+ Create Game" }).click();
  await page1.waitForSelector("text=Playing:");
  const gameLine = await page1.locator("text=Playing:").textContent();
  const gameId = gameLine?.replace("Playing:", "").trim();
  expect(gameId).toBeTruthy();
  if (!gameId) {
    return;
  }

  const page2 = await context.newPage();
  await page2.goto("/");
  await page2.fill("input[placeholder='Game ID']", gameId);
  await page2.getByRole("button", { name: "Join" }).click();
  await page2.waitForSelector("text=synced", { timeout: 20_000 });

  await page1.getByLabel("Chess board").focus();
  await page1.keyboard.press("Enter");
  await page1.keyboard.press("ArrowUp");
  await page1.keyboard.press("ArrowUp");
  await page1.keyboard.press("Enter");

  await page2.getByText("Debug Info").click();
  await expect(page2.locator("code")).toContainText("4P3", { timeout: 20_000 });
});
