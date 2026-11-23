import { expect, test } from "@playwright/test";

test("the home page loads", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);
  await expect(page.locator("body")).toBeVisible();
});
